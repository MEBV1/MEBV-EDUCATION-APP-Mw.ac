-- ============================================================================
-- MALAWI EDUCATION BOOKS AND VACANCIES - ADMIN SETUP
-- ============================================================================
-- Promote manually created admin user to super_admin role
-- Execution Order: 7th (after manually creating admin user in Supabase Auth)
-- ============================================================================

-- IMPORTANT: MANUAL STEPS BEFORE RUNNING THIS SCRIPT
-- 1. Go to Supabase Dashboard → Authentication → Users
-- 2. Click "Add user"
-- 3. Enter email: abrahammsofi@gmail.com
-- 4. Generate password (auto-generated) or set custom password
-- 5. Click "Create user"
-- 6. Run the SQL commands below after user appears in the list

-- ============================================================================
-- VERIFY ADMIN USER EXISTS
-- ============================================================================

-- Check if admin user profile exists
SELECT 
  id,
  full_name,
  role,
  created_at
FROM public.profiles
WHERE id = (SELECT id FROM auth.users WHERE email = 'abrahammsofi@gmail.com')
LIMIT 1;

-- Expected output: Shows the profile record with role='user' (initial role)

-- ============================================================================
-- PROMOTE ADMIN USER TO SUPER_ADMIN
-- ============================================================================

-- Update user role to super_admin
UPDATE public.profiles
SET 
  role = 'super_admin'::public.user_role,
  updated_at = NOW()
WHERE id = (SELECT id FROM auth.users WHERE email = 'abrahammsofi@gmail.com');

-- Verify the role change
SELECT 
  id,
  full_name,
  role,
  updated_at
FROM public.profiles
WHERE id = (SELECT id FROM auth.users WHERE email = 'abrahammsofi@gmail.com')
LIMIT 1;

-- Expected output: Role should now be 'super_admin'

-- ============================================================================
-- LOG ADMIN PROMOTION
-- ============================================================================

-- Log the admin promotion event
INSERT INTO public.audit_logs (event, user_id, table_name, record_id, details)
VALUES (
  'admin_promoted',
  (SELECT id FROM auth.users WHERE email = 'abrahammsofi@gmail.com'),
  'profiles',
  (SELECT id FROM auth.users WHERE email = 'abrahammsofi@gmail.com'),
  'User promoted to super_admin role'
);

-- ============================================================================
-- VERIFY ADMIN PERMISSIONS
-- ============================================================================

-- Test 1: Check if admin can read audit logs
SELECT COUNT(*) as audit_log_count
FROM public.audit_logs
WHERE EXISTS (
  SELECT 1 FROM public.profiles
  WHERE profiles.id = (SELECT id FROM auth.users WHERE email = 'abrahammsofi@gmail.com')
  AND profiles.role IN ('admin', 'super_admin')
);

-- Expected: Should return the count of audit logs (admin has access)

-- Test 2: Verify admin role
SELECT public.is_admin((SELECT id FROM auth.users WHERE email = 'abrahammsofi@gmail.com')) as is_admin;

-- Expected output: true

-- Test 3: Verify content manager role
SELECT public.is_content_manager((SELECT id FROM auth.users WHERE email = 'abrahammsofi@gmail.com')) as is_content_manager;

-- Expected output: true (super_admin includes content_manager permissions)

-- ============================================================================
-- CREATE ADDITIONAL ADMIN USERS (Optional)
-- ============================================================================

-- Add more administrators if needed
-- Manual steps: Create user in Supabase Auth, then run:

/*

-- Promote secondary admin
UPDATE public.profiles
SET role = 'admin'::public.user_role
WHERE id = (SELECT id FROM auth.users WHERE email = 'secondary.admin@malawi.edu');

-- Promote content manager
UPDATE public.profiles
SET role = 'content_manager'::public.user_role
WHERE id = (SELECT id FROM auth.users WHERE email = 'content.manager@malawi.edu');

-- Promote moderator
UPDATE public.profiles
SET role = 'moderator'::public.user_role
WHERE id = (SELECT id FROM auth.users WHERE email = 'moderator@malawi.edu');

*/

-- ============================================================================
-- LIST ALL ADMIN USERS
-- ============================================================================

-- View all administrators
SELECT 
  p.id,
  COALESCE(a.email, 'N/A') as email,
  p.full_name,
  p.role,
  p.created_at
FROM public.profiles p
LEFT JOIN auth.users a ON p.id = a.id
WHERE p.role IN ('admin', 'super_admin', 'content_manager', 'moderator')
ORDER BY p.role DESC, p.created_at DESC;

-- ============================================================================
-- ADMIN DASHBOARD ACCESS TEST
-- ============================================================================

-- Verify super_admin can perform admin operations

-- Test read permissions: Admin dashboard overview
SELECT 
  (SELECT COUNT(*) FROM public.books) as total_books,
  (SELECT COUNT(*) FROM public.videos) as total_videos,
  (SELECT COUNT(*) FROM public.lessons) as total_lessons,
  (SELECT COUNT(*) FROM public.vacancies) as total_vacancies,
  (SELECT COUNT(*) FROM public.profiles) as total_users,
  (SELECT COUNT(*) FROM public.audit_logs) as total_audit_logs;

-- Test that admin can query all tables
-- Books
SELECT COUNT(*) FROM public.books;

-- Videos
SELECT COUNT(*) FROM public.videos;

-- Lessons
SELECT COUNT(*) FROM public.lessons;

-- Vacancies
SELECT COUNT(*) FROM public.vacancies;

-- Users
SELECT COUNT(*) FROM public.profiles;

-- Payments
SELECT COUNT(*) FROM public.payments;

-- Audit logs
SELECT COUNT(*) FROM public.audit_logs;

-- ============================================================================
-- GRANT ADMIN USER USAGE RIGHTS
-- ============================================================================

-- Grant execute permissions on admin functions to the super_admin
-- Note: These grants should already be in place from functions.sql

GRANT EXECUTE ON FUNCTION public.get_audit_logs(INT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_is_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin(UUID) TO authenticated;

-- ============================================================================
-- FINAL VERIFICATION
-- ============================================================================

-- Run this complete verification query to confirm admin setup

WITH admin_user AS (
  SELECT id, email FROM auth.users WHERE email = 'abrahammsofi@gmail.com'
),
admin_profile AS (
  SELECT * FROM public.profiles 
  WHERE id = (SELECT id FROM admin_user)
)
SELECT 
  (SELECT email FROM admin_user) as admin_email,
  (SELECT full_name FROM admin_profile) as full_name,
  (SELECT role FROM admin_profile) as role,
  (SELECT role::TEXT = 'super_admin' FROM admin_profile) as is_super_admin,
  (SELECT public.is_admin(id) FROM admin_user) as has_admin_permissions,
  (SELECT public.is_content_manager(id) FROM admin_user) as has_content_permissions,
  (SELECT COUNT(*) FROM public.profiles) as total_users_in_system;

-- Expected output:
-- admin_email: abrahammsofi@gmail.com
-- full_name: (full name from auth)
-- role: super_admin
-- is_super_admin: true
-- has_admin_permissions: true
-- has_content_permissions: true
-- total_users_in_system: 1 (or more if other users registered)
