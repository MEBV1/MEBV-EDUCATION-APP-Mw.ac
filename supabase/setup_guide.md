# Malawi Education Books and Vacancies - Supabase Backend Setup Guide

## Overview

This guide walks through setting up the complete Supabase backend for the Malawi Education platform. All SQL files must be executed in the correct order to avoid dependency errors.

**Execution Timeline**: Approximately 15-20 minutes

---

## Prerequisites

✅ Supabase project created  
✅ Supabase CLI installed (optional, for local testing)  
✅ Admin credentials ready  
✅ Email: `abrahammsofi@gmail.com`

---

## Execution Order & Steps

### STEP 1: Create Database Schema (schema.sql)

**Purpose**: Define all tables, enums, indexes, and constraints

**Time**: ~2 minutes

**Instructions**:

1. Go to Supabase Dashboard → SQL Editor
2. Click "New Query"
3. Copy entire contents of `schema.sql`
4. Paste into the SQL editor
5. Click "Run"
6. Wait for success message (green checkmark)

**Verification Query** (run after completion):

```sql
-- Check enums exist
SELECT typname FROM pg_type WHERE typname IN ('user_role', 'request_status', 'payment_status', 'employment_type', 'post_status');

-- Expected: 5 rows (all enums created)

-- Check tables exist
SELECT COUNT(*) as table_count FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE';

-- Expected: 21 rows (all tables created)

-- Check indexes exist
SELECT COUNT(*) as index_count FROM pg_indexes WHERE schemaname = 'public';

-- Expected: Multiple indexes (50+)
```

**Common Issues**:
- Error: "Type already exists" → Safe to ignore if running multiple times
- Permission denied → Ensure you're using admin credentials

---

### STEP 2: Create Functions (functions.sql)

**Purpose**: Define business logic functions for authorization, user management, analytics

**Time**: ~1 minute

**Instructions**:

1. New SQL Query
2. Copy entire contents of `functions.sql`
3. Paste and execute
4. Wait for completion

**Verification Query**:

```sql
-- List all functions
SELECT routine_name FROM information_schema.routines 
WHERE routine_schema = 'public' AND routine_type = 'FUNCTION'
ORDER BY routine_name;

-- Expected: Functions like is_admin, has_role, handle_new_user, etc.
```

**Common Issues**:
- Warning about function replacement → Expected; these replace old versions
- Permission denied on GRANT → Ensure admin user

---

### STEP 3: Create Triggers (triggers.sql)

**Purpose**: Automate events (profile creation, audit logging, ratings)

**Time**: ~1 minute

**Instructions**:

1. New SQL Query
2. Copy entire contents of `triggers.sql`
3. Paste and execute
4. Wait for success

**Verification Query**:

```sql
-- List all triggers
SELECT trigger_name, event_manipulation, event_object_table 
FROM information_schema.triggers 
WHERE trigger_schema = 'public'
ORDER BY event_object_table;

-- Expected: 20+ triggers on various tables
```

**Common Issues**:
- Error: "Trigger already exists" → Safe; triggers are dropped and recreated
- Function not found → Ensure functions.sql executed successfully

---

### STEP 4: Create Row Level Security Policies (policies.sql)

**Purpose**: Control data access for each role

**Time**: ~2 minutes

**Instructions**:

1. New SQL Query
2. Copy entire contents of `policies.sql`
3. Paste and execute
4. Wait for completion

**Verification Query**:

```sql
-- Check RLS is enabled on key tables
SELECT schemaname, tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public' AND rowsecurity = true
ORDER BY tablename;

-- Expected: All 21 tables with rowsecurity = true

-- Count policies
SELECT COUNT(*) as total_policies FROM pg_policies WHERE schemaname = 'public';

-- Expected: 60+ policies
```

**Common Issues**:
- Policy already exists → Safe; will be skipped
- Role not found → Verify functions.sql executed

---

### STEP 5: Configure Storage (storage.sql)

**Purpose**: Set up file storage buckets and access policies

**Time**: ~3 minutes

**Part A: Create Buckets (Manual - Supabase UI)**

1. Go to Supabase Dashboard → Storage → Buckets
2. Click "New Bucket"
3. **Create Bucket 1: `payment_slips`**
   - Name: `payment_slips`
   - Privacy: Private
   - File size limit: 50 MB
   - Click "Create"

4. **Create Bucket 2: `cms_assets`**
   - Name: `cms_assets`
   - Privacy: Public
   - File size limit: 100 MB
   - Click "Create"

**Part B: Apply Storage Policies (SQL)**

1. New SQL Query
2. Copy storage policies section from `storage.sql`
3. Paste and execute

**Verification** (Manual UI Check):

- Storage → Buckets → See both `payment_slips` and `cms_assets`
- Check bucket settings match above config

**Common Issues**:
- Bucket already exists → Safe; can reuse
- Policies fail to apply → May need manual adjustment via Supabase CLI

---

### STEP 6: Create Admin User (Manual - Supabase Auth UI)

**Purpose**: Create the super_admin account manually

**Time**: ~2 minutes

**Instructions**:

1. Go to Supabase Dashboard → Authentication → Users
2. Click "Add user"
3. Enter email: `abrahammsofi@gmail.com`
4. Password: Generate strong password (copy/save securely) or use auto-generated
5. Click "Create user"
6. **Wait 5-10 seconds** for the user to appear in the list
7. Verify user appears with status "Confirmed"

**Verification**:

```sql
-- Check user exists
SELECT id, email, created_at FROM auth.users WHERE email = 'abrahammsofi@gmail.com';

-- Expected: 1 row with user ID
```

---

### STEP 7: Promote Admin User (admin_setup.sql)

**Purpose**: Assign super_admin role to the admin account

**Time**: ~1 minute

**Instructions**:

1. New SQL Query
2. Copy entire contents of `admin_setup.sql`
3. Paste and execute
4. **Important**: Execute ALL queries, not just the first one

**Verification Queries** (run each to verify):

**Check 1: Admin role assigned**

```sql
SELECT full_name, role FROM public.profiles 
WHERE id = (SELECT id FROM auth.users WHERE email = 'abrahammsofi@gmail.com');

-- Expected: role = 'super_admin'
```

**Check 2: Admin has permissions**

```sql
SELECT public.is_admin((SELECT id FROM auth.users WHERE email = 'abrahammsofi@gmail.com')) as is_admin;

-- Expected: true
```

**Check 3: Can access audit logs**

```sql
SELECT COUNT(*) FROM public.audit_logs;

-- Expected: Returns a number (admin has read access)
```

**Check 4: Dashboard overview**

```sql
SELECT 
  (SELECT COUNT(*) FROM public.books) as total_books,
  (SELECT COUNT(*) FROM public.videos) as total_videos,
  (SELECT COUNT(*) FROM public.vacancies) as total_vacancies,
  (SELECT COUNT(*) FROM public.profiles) as total_users;

-- Expected: All tables return 0 initially (empty database)
```

---

## Full Verification Checklist

After completing all 7 steps, run this comprehensive verification:

```sql
-- COMPREHENSIVE VERIFICATION QUERY

WITH verification AS (
  SELECT
    -- Enums
    (SELECT COUNT(*) FROM pg_type WHERE typname IN ('user_role', 'request_status', 'payment_status', 'employment_type', 'post_status')) as enum_count,
    
    -- Tables
    (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE') as table_count,
    
    -- Functions
    (SELECT COUNT(*) FROM information_schema.routines WHERE routine_schema = 'public' AND routine_type = 'FUNCTION') as function_count,
    
    -- Triggers
    (SELECT COUNT(*) FROM information_schema.triggers WHERE trigger_schema = 'public') as trigger_count,
    
    -- RLS Policies
    (SELECT COUNT(*) FROM pg_policies WHERE schemaname = 'public') as policy_count,
    
    -- Admin user exists
    (SELECT COUNT(*) FROM auth.users WHERE email = 'abrahammsofi@gmail.com') as admin_user_exists,
    
    -- Admin profile has super_admin role
    (SELECT COUNT(*) FROM public.profiles WHERE id = (SELECT id FROM auth.users WHERE email = 'abrahammsofi@gmail.com' LIMIT 1) AND role = 'super_admin') as admin_role_correct
)
SELECT * FROM verification;

-- Expected results:
-- enum_count: 5
-- table_count: 21
-- function_count: 20+
-- trigger_count: 20+
-- policy_count: 60+
-- admin_user_exists: 1
-- admin_role_correct: 1
```

✅ **If all verification checks pass, backend is ready for production!**

---

## Testing the Backend

### Test 1: User Registration Flow

```sql
-- Simulate user registration (check trigger works)
-- Manually create test user in Supabase Auth

-- Check profile auto-created
SELECT * FROM public.profiles WHERE id = '00000000-0000-0000-0000-000000000000';  -- Replace with test user ID

-- Expected: Profile exists with role = 'user'
```

### Test 2: Books & Reviews

```sql
-- Insert test book
INSERT INTO public.books (title, author, category, description)
VALUES ('Test Book', 'Test Author', 'MSCE', 'Test Description')
RETURNING id;

-- Insert test review
INSERT INTO public.book_reviews (book_id, user_id, rating, comment)
VALUES ('{book_id}', '{user_id}', 5, 'Excellent book')
RETURNING id;

-- Check average rating updated
SELECT average_rating FROM public.books WHERE id = '{book_id}';

-- Expected: average_rating = 5.0 (trigger calculated it)
```

### Test 3: Python Academy Progress

```sql
-- Test lesson completion
SELECT public.complete_python_lesson('{user_id}', '{lesson_id}');

-- Check progress
SELECT * FROM public.user_progress WHERE user_id = '{user_id}';

-- Expected: completed = true
```

### Test 4: Admin Permissions

Login with admin account and verify:

```sql
-- Admin can read all data
SELECT COUNT(*) FROM public.audit_logs;

-- Admin can modify content
INSERT INTO public.books (title, author, category, description)
VALUES ('Admin Book', 'Admin', 'Primary', 'Created by admin')
RETURNING id;

-- Admin can delete content
DELETE FROM public.books WHERE author = 'Admin';
```

---

## Troubleshooting Guide

### Issue: "Permission denied" when running SQL

**Solution**:
- Ensure you're logged in as project owner/admin
- Check Supabase Dashboard → Project Settings → Database

### Issue: "Function already exists"

**Solution**:
- This is expected when re-running setup
- Use `DROP FUNCTION IF EXISTS` to force replacement
- Already included in the SQL files

### Issue: Triggers not firing

**Verification**:
```sql
-- Check trigger status
SELECT * FROM information_schema.triggers WHERE event_object_table = 'profiles';

-- Manual trigger test
INSERT INTO public.profiles (id, full_name, role) 
VALUES ('00000000-0000-0000-0000-000000000001', 'Test', 'user');

SELECT * FROM public.audit_logs ORDER BY created_at DESC LIMIT 1;
```

### Issue: RLS policies blocking queries

**Verification**:
```sql
-- Check if RLS is too restrictive
SELECT * FROM public.books LIMIT 1;  -- Should work for all users

-- If fails, verify policy
SELECT * FROM pg_policies WHERE tablename = 'books' AND policyname LIKE 'Enable read%';
```

### Issue: Storage policies not working

**Solution**:
- Ensure buckets created BEFORE policies applied
- Use Supabase CLI to reapply: `supabase push`
- Or manually adjust policies in Supabase Dashboard

---

## Post-Setup Configuration

### 1. Enable Email Authentication

Supabase Dashboard → Authentication → Providers → Email

- Confirm email required: ✅ Yes
- Auto-confirm: ❌ No
- Secure password required: ✅ Yes

### 2. Configure Email Templates

Authentication → Email Templates

- Confirm signup email
- Recover password email
- Magic link email

### 3. Add Custom Metadata

Edit admin user profile to include:

```json
{
  "full_name": "Admin User",
  "department": "Administration",
  "phone": "+265999999999"
}
```

### 4. Set Up Webhooks (Optional)

For payment verification, send alerts to:
- Malawi Education admin email
- SMS notifications on payment status

---

## Production Checklist

Before going live, verify:

- [ ] All 7 SQL files executed successfully
- [ ] Admin user created and verified as super_admin
- [ ] Storage buckets created and policies applied
- [ ] RLS policies preventing unauthorized access
- [ ] Audit logging capturing all events
- [ ] Backups scheduled (automatic with Supabase)
- [ ] Connection strings secured in environment variables
- [ ] Rate limiting configured (if using Supabase functions)
- [ ] Error logging and monitoring enabled
- [ ] Frontend website updated with correct Supabase credentials

---

## Database Credentials

Keep these **secure** and store in `.env` file:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key_here
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
```

Location in frontend: `supabase.js`

---

## Support & Maintenance

### Monitor Database Health

```sql
-- Check database size
SELECT pg_size_pretty(pg_database_size('postgres'));

-- Check connection count
SELECT count(*) FROM pg_stat_activity;

-- View slow queries
SELECT * FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 10;
```

### Regular Maintenance

- **Weekly**: Check audit logs for suspicious activity
- **Monthly**: Review storage usage (Dashboard → Storage)
- **Quarterly**: Backup database export
- **Yearly**: Security audit and permission review

---

## File Reference

| File | Purpose | Size |
|------|---------|------|
| schema.sql | Tables, enums, indexes | ~400 lines |
| functions.sql | Business logic functions | ~300 lines |
| triggers.sql | Automatic events | ~200 lines |
| policies.sql | Row level security | ~400 lines |
| storage.sql | File storage buckets | ~150 lines |
| admin_setup.sql | Admin user configuration | ~150 lines |
| setup_guide.md | This file | Documentation |

---

## Quick Reference: Common SQL Commands

### Add New User Role

```sql
UPDATE public.profiles SET role = 'content_manager'::public.user_role WHERE id = '{user_id}';
```

### View All Admins

```sql
SELECT p.full_name, p.role, a.email FROM public.profiles p 
LEFT JOIN auth.users a ON p.id = a.id 
WHERE p.role IN ('admin', 'super_admin');
```

### Clear Audit Logs (Caution!)

```sql
DELETE FROM public.audit_logs WHERE created_at < NOW() - INTERVAL '90 days';
```

### Export User Data

```sql
SELECT p.id, p.full_name, p.phone, p.role, a.email, p.created_at 
FROM public.profiles p 
LEFT JOIN auth.users a ON p.id = a.id 
ORDER BY p.created_at DESC;
```

---

**Setup Complete! Your Supabase backend is now production-ready. 🚀**
