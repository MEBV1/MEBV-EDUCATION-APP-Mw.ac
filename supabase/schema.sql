-- ============================================================================
-- MALAWI EDUCATION BOOKS AND VACANCIES - SUPABASE SCHEMA
-- ============================================================================
-- Production-ready schema for all backend functionality
-- Execution Order: 1st (before functions, triggers, and policies)
-- ============================================================================

-- ============================================================================
-- ENUMS (Custom Types)
-- ============================================================================

-- User role levels for authorization
CREATE TYPE public.user_role AS ENUM (
  'user',
  'moderator',
  'content_manager',
  'admin',
  'super_admin'
);

-- Request status for service/contact inquiries
CREATE TYPE public.request_status AS ENUM (
  'pending',
  'approved',
  'rejected',
  'completed'
);

-- Payment status for transactions
CREATE TYPE public.payment_status AS ENUM (
  'pending',
  'verified',
  'failed',
  'refunded'
);

-- Employment type for vacancies
CREATE TYPE public.employment_type AS ENUM (
  'Full-time',
  'Part-time',
  'Contract',
  'Temporary'
);

-- Post status for blog articles
CREATE TYPE public.post_status AS ENUM (
  'draft',
  'published',
  'archived'
);

-- ============================================================================
-- PROFILES TABLE (User Information & Roles)
-- ============================================================================

CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  phone TEXT,
  role public.user_role DEFAULT 'user' NOT NULL,
  avatar_url TEXT,
  bio TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()),
  
  CONSTRAINT full_name_not_empty CHECK (full_name <> ''),
  CONSTRAINT phone_format CHECK (phone IS NULL OR phone ~ '^\+?[0-9\s\-()]+$')
);

CREATE INDEX idx_profiles_role ON public.profiles(role);
CREATE INDEX idx_profiles_created_at ON public.profiles(created_at DESC);

-- ============================================================================
-- BOOKS TABLE (Educational Resource Library)
-- ============================================================================

CREATE TABLE public.books (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  author TEXT,
  description TEXT,
  category TEXT NOT NULL,
  cover_url TEXT,
  download_url TEXT,
  pages INTEGER,
  publisher TEXT,
  featured BOOLEAN DEFAULT FALSE,
  downloads_count INTEGER DEFAULT 0,
  average_rating DECIMAL(2,1) DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()),
  
  CONSTRAINT title_not_empty CHECK (title <> ''),
  CONSTRAINT category_valid CHECK (category IN ('MSCE', 'JCE', 'Primary', 'Nursing', 'Novels', 'Past Papers', 'Other'))
);

CREATE INDEX idx_books_category ON public.books(category);
CREATE INDEX idx_books_featured ON public.books(featured);
CREATE INDEX idx_books_created_at ON public.books(created_at DESC);
CREATE INDEX idx_books_title_search ON public.books USING GIN(to_tsvector('english', title || ' ' || COALESCE(author, '')));

-- ============================================================================
-- BOOK RATINGS & REVIEWS
-- ============================================================================

CREATE TABLE public.book_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id UUID NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()),
  
  CONSTRAINT rating_range CHECK (rating >= 1 AND rating <= 5),
  UNIQUE(book_id, user_id)
);

CREATE INDEX idx_book_ratings_book_id ON public.book_ratings(book_id);
CREATE INDEX idx_book_ratings_user_id ON public.book_ratings(user_id);

CREATE TABLE public.book_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id UUID NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL,
  comment TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()),
  
  CONSTRAINT rating_range CHECK (rating >= 1 AND rating <= 5),
  CONSTRAINT comment_length CHECK (comment IS NULL OR LENGTH(comment) <= 2000),
  UNIQUE(book_id, user_id)
);

CREATE INDEX idx_book_reviews_book_id ON public.book_reviews(book_id);
CREATE INDEX idx_book_reviews_user_id ON public.book_reviews(user_id);
CREATE INDEX idx_book_reviews_created_at ON public.book_reviews(created_at DESC);

-- ============================================================================
-- BOOK DOWNLOADS (Analytics)
-- ============================================================================

CREATE TABLE public.book_downloads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id UUID NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  user_id UUID,
  downloaded_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW())
);

CREATE INDEX idx_book_downloads_book_id ON public.book_downloads(book_id);
CREATE INDEX idx_book_downloads_user_id ON public.book_downloads(user_id);
CREATE INDEX idx_book_downloads_date ON public.book_downloads(downloaded_at DESC);

-- ============================================================================
-- VIDEOS TABLE
-- ============================================================================

CREATE TABLE public.videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL,
  thumbnail_url TEXT,
  video_url TEXT NOT NULL,
  views_count INTEGER DEFAULT 0,
  featured BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()),
  
  CONSTRAINT title_not_empty CHECK (title <> ''),
  CONSTRAINT category_valid CHECK (category IN ('Mathematics', 'Science', 'ICT', 'Business', 'Exam Preparation', 'Other'))
);

CREATE INDEX idx_videos_category ON public.videos(category);
CREATE INDEX idx_videos_featured ON public.videos(featured);
CREATE INDEX idx_videos_created_at ON public.videos(created_at DESC);

-- ============================================================================
-- VIDEO VIEWS & PROGRESS
-- ============================================================================

CREATE TABLE public.video_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id UUID NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
  user_id UUID,
  viewed_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW())
);

CREATE INDEX idx_video_views_video_id ON public.video_views(video_id);
CREATE INDEX idx_video_views_user_id ON public.video_views(user_id);

CREATE TABLE public.video_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  video_id UUID NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
  completed_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()),
  
  UNIQUE(user_id, video_id)
);

CREATE INDEX idx_video_progress_user_id ON public.video_progress(user_id);
CREATE INDEX idx_video_progress_video_id ON public.video_progress(video_id);

-- ============================================================================
-- PYTHON ACADEMY - LESSONS
-- ============================================================================

CREATE TABLE public.lessons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  summary TEXT,
  description TEXT,
  content TEXT,
  level TEXT DEFAULT 'Beginner',
  premium BOOLEAN DEFAULT FALSE,
  video_url TEXT,
  thumbnail_url TEXT,
  position INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()),
  
  CONSTRAINT title_not_empty CHECK (title <> '')
);

CREATE INDEX idx_lessons_position ON public.lessons(position);
CREATE INDEX idx_lessons_premium ON public.lessons(premium);
CREATE INDEX idx_lessons_created_at ON public.lessons(created_at DESC);

-- ============================================================================
-- PYTHON ACADEMY - QUIZZES
-- ============================================================================

CREATE TABLE public.lesson_quizzes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id UUID NOT NULL REFERENCES public.lessons(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  options TEXT[] NOT NULL,
  correct_answer TEXT NOT NULL,
  position INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()),
  
  CONSTRAINT options_not_empty CHECK (array_length(options, 1) > 0),
  CONSTRAINT correct_in_options CHECK (correct_answer = ANY(options))
);

CREATE INDEX idx_lesson_quizzes_lesson_id ON public.lesson_quizzes(lesson_id);
CREATE INDEX idx_lesson_quizzes_position ON public.lesson_quizzes(position);

-- ============================================================================
-- PYTHON ACADEMY - USER PROGRESS
-- ============================================================================

CREATE TABLE public.user_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lesson_id UUID NOT NULL REFERENCES public.lessons(id) ON DELETE CASCADE,
  category TEXT DEFAULT 'python',
  completed BOOLEAN DEFAULT FALSE,
  completed_at TIMESTAMP WITH TIME ZONE,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()),
  
  UNIQUE(user_id, lesson_id)
);

CREATE INDEX idx_user_progress_user_id ON public.user_progress(user_id);
CREATE INDEX idx_user_progress_lesson_id ON public.user_progress(lesson_id);
CREATE INDEX idx_user_progress_category ON public.user_progress(category);

-- ============================================================================
-- VACANCIES TABLE
-- ============================================================================

CREATE TABLE public.vacancies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  company TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL,
  location TEXT,
  salary TEXT,
  employment_type public.employment_type DEFAULT 'Full-time',
  apply_link TEXT,
  deadline TEXT,
  views_count INTEGER DEFAULT 0,
  featured BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()),
  
  CONSTRAINT title_not_empty CHECK (title <> ''),
  CONSTRAINT company_not_empty CHECK (company <> ''),
  CONSTRAINT category_valid CHECK (category IN ('Teaching', 'Administration', 'NGO', 'Professional', 'Other'))
);

CREATE INDEX idx_vacancies_category ON public.vacancies(category);
CREATE INDEX idx_vacancies_location ON public.vacancies(location);
CREATE INDEX idx_vacancies_featured ON public.vacancies(featured);
CREATE INDEX idx_vacancies_created_at ON public.vacancies(created_at DESC);

-- ============================================================================
-- SAVED VACANCIES
-- ============================================================================

CREATE TABLE public.saved_vacancies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vacancy_id UUID NOT NULL REFERENCES public.vacancies(id) ON DELETE CASCADE,
  saved_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()),
  
  UNIQUE(user_id, vacancy_id)
);

CREATE INDEX idx_saved_vacancies_user_id ON public.saved_vacancies(user_id);
CREATE INDEX idx_saved_vacancies_vacancy_id ON public.saved_vacancies(vacancy_id);

-- ============================================================================
-- SERVICES TABLE
-- ============================================================================

CREATE TABLE public.services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  category TEXT,
  description TEXT,
  price TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()),
  
  CONSTRAINT name_not_empty CHECK (name <> '')
);

CREATE INDEX idx_services_category ON public.services(category);
CREATE INDEX idx_services_created_at ON public.services(created_at DESC);

-- ============================================================================
-- SERVICE REQUESTS
-- ============================================================================

CREATE TABLE public.service_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  service_requested TEXT NOT NULL,
  message TEXT,
  status public.request_status DEFAULT 'pending',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()),
  
  CONSTRAINT name_not_empty CHECK (full_name <> ''),
  CONSTRAINT email_valid CHECK (email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$')
);

CREATE INDEX idx_service_requests_status ON public.service_requests(status);
CREATE INDEX idx_service_requests_email ON public.service_requests(email);
CREATE INDEX idx_service_requests_created_at ON public.service_requests(created_at DESC);

-- ============================================================================
-- BLOG POSTS TABLE
-- ============================================================================

CREATE TABLE public.blog_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  excerpt TEXT,
  content TEXT,
  category TEXT,
  featured_image TEXT,
  featured BOOLEAN DEFAULT FALSE,
  status public.post_status DEFAULT 'draft',
  views_count INTEGER DEFAULT 0,
  author_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  published_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()),
  
  CONSTRAINT title_not_empty CHECK (title <> '')
);

CREATE INDEX idx_blog_posts_status ON public.blog_posts(status);
CREATE INDEX idx_blog_posts_category ON public.blog_posts(category);
CREATE INDEX idx_blog_posts_featured ON public.blog_posts(featured);
CREATE INDEX idx_blog_posts_published_at ON public.blog_posts(published_at DESC);
CREATE INDEX idx_blog_posts_created_at ON public.blog_posts(created_at DESC);

-- ============================================================================
-- BLOG COMMENTS
-- ============================================================================

CREATE TABLE public.blog_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES public.blog_posts(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()),
  
  CONSTRAINT name_not_empty CHECK (name <> ''),
  CONSTRAINT message_not_empty CHECK (message <> '')
);

CREATE INDEX idx_blog_comments_post_id ON public.blog_comments(post_id);
CREATE INDEX idx_blog_comments_user_id ON public.blog_comments(user_id);
CREATE INDEX idx_blog_comments_created_at ON public.blog_comments(created_at DESC);

-- ============================================================================
-- ADVERTISEMENTS
-- ============================================================================

CREATE TABLE public.advertisements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  image_url TEXT,
  link_url TEXT,
  status TEXT DEFAULT 'active',
  position INTEGER,
  expires_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()),
  
  CONSTRAINT title_not_empty CHECK (title <> '')
);

CREATE INDEX idx_advertisements_status ON public.advertisements(status);
CREATE INDEX idx_advertisements_position ON public.advertisements(position);
CREATE INDEX idx_advertisements_created_at ON public.advertisements(created_at DESC);

-- ============================================================================
-- PAYMENTS TABLE
-- ============================================================================

CREATE TABLE public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference TEXT UNIQUE NOT NULL,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount DECIMAL(10, 2) NOT NULL,
  currency TEXT DEFAULT 'MWK',
  status public.payment_status DEFAULT 'pending',
  payment_method TEXT,
  proof_file_path TEXT,
  description TEXT,
  verified_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()),
  
  CONSTRAINT amount_positive CHECK (amount > 0),
  CONSTRAINT reference_not_empty CHECK (reference <> '')
);

-- ============================================================================
-- SUBSCRIPTIONS TABLE
-- ============================================================================

CREATE TABLE public.subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan TEXT NOT NULL,
  start_date TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  end_date TIMESTAMP WITH TIME ZONE NOT NULL,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW())
);

CREATE INDEX idx_subscriptions_user_id ON public.subscriptions(user_id);
CREATE INDEX idx_subscriptions_end_date ON public.subscriptions(end_date);

-- ============================================================================
-- UTILITY FUNCTIONS
-- ============================================================================

-- Function to increment a counter column safely
CREATE OR REPLACE FUNCTION public.increment_counter(table_name TEXT, column_name TEXT, row_id UUID)
RETURNS VOID AS $$
BEGIN
  -- Basic validation of table and column names to prevent SQL injection
  IF table_name NOT IN ('books', 'videos', 'lessons', 'vacancies', 'blog_posts', 'services', 'advertisements') THEN
    RAISE EXCEPTION 'Invalid table name';
  END IF;
  
  IF column_name NOT IN ('downloads_count', 'views_count', 'impressions_count') THEN
    RAISE EXCEPTION 'Invalid column name';
  END IF;

  EXECUTE format('UPDATE public.%I SET %I = COALESCE(%I, 0) + 1 WHERE id = %L', table_name, column_name, column_name, row_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


CREATE INDEX idx_payments_user_id ON public.payments(user_id);
CREATE INDEX idx_payments_status ON public.payments(status);
CREATE INDEX idx_payments_reference ON public.payments(reference);
CREATE INDEX idx_payments_created_at ON public.payments(created_at DESC);

-- ============================================================================
-- CONTACT INQUIRIES
-- ============================================================================

CREATE TABLE public.contact_inquiries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  subject TEXT,
  message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()),
  
  CONSTRAINT name_not_empty CHECK (full_name <> ''),
  CONSTRAINT email_valid CHECK (email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$')
);

CREATE INDEX idx_contact_inquiries_email ON public.contact_inquiries(email);
CREATE INDEX idx_contact_inquiries_created_at ON public.contact_inquiries(created_at DESC);

-- ============================================================================
-- AUDIT LOGS
-- ============================================================================

CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event TEXT NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  table_name TEXT,
  record_id UUID,
  old_values JSONB,
  new_values JSONB,
  details TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()),
  
  CONSTRAINT event_not_empty CHECK (event <> '')
);

CREATE INDEX idx_audit_logs_user_id ON public.audit_logs(user_id);
CREATE INDEX idx_audit_logs_event ON public.audit_logs(event);
CREATE INDEX idx_audit_logs_table_name ON public.audit_logs(table_name);
CREATE INDEX idx_audit_logs_created_at ON public.audit_logs(created_at DESC);

-- ============================================================================
-- ENABLE ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.books ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.book_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.book_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.book_downloads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lessons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lesson_quizzes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vacancies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_vacancies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blog_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blog_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.advertisements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_inquiries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
