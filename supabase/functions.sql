-- ============================================================================
-- MALAWI EDUCATION BOOKS AND VACANCIES - SUPABASE FUNCTIONS
-- ============================================================================
-- Helper functions for authorization, user management, and business logic
-- Execution Order: 2nd (after schema.sql, before triggers.sql)
-- ============================================================================

-- ============================================================================
-- AUTHORIZATION HELPER FUNCTIONS
-- ============================================================================

-- Check if user has admin or super_admin role
CREATE OR REPLACE FUNCTION public.is_admin(user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = user_id AND role IN ('admin', 'super_admin')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Check if user has content_manager or higher role
CREATE OR REPLACE FUNCTION public.is_content_manager(user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = user_id AND role IN ('content_manager', 'admin', 'super_admin')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Check if user has specific role
CREATE OR REPLACE FUNCTION public.has_role(user_id UUID, required_role public.user_role)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = user_id AND role = required_role
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Check if user has any of the specified roles
CREATE OR REPLACE FUNCTION public.has_any_role(user_id UUID, required_roles public.user_role[])
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = user_id AND role = ANY(required_roles)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- USER MANAGEMENT FUNCTIONS
-- ============================================================================

-- Create user profile on registration
-- SECURITY DEFINER allows this to bypass RLS during signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  full_name TEXT;
BEGIN
  -- Extract full_name from user metadata or use email
  full_name := COALESCE(
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'name',
    SPLIT_PART(NEW.email, '@', 1),
    'User'
  );

  INSERT INTO public.profiles (
    id,
    full_name,
    phone,
    role,
    created_at
  ) VALUES (
    NEW.id,
    full_name,
    NEW.raw_user_meta_data->>'phone',
    'user'::public.user_role,
    NOW()
  ) ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Log error but don't block user registration
  RAISE WARNING 'Error creating profile for user %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- BOOK FUNCTIONS
-- ============================================================================

-- Update book average rating
CREATE OR REPLACE FUNCTION public.update_book_average_rating()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.books
  SET average_rating = (
    SELECT ROUND(AVG(rating)::numeric, 1)
    FROM public.book_reviews
    WHERE book_id = COALESCE(NEW.book_id, OLD.book_id)
  )
  WHERE id = COALESCE(NEW.book_id, OLD.book_id);
  
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- VIDEO FUNCTIONS
-- ============================================================================

-- Get user's video watch history
CREATE OR REPLACE FUNCTION public.get_user_video_progress(user_id UUID)
RETURNS TABLE (
  total_videos INT,
  completed_videos INT,
  progress_percent INT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    (SELECT COUNT(*)::INT FROM public.videos),
    (SELECT COUNT(*)::INT FROM public.video_progress WHERE video_progress.user_id = $1),
    CASE 
      WHEN (SELECT COUNT(*) FROM public.videos) = 0 THEN 0
      ELSE ((SELECT COUNT(*) FROM public.video_progress WHERE video_progress.user_id = $1)::DECIMAL / (SELECT COUNT(*) FROM public.videos) * 100)::INT
    END;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- PYTHON ACADEMY FUNCTIONS
-- ============================================================================

-- Get user's Python Academy progress
CREATE OR REPLACE FUNCTION public.get_python_progress(user_id UUID)
RETURNS TABLE (
  total_lessons INT,
  completed_lessons INT,
  progress_percent INT,
  is_certified BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    (SELECT COUNT(*)::INT FROM public.lessons),
    (SELECT COUNT(*)::INT FROM public.user_progress WHERE user_progress.user_id = $1 AND completed = TRUE AND category = 'python'),
    CASE 
      WHEN (SELECT COUNT(*) FROM public.lessons) = 0 THEN 0
      ELSE ((SELECT COUNT(*) FROM public.user_progress WHERE user_progress.user_id = $1 AND completed = TRUE AND category = 'python')::DECIMAL / (SELECT COUNT(*) FROM public.lessons) * 100)::INT
    END,
    ((SELECT COUNT(*) FROM public.user_progress WHERE user_progress.user_id = $1 AND completed = TRUE AND category = 'python')::DECIMAL / (SELECT COUNT(*) FROM public.lessons) * 100 >= 100);
END;
$$ LANGUAGE plpgsql;

-- Mark lesson as complete and log to audit
CREATE OR REPLACE FUNCTION public.complete_python_lesson(user_id UUID, lesson_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  completion_result BOOLEAN;
BEGIN
  INSERT INTO public.user_progress (user_id, lesson_id, category, completed, completed_at)
  VALUES (user_id, lesson_id, 'python', TRUE, NOW())
  ON CONFLICT (user_id, lesson_id) DO UPDATE
  SET completed = TRUE, completed_at = NOW();

  INSERT INTO public.audit_logs (event, user_id, table_name, record_id, new_values)
  VALUES ('lesson_completed', user_id, 'lessons', lesson_id, jsonb_build_object('lesson_id', lesson_id));

  completion_result := TRUE;
  RETURN completion_result;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Error completing lesson % for user %: %', lesson_id, user_id, SQLERRM;
  RETURN FALSE;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- VACANCY FUNCTIONS
-- ============================================================================

-- Save vacancy for user
CREATE OR REPLACE FUNCTION public.save_vacancy(user_id UUID, vacancy_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  INSERT INTO public.saved_vacancies (user_id, vacancy_id)
  VALUES (user_id, vacancy_id)
  ON CONFLICT DO NOTHING;
  
  INSERT INTO public.audit_logs (event, user_id, table_name, record_id)
  VALUES ('vacancy_saved', user_id, 'vacancies', vacancy_id);
  
  RETURN TRUE;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Error saving vacancy % for user %: %', vacancy_id, user_id, SQLERRM;
  RETURN FALSE;
END;
$$ LANGUAGE plpgsql;

-- Get user's saved vacancies
CREATE OR REPLACE FUNCTION public.get_user_saved_vacancies(user_id UUID)
RETURNS TABLE (
  vacancy_id UUID,
  title TEXT,
  company TEXT,
  location TEXT,
  saved_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    v.id,
    v.title,
    v.company,
    v.location,
    sv.saved_at
  FROM public.saved_vacancies sv
  JOIN public.vacancies v ON sv.vacancy_id = v.id
  WHERE sv.user_id = $1
  ORDER BY sv.saved_at DESC;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- BLOG FUNCTIONS
-- ============================================================================

-- Get published blog posts with pagination
CREATE OR REPLACE FUNCTION public.get_published_blog_posts(
  page_number INT DEFAULT 1,
  per_page INT DEFAULT 10
)
RETURNS TABLE (
  id UUID,
  title TEXT,
  excerpt TEXT,
  category TEXT,
  featured_image TEXT,
  views_count INT,
  published_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    bp.id,
    bp.title,
    bp.excerpt,
    bp.category,
    bp.featured_image,
    bp.views_count,
    bp.published_at
  FROM public.blog_posts bp
  WHERE bp.status = 'published'
  ORDER BY bp.published_at DESC
  LIMIT per_page
  OFFSET (page_number - 1) * per_page;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- PAYMENT FUNCTIONS
-- ============================================================================

-- Create payment record
CREATE OR REPLACE FUNCTION public.create_payment(
  user_id UUID,
  amount DECIMAL,
  currency TEXT DEFAULT 'MWK',
  description TEXT DEFAULT NULL
)
RETURNS TABLE (
  payment_id UUID,
  reference TEXT,
  status TEXT
) AS $$
DECLARE
  v_payment_id UUID;
  v_reference TEXT;
BEGIN
  v_reference := 'PAY-' || TO_CHAR(NOW(), 'YYYYMMDDHH24MI') || '-' || SUBSTR(MD5(RANDOM()::TEXT), 1, 8);
  
  INSERT INTO public.payments (user_id, amount, currency, description, reference, status)
  VALUES (user_id, amount, currency, description, v_reference, 'pending'::public.payment_status)
  RETURNING payments.id, payments.reference, payments.status::TEXT
  INTO v_payment_id, v_reference, v_reference;

  RETURN QUERY SELECT v_payment_id, v_reference, 'pending'::TEXT;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Error creating payment: %', SQLERRM;
  RETURN;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- AUDIT FUNCTIONS
-- ============================================================================

-- Log an audit event
CREATE OR REPLACE FUNCTION public.log_audit_event(
  event_name TEXT,
  user_id UUID,
  table_name TEXT DEFAULT NULL,
  record_id UUID DEFAULT NULL,
  details TEXT DEFAULT NULL,
  new_values JSONB DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
  INSERT INTO public.audit_logs (event, user_id, table_name, record_id, details, new_values)
  VALUES (event_name, user_id, table_name, record_id, details, new_values);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Error logging audit event: %', SQLERRM;
END;
$$ LANGUAGE plpgsql;

-- Get audit logs for admin
CREATE OR REPLACE FUNCTION public.get_audit_logs(
  limit_rows INT DEFAULT 100,
  offset_rows INT DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  event TEXT,
  user_id UUID,
  table_name TEXT,
  record_id UUID,
  created_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    al.id,
    al.event,
    al.user_id,
    al.table_name,
    al.record_id,
    al.created_at
  FROM public.audit_logs al
  ORDER BY al.created_at DESC
  LIMIT limit_rows
  OFFSET offset_rows;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- UTILITY FUNCTIONS
-- ============================================================================

-- Get current authenticated user ID
CREATE OR REPLACE FUNCTION public.get_current_user_id()
RETURNS UUID AS $$
BEGIN
  RETURN auth.uid();
END;
$$ LANGUAGE plpgsql STABLE;

-- Check if current user is admin
CREATE OR REPLACE FUNCTION public.current_user_is_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN public.is_admin(auth.uid());
END;
$$ LANGUAGE plpgsql STABLE;

-- Get current user's role
CREATE OR REPLACE FUNCTION public.get_current_user_role()
RETURNS public.user_role AS $$
DECLARE
  user_role public.user_role;
BEGIN
  SELECT role INTO user_role FROM public.profiles WHERE id = auth.uid();
  RETURN COALESCE(user_role, 'user'::public.user_role);
END;
$$ LANGUAGE plpgsql STABLE;

-- Verify user owns profile
CREATE OR REPLACE FUNCTION public.owns_profile(profile_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN profile_id = auth.uid();
END;
$$ LANGUAGE plpgsql STABLE;

-- ============================================================================
-- GRANT PERMISSIONS ON FUNCTIONS
-- ============================================================================

GRANT EXECUTE ON FUNCTION public.is_admin(UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.is_content_manager(UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.has_role(UUID, public.user_role) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.has_any_role(UUID, public.user_role[]) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.get_user_video_progress(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_python_progress(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_python_lesson(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_vacancy(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_saved_vacancies(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_published_blog_posts(INT, INT) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.create_payment(UUID, DECIMAL, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_audit_event(TEXT, UUID, TEXT, UUID, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_audit_logs(INT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_current_user_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_current_user_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.owns_profile(UUID) TO authenticated;
