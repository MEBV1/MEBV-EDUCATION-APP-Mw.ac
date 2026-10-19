-- Private push data is accessible only to trusted server-side code.
CREATE TABLE public.push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  anonymous_token_hash BYTEA,
  endpoint_hash BYTEA NOT NULL UNIQUE,
  endpoint_ciphertext BYTEA NOT NULL,
  p256dh_ciphertext BYTEA NOT NULL,
  auth_ciphertext BYTEA NOT NULL,
  category_preferences TEXT[] NOT NULL DEFAULT
    ARRAY['general', 'books', 'vacancies', 'videos', 'python', 'blogs']::TEXT[],
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT push_subscriptions_owner_check CHECK (
    (user_id IS NOT NULL AND anonymous_token_hash IS NULL) OR
    (user_id IS NULL AND anonymous_token_hash IS NOT NULL)
  ),
  CONSTRAINT push_subscriptions_anonymous_hash_check CHECK (
    anonymous_token_hash IS NULL OR octet_length(anonymous_token_hash) = 32
  ),
  CONSTRAINT push_subscriptions_endpoint_hash_check CHECK (
    octet_length(endpoint_hash) = 32
  ),
  CONSTRAINT push_subscriptions_ciphertext_check CHECK (
    octet_length(endpoint_ciphertext) > 0 AND
    octet_length(p256dh_ciphertext) > 0 AND
    octet_length(auth_ciphertext) > 0
  ),
  CONSTRAINT push_subscriptions_preferences_check CHECK (
    cardinality(category_preferences) BETWEEN 1 AND 6 AND
    category_preferences <@
      ARRAY['general', 'books', 'vacancies', 'videos', 'python', 'blogs']::TEXT[]
  )
);

CREATE UNIQUE INDEX idx_push_subscriptions_anonymous_token_hash
  ON public.push_subscriptions(anonymous_token_hash)
  WHERE anonymous_token_hash IS NOT NULL;
CREATE INDEX idx_push_subscriptions_user_id
  ON public.push_subscriptions(user_id)
  WHERE user_id IS NOT NULL;
CREATE INDEX idx_push_subscriptions_active_expiry
  ON public.push_subscriptions(expires_at)
  WHERE enabled;
CREATE INDEX idx_push_subscriptions_preferences
  ON public.push_subscriptions USING GIN(category_preferences);

COMMENT ON TABLE public.push_subscriptions IS
  'Private device records. Endpoint and Web Push keys must be application-encrypted before storage; anonymous ownership stores only a token hash.';
COMMENT ON COLUMN public.push_subscriptions.category_preferences IS
  'Automatic content categories. General announcements intentionally target every active subscription regardless of this array.';

CREATE TABLE public.push_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL CHECK (
    category IN ('general', 'books', 'vacancies', 'videos', 'python', 'blogs')
  ),
  source TEXT NOT NULL CHECK (source IN ('manual', 'publication')),
  idempotency_key TEXT NOT NULL UNIQUE,
  source_table TEXT,
  source_id UUID,
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 240),
  target_url TEXT NOT NULL CHECK (
    char_length(target_url) BETWEEN 1 AND 500 AND
    left(target_url, 1) = '/' AND
    left(target_url, 2) <> '//' AND
    position(chr(92) IN target_url) = 0 AND
    target_url !~ '[[:cntrl:]]'
  ),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (
    status IN ('queued', 'processing', 'complete', 'failed')
  ),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT push_notifications_source_check CHECK (
    (source = 'manual' AND source_table IS NULL AND source_id IS NULL) OR
    (source = 'publication' AND source_table IS NOT NULL AND source_id IS NOT NULL)
  )
);

CREATE INDEX idx_push_notifications_queue
  ON public.push_notifications(status, available_at, created_at)
  WHERE status IN ('queued', 'processing');
CREATE INDEX idx_push_notifications_source
  ON public.push_notifications(source, source_table, source_id);

CREATE TABLE public.push_publication_events (
  event_key TEXT PRIMARY KEY,
  category TEXT NOT NULL CHECK (
    category IN ('books', 'vacancies', 'videos', 'python', 'blogs')
  ),
  source_table TEXT NOT NULL,
  source_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_push_publication_events_source
  ON public.push_publication_events(source_table, source_id);

COMMENT ON TABLE public.push_publication_events IS
  'Permanent first-publication ledger. Deliberately has no content foreign key so item deletion cannot erase deduplication history.';

CREATE TABLE public.push_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id UUID NOT NULL
    REFERENCES public.push_notifications(id) ON DELETE CASCADE,
  subscription_id UUID NOT NULL
    REFERENCES public.push_subscriptions(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (
    status IN ('queued', 'processing', 'retry', 'sent', 'expired', 'failed')
  ),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_attempt_at TIMESTAMPTZ,
  provider_status INTEGER CHECK (
    provider_status IS NULL OR provider_status BETWEEN 100 AND 599
  ),
  last_error TEXT,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT push_deliveries_notification_subscription_unique
    UNIQUE(notification_id, subscription_id)
);

CREATE INDEX idx_push_deliveries_retry
  ON public.push_deliveries(status, next_attempt_at)
  WHERE status IN ('queued', 'retry', 'processing');
CREATE INDEX idx_push_deliveries_subscription
  ON public.push_deliveries(subscription_id, status);

-- Snapshot eligible recipients idempotently; this records work but sends no push.
CREATE OR REPLACE FUNCTION public.prepare_push_deliveries(p_notification_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  notification public.push_notifications%ROWTYPE;
  inserted_count INTEGER;
BEGIN
  SELECT *
  INTO notification
  FROM public.push_notifications
  WHERE id = p_notification_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Push notification was not found.'
      USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.push_deliveries(notification_id, subscription_id)
  SELECT notification.id, subscription.id
  FROM public.push_subscriptions AS subscription
  WHERE subscription.enabled
    AND (subscription.expires_at IS NULL OR subscription.expires_at > NOW())
    AND (
      notification.category = 'general'
      OR notification.category = ANY(subscription.category_preferences)
    )
  ON CONFLICT (notification_id, subscription_id) DO NOTHING;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count;
END;
$$;

REVOKE ALL ON FUNCTION public.prepare_push_deliveries(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_push_deliveries(UUID)
  TO service_role;

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_publication_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_deliveries ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  public.push_subscriptions,
  public.push_notifications,
  public.push_publication_events,
  public.push_deliveries
FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE
  public.push_subscriptions,
  public.push_notifications,
  public.push_publication_events,
  public.push_deliveries
TO service_role;

-- The permanent ledger and notification enter the database in the content transaction.
CREATE OR REPLACE FUNCTION public.enqueue_first_push_publication()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  notification_category TEXT := TG_ARGV[0];
  target_path TEXT := TG_ARGV[1];
  publication_key TEXT;
  inserted_key TEXT;
  notification_title TEXT;
  notification_body TEXT;
BEGIN
  IF TG_TABLE_NAME = 'blog_posts' THEN
    IF TG_OP <> 'UPDATE'
       OR OLD.status IS NOT DISTINCT FROM 'published'::public.post_status
       OR NEW.status IS DISTINCT FROM 'published'::public.post_status THEN
      RETURN NEW;
    END IF;
  ELSIF TG_OP <> 'INSERT' THEN
    RETURN NEW;
  END IF;

  publication_key := 'publication:' || TG_TABLE_NAME || ':' || NEW.id::TEXT;

  INSERT INTO public.push_publication_events(
    event_key, category, source_table, source_id
  )
  VALUES (
    publication_key, notification_category, TG_TABLE_NAME, NEW.id
  )
  ON CONFLICT (event_key) DO NOTHING
  RETURNING event_key INTO inserted_key;

  IF inserted_key IS NULL THEN
    RETURN NEW;
  END IF;

  notification_title := left(NEW.title, 120);
  notification_body := left(
    'New ' || notification_category || ' content: ' || NEW.title,
    240
  );

  INSERT INTO public.push_notifications(
    category,
    source,
    idempotency_key,
    source_table,
    source_id,
    title,
    body,
    target_url
  )
  VALUES (
    notification_category,
    'publication',
    publication_key,
    TG_TABLE_NAME,
    NEW.id,
    notification_title,
    notification_body,
    target_path || '?id=' || NEW.id::TEXT
  );

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_first_push_publication()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER enqueue_first_push_book
AFTER INSERT ON public.books
FOR EACH ROW
EXECUTE FUNCTION public.enqueue_first_push_publication('books', '/books.html');

CREATE TRIGGER enqueue_first_push_vacancy
AFTER INSERT ON public.vacancies
FOR EACH ROW
EXECUTE FUNCTION public.enqueue_first_push_publication('vacancies', '/vacancies.html');

CREATE TRIGGER enqueue_first_push_video
AFTER INSERT ON public.videos
FOR EACH ROW
EXECUTE FUNCTION public.enqueue_first_push_publication('videos', '/videos.html');

CREATE TRIGGER enqueue_first_push_lesson
AFTER INSERT ON public.lessons
FOR EACH ROW
EXECUTE FUNCTION public.enqueue_first_push_publication('python', '/python.html');

CREATE TRIGGER enqueue_first_push_blog_publication
AFTER UPDATE OF status ON public.blog_posts
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION public.enqueue_first_push_publication('blogs', '/blog.html');

-- A caller-bound database check prevents client-side role claims from authorizing sends.
CREATE OR REPLACE FUNCTION public.enqueue_manual_push_announcement(
  p_idempotency_key UUID,
  p_category TEXT,
  p_title TEXT,
  p_body TEXT,
  p_target_url TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  caller_id UUID := auth.uid();
  caller_role public.user_role;
  notification_id UUID;
  existing_notification public.push_notifications%ROWTYPE;
  manual_key TEXT;
BEGIN
  IF caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.'
      USING ERRCODE = '42501';
  END IF;

  SELECT role
  INTO caller_role
  FROM public.profiles
  WHERE id = caller_id;

  IF caller_role IS DISTINCT FROM 'admin'::public.user_role
     AND caller_role IS DISTINCT FROM 'super_admin'::public.user_role THEN
    RAISE EXCEPTION 'Only admins can enqueue manual announcements.'
      USING ERRCODE = '42501';
  END IF;

  IF p_idempotency_key IS NULL
     OR p_category IS NULL
     OR p_category NOT IN ('general', 'books', 'vacancies', 'videos', 'python', 'blogs')
     OR p_title IS NULL
     OR char_length(btrim(p_title)) NOT BETWEEN 1 AND 120
     OR p_body IS NULL
     OR char_length(btrim(p_body)) NOT BETWEEN 1 AND 240
     OR p_target_url IS NULL
     OR char_length(p_target_url) NOT BETWEEN 1 AND 500
     OR left(p_target_url, 1) <> '/'
     OR left(p_target_url, 2) = '//'
     OR position(chr(92) IN p_target_url) > 0
     OR p_target_url ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'Invalid push announcement.'
      USING ERRCODE = '22023';
  END IF;

  manual_key := 'manual:' || p_idempotency_key::TEXT;

  INSERT INTO public.push_notifications(
    category, source, idempotency_key, title, body, target_url, created_by
  )
  VALUES (
    p_category, 'manual', manual_key, btrim(p_title), btrim(p_body),
    p_target_url, caller_id
  )
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO notification_id;

  IF notification_id IS NOT NULL THEN
    RETURN notification_id;
  END IF;

  SELECT *
  INTO existing_notification
  FROM public.push_notifications
  WHERE idempotency_key = manual_key;

  IF existing_notification.created_by IS DISTINCT FROM caller_id
     OR existing_notification.category IS DISTINCT FROM p_category
     OR existing_notification.title IS DISTINCT FROM btrim(p_title)
     OR existing_notification.body IS DISTINCT FROM btrim(p_body)
     OR existing_notification.target_url IS DISTINCT FROM p_target_url THEN
    RAISE EXCEPTION 'Announcement idempotency key was already used.'
      USING ERRCODE = '23505';
  END IF;

  RETURN existing_notification.id;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_manual_push_announcement(
  UUID, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enqueue_manual_push_announcement(
  UUID, TEXT, TEXT, TEXT, TEXT
) TO authenticated;
