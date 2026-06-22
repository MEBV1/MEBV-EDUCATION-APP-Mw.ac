-- ============================================================================
-- MALAWI EDUCATION BOOKS AND VACANCIES - SUPABASE TRIGGERS
-- ============================================================================
-- Automatic event handlers for profile creation, rating updates, audit logging
-- Execution Order: 3rd (after functions.sql, before policies.sql)
-- ============================================================================

-- ============================================================================
-- AUTH TRIGGER - CREATE PROFILE ON USER REGISTRATION
-- ============================================================================

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Create trigger to handle new user registration
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user();

-- ============================================================================
-- BOOK TRIGGERS
-- ============================================================================

-- Trigger to update book average rating when review is inserted
DROP TRIGGER IF EXISTS update_book_rating_on_review_insert ON public.book_reviews;

CREATE TRIGGER update_book_rating_on_review_insert
AFTER INSERT ON public.book_reviews
FOR EACH ROW
EXECUTE FUNCTION public.update_book_average_rating();

-- Trigger to update book average rating when review is updated
DROP TRIGGER IF EXISTS update_book_rating_on_review_update ON public.book_reviews;

CREATE TRIGGER update_book_rating_on_review_update
AFTER UPDATE ON public.book_reviews
FOR EACH ROW
EXECUTE FUNCTION public.update_book_average_rating();

-- Trigger to update book average rating when review is deleted
DROP TRIGGER IF EXISTS update_book_rating_on_review_delete ON public.book_reviews;

CREATE TRIGGER update_book_rating_on_review_delete
AFTER DELETE ON public.book_reviews
FOR EACH ROW
EXECUTE FUNCTION public.update_book_average_rating();

-- Trigger to log book download
CREATE OR REPLACE FUNCTION public.log_book_download_audit_trigger()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM public.log_audit_event(
    'book_downloaded',
    NEW.user_id,
    'books',
    NEW.book_id
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS log_book_download ON public.book_downloads;

CREATE TRIGGER log_book_download
AFTER INSERT ON public.book_downloads
FOR EACH ROW
EXECUTE FUNCTION public.log_book_download_audit_trigger();

-- Reusable timestamp update trigger function
CREATE OR REPLACE FUNCTION public.moddatetime()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- VACUUM & TIMESTAMP TRIGGERS
-- ============================================================================

-- Update profiles updated_at timestamp
DROP TRIGGER IF EXISTS update_profiles_timestamp ON public.profiles;

CREATE TRIGGER update_profiles_timestamp
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.moddatetime();

-- Update books updated_at timestamp
DROP TRIGGER IF EXISTS update_books_timestamp ON public.books;

CREATE TRIGGER update_books_timestamp
BEFORE UPDATE ON public.books
FOR EACH ROW
EXECUTE FUNCTION public.moddatetime();

-- Update videos updated_at timestamp
DROP TRIGGER IF EXISTS update_videos_timestamp ON public.videos;

CREATE TRIGGER update_videos_timestamp
BEFORE UPDATE ON public.videos
FOR EACH ROW
EXECUTE FUNCTION public.moddatetime();

-- Update lessons updated_at timestamp
DROP TRIGGER IF EXISTS update_lessons_timestamp ON public.lessons;

CREATE TRIGGER update_lessons_timestamp
BEFORE UPDATE ON public.lessons
FOR EACH ROW
EXECUTE FUNCTION public.moddatetime();

-- Update blog_reviews updated_at timestamp
DROP TRIGGER IF EXISTS update_book_reviews_timestamp ON public.book_reviews;

CREATE TRIGGER update_book_reviews_timestamp
BEFORE UPDATE ON public.book_reviews
FOR EACH ROW
EXECUTE FUNCTION public.moddatetime();

-- Update blog_posts updated_at timestamp
DROP TRIGGER IF EXISTS update_blog_posts_timestamp ON public.blog_posts;

CREATE TRIGGER update_blog_posts_timestamp
BEFORE UPDATE ON public.blog_posts
FOR EACH ROW
EXECUTE FUNCTION public.moddatetime();

-- Update payments updated_at timestamp
DROP TRIGGER IF EXISTS update_payments_timestamp ON public.payments;

CREATE TRIGGER update_payments_timestamp
BEFORE UPDATE ON public.payments
FOR EACH ROW
EXECUTE FUNCTION public.moddatetime();

-- ============================================================================
-- AUDIT LOGGING TRIGGERS
-- ============================================================================

-- Log service request creation
CREATE OR REPLACE FUNCTION public.log_service_request_creation_audit_trigger()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM public.log_audit_event(
    'service_request_created',
    NULL,
    'service_requests',
    NEW.id,
    'Service: ' || NEW.service_requested
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS log_service_request_creation ON public.service_requests;

CREATE TRIGGER log_service_request_creation
AFTER INSERT ON public.service_requests
FOR EACH ROW
EXECUTE FUNCTION public.log_service_request_creation_audit_trigger();

-- Log contact inquiry creation
CREATE OR REPLACE FUNCTION public.log_contact_inquiry_creation_audit_trigger()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM public.log_audit_event(
    'contact_inquiry_created',
    NULL,
    'contact_inquiries',
    NEW.id,
    'Subject: ' || NEW.subject
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS log_contact_inquiry_creation ON public.contact_inquiries;

CREATE TRIGGER log_contact_inquiry_creation
AFTER INSERT ON public.contact_inquiries
FOR EACH ROW
EXECUTE FUNCTION public.log_contact_inquiry_creation_audit_trigger();

-- Log blog post publication
CREATE OR REPLACE FUNCTION public.log_blog_post_publication_audit_trigger()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM public.log_audit_event(
    'blog_post_published',
    NEW.author_id,
    'blog_posts',
    NEW.id,
    'Title: ' || NEW.title
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS log_blog_post_publication ON public.blog_posts;

CREATE TRIGGER log_blog_post_publication
AFTER UPDATE ON public.blog_posts
FOR EACH ROW
WHEN (OLD.status <> NEW.status AND NEW.status = 'published')
EXECUTE FUNCTION public.log_blog_post_publication_audit_trigger();

-- Log vacancy creation
CREATE OR REPLACE FUNCTION public.log_vacancy_creation_audit_trigger()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM public.log_audit_event(
    'vacancy_created',
    NULL,
    'vacancies',
    NEW.id,
    'Position: ' || NEW.title || ' at ' || NEW.company
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS log_vacancy_creation ON public.vacancies;

CREATE TRIGGER log_vacancy_creation
AFTER INSERT ON public.vacancies
FOR EACH ROW
EXECUTE FUNCTION public.log_vacancy_creation_audit_trigger();

-- Log payment status changes
CREATE OR REPLACE FUNCTION public.log_payment_status_change_audit_trigger()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM public.log_audit_event(
    'payment_status_updated',
    NEW.user_id,
    'payments',
    NEW.id,
    'Status changed from ' || OLD.status::TEXT || ' to ' || NEW.status::TEXT
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS log_payment_status_change ON public.payments;

CREATE TRIGGER log_payment_status_change
AFTER UPDATE ON public.payments
FOR EACH ROW
WHEN (OLD.status <> NEW.status)
EXECUTE FUNCTION public.log_payment_status_change_audit_trigger();

-- Log role changes
CREATE OR REPLACE FUNCTION public.log_role_change_audit_trigger()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM public.log_audit_event(
    'role_changed',
    NEW.id,
    'profiles',
    NEW.id,
    'Role changed from ' || OLD.role::TEXT || ' to ' || NEW.role::TEXT
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS log_role_change ON public.profiles;

CREATE TRIGGER log_role_change
AFTER UPDATE ON public.profiles
FOR EACH ROW
WHEN (OLD.role <> NEW.role)
EXECUTE FUNCTION public.log_role_change_audit_trigger();

-- ============================================================================
-- ANALYTICS TRIGGERS
-- ============================================================================

-- Increment video views counter
DROP TRIGGER IF EXISTS increment_video_views_counter ON public.video_views;

CREATE OR REPLACE FUNCTION increment_video_views()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.videos
  SET views_count = views_count + 1
  WHERE id = NEW.video_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER increment_video_views_counter
AFTER INSERT ON public.video_views
FOR EACH ROW
EXECUTE FUNCTION increment_video_views();

-- Increment vacancy views counter
DROP TRIGGER IF EXISTS increment_vacancy_views_counter ON public.vacancies;

CREATE OR REPLACE FUNCTION increment_vacancy_views()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.vacancies
  SET views_count = views_count + 1
  WHERE id = NEW.id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Increment blog post views counter
DROP TRIGGER IF EXISTS increment_blog_views_counter ON public.blog_posts;

CREATE OR REPLACE FUNCTION increment_blog_views()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.blog_posts
  SET views_count = views_count + 1
  WHERE id = NEW.id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- REFRESH MATERIALIZED VIEWS / CLEANUP
-- ============================================================================

-- Trigger to remove expired advertisements
DROP TRIGGER IF EXISTS cleanup_expired_advertisements ON public.advertisements;

CREATE OR REPLACE FUNCTION cleanup_expired_advertisements()
RETURNS TRIGGER AS $$
BEGIN
  DELETE FROM public.advertisements
  WHERE expires_at IS NOT NULL AND expires_at < NOW();
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Run cleanup on insert to advertisements
CREATE TRIGGER cleanup_expired_advertisements
AFTER INSERT ON public.advertisements
FOR EACH STATEMENT
EXECUTE FUNCTION cleanup_expired_advertisements();
