-- ============================================================================
-- MALAWI EDUCATION BOOKS AND VACANCIES - SUPABASE RLS POLICIES
-- ============================================================================
-- Row Level Security policies for all tables
-- Execution Order: 4th (after triggers.sql, before storage.sql)
-- ============================================================================

-- ============================================================================
-- PROFILES TABLE POLICIES
-- ============================================================================

-- Policy: Users can view all profiles (public data)
CREATE POLICY "Enable read access for all profiles" ON public.profiles
FOR SELECT USING (true);

-- Policy: Users can update their own profile
CREATE POLICY "Enable update for users own profile" ON public.profiles
FOR UPDATE USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

-- Policy: Only admins can delete profiles
CREATE POLICY "Enable delete for admins only" ON public.profiles
FOR DELETE USING (public.is_admin(auth.uid()));

-- Policy: Only admins can update role field
CREATE POLICY "Enable role update for admins only" ON public.profiles
FOR UPDATE USING (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));

-- ============================================================================
-- BOOKS TABLE POLICIES
-- ============================================================================

-- Policy: Everyone can view books (public content)
CREATE POLICY "Enable read access for all users" ON public.books
FOR SELECT USING (true);

-- Policy: Content managers and admins can insert books
CREATE POLICY "Enable insert for content managers" ON public.books
FOR INSERT WITH CHECK (public.is_content_manager(auth.uid()));

-- Policy: Content managers and admins can update books
CREATE POLICY "Enable update for content managers" ON public.books
FOR UPDATE USING (public.is_content_manager(auth.uid()))
WITH CHECK (public.is_content_manager(auth.uid()));

-- Policy: Admins can delete books
CREATE POLICY "Enable delete for admins only" ON public.books
FOR DELETE USING (public.is_admin(auth.uid()));

-- ============================================================================
-- BOOK RATINGS & REVIEWS POLICIES
-- ============================================================================

-- Policy: Everyone can view ratings
CREATE POLICY "Enable read access for all users" ON public.book_ratings
FOR SELECT USING (true);

-- Policy: Authenticated users can insert their own rating
CREATE POLICY "Enable insert for authenticated users" ON public.book_ratings
FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Policy: Users can only view their own rating or anyone's rating (for aggregate display)
CREATE POLICY "Enable read for all users" ON public.book_ratings
FOR SELECT USING (true);

-- Policy: Everyone can view reviews
CREATE POLICY "Enable read access for all users" ON public.book_reviews
FOR SELECT USING (true);

-- Policy: Authenticated users can insert reviews
CREATE POLICY "Enable insert for authenticated users" ON public.book_reviews
FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Policy: Users can update their own reviews
CREATE POLICY "Enable update for users own review" ON public.book_reviews
FOR UPDATE USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Policy: Users can delete their own reviews
CREATE POLICY "Enable delete for users own review" ON public.book_reviews
FOR DELETE USING (auth.uid() = user_id);

-- ============================================================================
-- BOOK DOWNLOADS POLICIES (ANALYTICS)
-- ============================================================================

-- Policy: Admins can read download records
CREATE POLICY "Enable read for admins" ON public.book_downloads
FOR SELECT USING (public.is_admin(auth.uid()));

-- Policy: Authenticated users can insert their own downloads
CREATE POLICY "Enable insert for authenticated users" ON public.book_downloads
FOR INSERT WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

-- ============================================================================
-- VIDEOS TABLE POLICIES
-- ============================================================================

-- Policy: Everyone can view videos
CREATE POLICY "Enable read access for all users" ON public.videos
FOR SELECT USING (true);

-- Policy: Content managers can insert videos
CREATE POLICY "Enable insert for content managers" ON public.videos
FOR INSERT WITH CHECK (public.is_content_manager(auth.uid()));

-- Policy: Content managers can update videos
CREATE POLICY "Enable update for content managers" ON public.videos
FOR UPDATE USING (public.is_content_manager(auth.uid()))
WITH CHECK (public.is_content_manager(auth.uid()));

-- Policy: Admins can delete videos
CREATE POLICY "Enable delete for admins" ON public.videos
FOR DELETE USING (public.is_admin(auth.uid()));

-- ============================================================================
-- VIDEO VIEWS & PROGRESS POLICIES
-- ============================================================================

-- Policy: Admins can read video views
CREATE POLICY "Enable read for admins" ON public.video_views
FOR SELECT USING (public.is_admin(auth.uid()));

-- Policy: Authenticated users can track their views
CREATE POLICY "Enable insert for authenticated users" ON public.video_views
FOR INSERT WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

-- Policy: Users can read their own progress
CREATE POLICY "Enable read for own progress" ON public.video_progress
FOR SELECT USING (auth.uid() = user_id OR public.is_admin(auth.uid()));

-- Policy: Users can insert their own progress
CREATE POLICY "Enable insert for authenticated users" ON public.video_progress
FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Policy: Users can update their own progress
CREATE POLICY "Enable update for own progress" ON public.video_progress
FOR UPDATE USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- PYTHON ACADEMY LESSONS POLICIES
-- ============================================================================

-- Policy: Everyone can view lessons
CREATE POLICY "Enable read access for all users" ON public.lessons
FOR SELECT USING (true);

-- Policy: Content managers can insert lessons
CREATE POLICY "Enable insert for content managers" ON public.lessons
FOR INSERT WITH CHECK (public.is_content_manager(auth.uid()));

-- Policy: Content managers can update lessons
CREATE POLICY "Enable update for content managers" ON public.lessons
FOR UPDATE USING (public.is_content_manager(auth.uid()))
WITH CHECK (public.is_content_manager(auth.uid()));

-- Policy: Admins can delete lessons
CREATE POLICY "Enable delete for admins" ON public.lessons
FOR DELETE USING (public.is_admin(auth.uid()));

-- ============================================================================
-- LESSON QUIZZES POLICIES
-- ============================================================================

-- Policy: Everyone can view quizzes
CREATE POLICY "Enable read access for all users" ON public.lesson_quizzes
FOR SELECT USING (true);

-- Policy: Content managers can manage quizzes
CREATE POLICY "Enable insert for content managers" ON public.lesson_quizzes
FOR INSERT WITH CHECK (public.is_content_manager(auth.uid()));

CREATE POLICY "Enable update for content managers" ON public.lesson_quizzes
FOR UPDATE USING (public.is_content_manager(auth.uid()))
WITH CHECK (public.is_content_manager(auth.uid()));

CREATE POLICY "Enable delete for content managers" ON public.lesson_quizzes
FOR DELETE USING (public.is_content_manager(auth.uid()));

-- ============================================================================
-- USER PROGRESS POLICIES
-- ============================================================================

-- Policy: Users can read their own progress
CREATE POLICY "Enable read for own progress" ON public.user_progress
FOR SELECT USING (auth.uid() = user_id OR public.is_admin(auth.uid()));

-- Policy: Users can insert their own progress
CREATE POLICY "Enable insert for authenticated users" ON public.user_progress
FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Policy: Users can update their own progress
CREATE POLICY "Enable update for own progress" ON public.user_progress
FOR UPDATE USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- VACANCIES TABLE POLICIES
-- ============================================================================

-- Policy: Everyone can view vacancies
CREATE POLICY "Enable read access for all users" ON public.vacancies
FOR SELECT USING (true);

-- Policy: Content managers can insert vacancies
CREATE POLICY "Enable insert for content managers" ON public.vacancies
FOR INSERT WITH CHECK (public.is_content_manager(auth.uid()));

-- Policy: Content managers can update vacancies
CREATE POLICY "Enable update for content managers" ON public.vacancies
FOR UPDATE USING (public.is_content_manager(auth.uid()))
WITH CHECK (public.is_content_manager(auth.uid()));

-- Policy: Admins can delete vacancies
CREATE POLICY "Enable delete for admins" ON public.vacancies
FOR DELETE USING (public.is_admin(auth.uid()));

-- ============================================================================
-- SAVED VACANCIES POLICIES
-- ============================================================================

-- Policy: Users can read their own saved vacancies
CREATE POLICY "Enable read for own saved vacancies" ON public.saved_vacancies
FOR SELECT USING (auth.uid() = user_id OR public.is_admin(auth.uid()));

-- Policy: Users can save vacancies
CREATE POLICY "Enable insert for authenticated users" ON public.saved_vacancies
FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Policy: Users can unsave vacancies
CREATE POLICY "Enable delete for own saved vacancies" ON public.saved_vacancies
FOR DELETE USING (auth.uid() = user_id);

-- ============================================================================
-- SERVICES TABLE POLICIES
-- ============================================================================

-- Policy: Everyone can view services
CREATE POLICY "Enable read access for all users" ON public.services
FOR SELECT USING (true);

-- Policy: Content managers can manage services
CREATE POLICY "Enable insert for content managers" ON public.services
FOR INSERT WITH CHECK (public.is_content_manager(auth.uid()));

CREATE POLICY "Enable update for content managers" ON public.services
FOR UPDATE USING (public.is_content_manager(auth.uid()))
WITH CHECK (public.is_content_manager(auth.uid()));

CREATE POLICY "Enable delete for admins" ON public.services
FOR DELETE USING (public.is_admin(auth.uid()));

-- ============================================================================
-- SERVICE REQUESTS POLICIES
-- ============================================================================

-- Policy: Admins can read all service requests
CREATE POLICY "Enable read for admins" ON public.service_requests
FOR SELECT USING (public.is_admin(auth.uid()));

-- Policy: Anyone can submit service requests
CREATE POLICY "Enable insert for all users" ON public.service_requests
FOR INSERT WITH CHECK (true);

-- Policy: Admins can update request status
CREATE POLICY "Enable update for admins" ON public.service_requests
FOR UPDATE USING (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));

-- ============================================================================
-- BLOG POSTS POLICIES
-- ============================================================================

-- Policy: Everyone can view published posts
CREATE POLICY "Enable read for published posts" ON public.blog_posts
FOR SELECT USING (status = 'published' OR public.is_content_manager(auth.uid()) OR public.is_admin(auth.uid()));

-- Policy: Content managers can insert posts
CREATE POLICY "Enable insert for content managers" ON public.blog_posts
FOR INSERT WITH CHECK (public.is_content_manager(auth.uid()));

-- Policy: Content managers can update their posts or admins can update any
CREATE POLICY "Enable update for content managers" ON public.blog_posts
FOR UPDATE USING (
  (author_id = auth.uid() AND public.is_content_manager(auth.uid())) OR 
  public.is_admin(auth.uid())
)
WITH CHECK (
  (author_id = auth.uid() AND public.is_content_manager(auth.uid())) OR 
  public.is_admin(auth.uid())
);

-- Policy: Admins can delete posts
CREATE POLICY "Enable delete for admins" ON public.blog_posts
FOR DELETE USING (public.is_admin(auth.uid()));

-- ============================================================================
-- BLOG COMMENTS POLICIES
-- ============================================================================

-- Policy: Everyone can read published post comments
CREATE POLICY "Enable read for published comments" ON public.blog_comments
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.blog_posts 
    WHERE blog_posts.id = blog_comments.post_id 
    AND blog_posts.status = 'published'
  ) OR public.is_admin(auth.uid())
);

-- Policy: Authenticated users can submit comments
CREATE POLICY "Enable insert for authenticated users" ON public.blog_comments
FOR INSERT WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

-- Policy: Admins can delete comments
CREATE POLICY "Enable delete for admins" ON public.blog_comments
FOR DELETE USING (public.is_admin(auth.uid()));

-- ============================================================================
-- ADVERTISEMENTS POLICIES
-- ============================================================================
ALTER TABLE public.advertisements ENABLE ROW LEVEL SECURITY;

-- Drop existing if any to avoid conflict
DROP POLICY IF EXISTS "Enable read access for all users" ON public.advertisements;
DROP POLICY IF EXISTS "Enable full access for admins" ON public.advertisements;

-- Public can read active advertisements
CREATE POLICY "Enable read access for all users" ON public.advertisements
FOR SELECT USING (true);

-- Admins can do everything
CREATE POLICY "Enable full access for admins" ON public.advertisements
FOR ALL USING (public.is_admin(auth.uid()));

-- ============================================================================
-- PAYMENTS POLICIES
-- ============================================================================

-- Policy: Users can read their own payments
CREATE POLICY "Enable read for own payments" ON public.payments
FOR SELECT USING (auth.uid() = user_id OR public.is_admin(auth.uid()));

-- Policy: Users can insert payments
CREATE POLICY "Enable insert for authenticated users" ON public.payments
FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Policy: Admins can verify/update payments
CREATE POLICY "Enable update for admins" ON public.payments
FOR UPDATE USING (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));

-- ============================================================================
-- CONTACT INQUIRIES POLICIES
-- ============================================================================

-- Policy: Admins can read inquiries
CREATE POLICY "Enable read for admins" ON public.contact_inquiries
FOR SELECT USING (public.is_admin(auth.uid()));

-- Policy: Anyone can submit inquiries
CREATE POLICY "Enable insert for all users" ON public.contact_inquiries
FOR INSERT WITH CHECK (true);

-- ============================================================================
-- SUBSCRIPTIONS POLICIES
-- ============================================================================

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

-- Policy: Users can read their own subscriptions
CREATE POLICY "Enable read for own subscriptions" ON public.subscriptions
FOR SELECT USING (auth.uid() = user_id OR public.is_admin(auth.uid()));

-- Policy: Admins can manage subscriptions
CREATE POLICY "Enable manage for admins" ON public.subscriptions
FOR ALL USING (public.is_admin(auth.uid()));

-- ============================================================================
-- AUDIT LOGS POLICIES
-- ============================================================================

-- Policy: Only admins can read audit logs
CREATE POLICY "Enable read for admins only" ON public.audit_logs
FOR SELECT USING (public.is_admin(auth.uid()));

-- Policy: System and authenticated users can insert logs
CREATE POLICY "Enable insert for authenticated users" ON public.audit_logs
FOR INSERT WITH CHECK (auth.uid() = user_id OR user_id IS NULL);
