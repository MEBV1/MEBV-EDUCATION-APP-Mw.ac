-- Add atomic rate limits and leases for the server-side push dispatcher.
DO $push_foundation_dependency$
BEGIN
  IF to_regclass('public.push_subscriptions') IS NULL
     OR to_regclass('public.push_notifications') IS NULL
     OR to_regclass('public.push_deliveries') IS NULL THEN
    RAISE EXCEPTION
      'Push delivery worker requires 20261009130000_push_notifications_foundation.sql to be applied first.';
  END IF;
END;
$push_foundation_dependency$;

ALTER TABLE public.push_subscriptions
  DROP CONSTRAINT push_subscriptions_owner_check;
ALTER TABLE public.push_subscriptions
  ADD CONSTRAINT push_subscriptions_owner_check CHECK (
    user_id IS NOT NULL OR anonymous_token_hash IS NOT NULL
  );
DROP INDEX public.idx_push_subscriptions_anonymous_token_hash;

CREATE TABLE public.push_rate_limits (
  bucket_key TEXT PRIMARY KEY,
  window_started_at TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL CHECK (request_count > 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.push_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.push_rate_limits FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.push_rate_limits TO service_role;

CREATE OR REPLACE FUNCTION public.consume_push_rate_limit(
  p_bucket_key TEXT,
  p_window_seconds INTEGER,
  p_max_requests INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  current_count INTEGER;
BEGIN
  IF p_bucket_key IS NULL OR char_length(p_bucket_key) NOT BETWEEN 1 AND 128
     OR p_window_seconds NOT BETWEEN 1 AND 86400
     OR p_max_requests NOT BETWEEN 1 AND 10000 THEN
    RAISE EXCEPTION 'Invalid push rate-limit parameters.'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.push_rate_limits AS limits(
    bucket_key, window_started_at, request_count, updated_at
  )
  VALUES (p_bucket_key, NOW(), 1, NOW())
  ON CONFLICT (bucket_key) DO UPDATE
  SET window_started_at = CASE
        WHEN limits.window_started_at
          + make_interval(secs => p_window_seconds) <= NOW()
        THEN NOW()
        ELSE limits.window_started_at
      END,
      request_count = CASE
        WHEN limits.window_started_at
          + make_interval(secs => p_window_seconds) <= NOW()
        THEN 1
        ELSE limits.request_count + 1
      END,
      updated_at = NOW()
  RETURNING request_count INTO current_count;

  RETURN current_count <= p_max_requests;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_push_rate_limit(TEXT, INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_push_rate_limit(TEXT, INTEGER, INTEGER)
  TO service_role;

CREATE OR REPLACE FUNCTION public.claim_push_notifications(p_limit INTEGER DEFAULT 5)
RETURNS SETOF UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 25 THEN
    RAISE EXCEPTION 'Invalid push notification batch size.'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.push_deliveries AS delivery
  SET status = 'expired',
      updated_at = NOW(),
      last_error = 'Subscription is disabled or expired.'
  FROM public.push_subscriptions AS subscription
  WHERE subscription.id = delivery.subscription_id
    AND (NOT subscription.enabled OR subscription.expires_at <= NOW())
    AND delivery.status IN ('queued', 'retry', 'processing')
    AND delivery.notification_id IN (
      SELECT notification.id
      FROM public.push_notifications AS notification
      WHERE notification.status IN ('queued', 'processing')
    );

  RETURN QUERY
  WITH candidates AS (
    SELECT notification.id
    FROM public.push_notifications AS notification
    WHERE (
        notification.status = 'queued'
        AND notification.available_at <= NOW()
      )
      OR (
        notification.status = 'processing'
        AND notification.claimed_at < NOW() - INTERVAL '5 minutes'
      )
    ORDER BY notification.available_at, notification.created_at
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE public.push_notifications AS notification
  SET status = 'processing',
      claimed_at = NOW(),
      attempts = notification.attempts + 1
  FROM candidates
  WHERE notification.id = candidates.id
  RETURNING notification.id;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_push_notifications(INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_push_notifications(INTEGER)
  TO service_role;

CREATE OR REPLACE FUNCTION public.claim_push_deliveries(
  p_limit INTEGER DEFAULT 100
)
RETURNS TABLE (
  delivery_id UUID,
  notification_id UUID,
  subscription_id UUID,
  endpoint_ciphertext BYTEA,
  p256dh_ciphertext BYTEA,
  auth_ciphertext BYTEA,
  title TEXT,
  body TEXT,
  target_url TEXT,
  attempts INTEGER,
  category TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Invalid push delivery batch size.'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT delivery.id
    FROM public.push_deliveries AS delivery
    JOIN public.push_notifications AS notification
      ON notification.id = delivery.notification_id
    JOIN public.push_subscriptions AS subscription
      ON subscription.id = delivery.subscription_id
    WHERE notification.status = 'processing'
      AND subscription.enabled
      AND (subscription.expires_at IS NULL OR subscription.expires_at > NOW())
      AND delivery.next_attempt_at <= NOW()
      AND (
        delivery.status IN ('queued', 'retry')
        OR (
          delivery.status = 'processing'
          AND delivery.last_attempt_at < NOW() - INTERVAL '5 minutes'
        )
      )
    ORDER BY delivery.next_attempt_at, delivery.created_at
    FOR UPDATE OF delivery SKIP LOCKED
    LIMIT p_limit
  ),
  claimed AS (
    UPDATE public.push_deliveries AS delivery
    SET status = 'processing',
        attempts = delivery.attempts + 1,
        last_attempt_at = NOW(),
        updated_at = NOW()
    FROM candidates
    WHERE delivery.id = candidates.id
    RETURNING delivery.id, delivery.notification_id,
      delivery.subscription_id, delivery.attempts
  )
  SELECT claimed.id, claimed.notification_id, claimed.subscription_id,
    subscription.endpoint_ciphertext, subscription.p256dh_ciphertext,
    subscription.auth_ciphertext, notification.title, notification.body,
    notification.target_url, claimed.attempts, notification.category
  FROM claimed
  JOIN public.push_subscriptions AS subscription
    ON subscription.id = claimed.subscription_id
  JOIN public.push_notifications AS notification
    ON notification.id = claimed.notification_id;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_push_deliveries(INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_push_deliveries(INTEGER)
  TO service_role;

CREATE OR REPLACE FUNCTION public.finalize_push_notification(p_notification_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  UPDATE public.push_notifications AS notification
  SET status = CASE
        WHEN EXISTS (
          SELECT 1
          FROM public.push_deliveries AS delivery
          WHERE delivery.notification_id = notification.id
            AND delivery.status IN ('queued', 'processing', 'retry')
        ) THEN 'processing'
        WHEN EXISTS (
          SELECT 1
          FROM public.push_deliveries AS delivery
          WHERE delivery.notification_id = notification.id
            AND delivery.status = 'failed'
        ) THEN 'failed'
        ELSE 'complete'
      END,
      completed_at = CASE
        WHEN EXISTS (
          SELECT 1
          FROM public.push_deliveries AS delivery
          WHERE delivery.notification_id = notification.id
            AND delivery.status IN ('queued', 'processing', 'retry')
        ) THEN NULL
        ELSE NOW()
      END
  WHERE notification.id = p_notification_id
    AND notification.status = 'processing';
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_push_notification(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_push_notification(UUID)
  TO service_role;

CREATE OR REPLACE FUNCTION public.disable_expired_push_subscriptions()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  disabled_count INTEGER;
BEGIN
  UPDATE public.push_subscriptions
  SET enabled = FALSE,
      updated_at = NOW()
  WHERE enabled
    AND expires_at IS NOT NULL
    AND expires_at <= NOW();

  GET DIAGNOSTICS disabled_count = ROW_COUNT;

  UPDATE public.push_deliveries AS delivery
  SET status = 'expired',
      updated_at = NOW(),
      last_error = 'Subscription has expired.'
  FROM public.push_subscriptions AS subscription
  WHERE subscription.id = delivery.subscription_id
    AND NOT subscription.enabled
    AND delivery.status IN ('queued', 'retry', 'processing');

  RETURN disabled_count;
END;
$$;

REVOKE ALL ON FUNCTION public.disable_expired_push_subscriptions()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.disable_expired_push_subscriptions()
  TO service_role;
