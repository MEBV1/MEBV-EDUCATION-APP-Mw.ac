CREATE TABLE public.book_download_visitors (
  visitor_id UUID PRIMARY KEY,
  successful_downloads INTEGER NOT NULL DEFAULT 0 CHECK (successful_downloads >= 0),
  pending_downloads INTEGER NOT NULL DEFAULT 0 CHECK (pending_downloads >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.book_download_attempts (
  request_id UUID PRIMARY KEY,
  visitor_id UUID REFERENCES public.book_download_visitors(visitor_id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  book_id UUID NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'reserved'
    CHECK (status IN ('reserved', 'streamed', 'completed', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  streamed_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);

CREATE INDEX idx_book_download_attempts_visitor_status
  ON public.book_download_attempts(visitor_id, status, created_at);

ALTER TABLE public.book_download_visitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.book_download_attempts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.book_download_visitors FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.book_download_attempts FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.begin_book_download(
  p_request_id UUID,
  p_book_id UUID,
  p_user_id UUID,
  p_visitor_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  existing_attempt public.book_download_attempts%ROWTYPE;
  visitor public.book_download_visitors%ROWTYPE;
  stale_count INTEGER;
BEGIN
  IF p_request_id IS NULL OR p_book_id IS NULL OR
     (p_user_id IS NULL AND p_visitor_id IS NULL) OR
     (p_user_id IS NOT NULL AND p_visitor_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Invalid book download reservation.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::TEXT, 0));

  SELECT * INTO existing_attempt
  FROM public.book_download_attempts
  WHERE request_id = p_request_id
  FOR UPDATE;

  IF FOUND THEN
    IF existing_attempt.book_id <> p_book_id OR
       existing_attempt.user_id IS DISTINCT FROM p_user_id OR
       existing_attempt.visitor_id IS DISTINCT FROM p_visitor_id THEN
      RAISE EXCEPTION 'Download request ID does not match its original reservation.';
    END IF;
    RETURN 'duplicate';
  END IF;

  IF p_visitor_id IS NOT NULL THEN
    INSERT INTO public.book_download_visitors(visitor_id)
    VALUES (p_visitor_id)
    ON CONFLICT (visitor_id) DO NOTHING;

    SELECT * INTO visitor
    FROM public.book_download_visitors
    WHERE visitor_id = p_visitor_id
    FOR UPDATE;

    UPDATE public.book_download_attempts
    SET status = 'failed', finished_at = NOW()
    WHERE visitor_id = p_visitor_id
      AND status IN ('reserved', 'streamed')
      AND created_at < NOW() - INTERVAL '2 hours';
    GET DIAGNOSTICS stale_count = ROW_COUNT;

    IF stale_count > 0 THEN
      UPDATE public.book_download_visitors
      SET pending_downloads = GREATEST(0, pending_downloads - stale_count),
          updated_at = NOW()
      WHERE visitor_id = p_visitor_id
      RETURNING * INTO visitor;
    END IF;

    IF visitor.successful_downloads + visitor.pending_downloads >= 3 THEN
      RETURN 'limit';
    END IF;
  END IF;

  INSERT INTO public.book_download_attempts(
    request_id, visitor_id, user_id, book_id, status
  ) VALUES (
    p_request_id, p_visitor_id, p_user_id, p_book_id, 'reserved'
  );

  IF p_visitor_id IS NOT NULL THEN
    UPDATE public.book_download_visitors
    SET pending_downloads = pending_downloads + 1, updated_at = NOW()
    WHERE visitor_id = p_visitor_id;
  END IF;

  RETURN 'reserved';
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_book_download_streamed(
  p_request_id UUID,
  p_user_id UUID,
  p_visitor_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  attempt public.book_download_attempts%ROWTYPE;
BEGIN
  IF p_request_id IS NULL OR
     (p_user_id IS NULL AND p_visitor_id IS NULL) OR
     (p_user_id IS NOT NULL AND p_visitor_id IS NOT NULL) THEN
    RETURN FALSE;
  END IF;

  IF p_visitor_id IS NOT NULL THEN
    PERFORM 1
    FROM public.book_download_visitors
    WHERE visitor_id = p_visitor_id
    FOR UPDATE;
  END IF;

  SELECT * INTO attempt
  FROM public.book_download_attempts
  WHERE request_id = p_request_id
  FOR UPDATE;

  IF NOT FOUND OR attempt.user_id IS DISTINCT FROM p_user_id OR
     attempt.visitor_id IS DISTINCT FROM p_visitor_id THEN
    RETURN FALSE;
  END IF;

  IF attempt.status IN ('streamed', 'completed') THEN
    RETURN TRUE;
  END IF;
  IF attempt.status <> 'reserved' THEN
    RETURN FALSE;
  END IF;

  UPDATE public.book_download_attempts
  SET status = 'streamed', streamed_at = NOW()
  WHERE request_id = p_request_id;
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_book_download(
  p_request_id UUID,
  p_book_id UUID,
  p_user_id UUID,
  p_visitor_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  attempt public.book_download_attempts%ROWTYPE;
BEGIN
  IF p_request_id IS NULL OR p_book_id IS NULL OR
     (p_user_id IS NULL AND p_visitor_id IS NULL) OR
     (p_user_id IS NOT NULL AND p_visitor_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Invalid completed download request.';
  END IF;

  IF p_visitor_id IS NOT NULL THEN
    PERFORM 1
    FROM public.book_download_visitors
    WHERE visitor_id = p_visitor_id
    FOR UPDATE;
  END IF;

  SELECT * INTO attempt
  FROM public.book_download_attempts
  WHERE request_id = p_request_id
  FOR UPDATE;

  IF NOT FOUND OR attempt.book_id <> p_book_id OR
     attempt.user_id IS DISTINCT FROM p_user_id OR
     attempt.visitor_id IS DISTINCT FROM p_visitor_id THEN
    RAISE EXCEPTION 'Download reservation was not found.';
  END IF;

  IF attempt.status = 'completed' THEN
    RETURN;
  END IF;
  IF attempt.status <> 'streamed' THEN
    RAISE EXCEPTION 'The complete file has not been streamed successfully.';
  END IF;

  UPDATE public.books
  SET downloads_count = COALESCE(downloads_count, 0) + 1
  WHERE id = p_book_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Book record was not found.';
  END IF;

  INSERT INTO public.book_downloads(book_id, user_id, downloaded_at)
  VALUES (p_book_id, p_user_id, NOW());

  UPDATE public.book_download_attempts
  SET status = 'completed', finished_at = NOW()
  WHERE request_id = p_request_id;

  IF p_visitor_id IS NOT NULL THEN
    UPDATE public.book_download_visitors
    SET successful_downloads = successful_downloads + 1,
        pending_downloads = GREATEST(0, pending_downloads - 1),
        updated_at = NOW()
    WHERE visitor_id = p_visitor_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_book_download(
  p_request_id UUID,
  p_user_id UUID,
  p_visitor_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  attempt public.book_download_attempts%ROWTYPE;
BEGIN
  IF p_request_id IS NULL OR
     (p_user_id IS NULL AND p_visitor_id IS NULL) OR
     (p_user_id IS NOT NULL AND p_visitor_id IS NOT NULL) THEN
    RETURN;
  END IF;

  IF p_visitor_id IS NOT NULL THEN
    PERFORM 1
    FROM public.book_download_visitors
    WHERE visitor_id = p_visitor_id
    FOR UPDATE;
  END IF;

  SELECT * INTO attempt
  FROM public.book_download_attempts
  WHERE request_id = p_request_id
  FOR UPDATE;

  IF NOT FOUND OR attempt.user_id IS DISTINCT FROM p_user_id OR
     attempt.visitor_id IS DISTINCT FROM p_visitor_id OR
     attempt.status NOT IN ('reserved', 'streamed') THEN
    RETURN;
  END IF;

  UPDATE public.book_download_attempts
  SET status = 'failed', finished_at = NOW()
  WHERE request_id = p_request_id;

  IF p_visitor_id IS NOT NULL THEN
    UPDATE public.book_download_visitors
    SET pending_downloads = GREATEST(0, pending_downloads - 1),
        updated_at = NOW()
    WHERE visitor_id = p_visitor_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.begin_book_download(UUID, UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_book_download_streamed(UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_book_download(UUID, UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_book_download(UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.begin_book_download(UUID, UUID, UUID, UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_book_download_streamed(UUID, UUID, UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_book_download(UUID, UUID, UUID, UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_book_download(UUID, UUID, UUID)
  TO service_role;
