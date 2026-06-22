# Supabase Backend Files - Index & Quick Reference

## 📁 File Structure

```
supabase/
├── schema.sql          # Database schema (tables, enums, indexes)
├── functions.sql       # PL/pgSQL helper functions
├── triggers.sql        # Automatic event handlers
├── policies.sql        # Row Level Security policies
├── storage.sql         # Storage bucket configuration
├── admin_setup.sql     # Admin user promotion SQL
├── setup_guide.md      # Complete setup instructions
└── README.md           # This file
```

---

## 📋 Files Overview

### 1. schema.sql (400 lines)
**What it does**: Creates all database tables, enums, and indexes

**Includes**:
- User roles enum (user, moderator, content_manager, admin, super_admin)
- Payment status enum
- 21 tables total:
  - profiles, books, book_ratings, book_reviews, book_downloads
  - videos, video_views, video_progress
  - lessons, lesson_quizzes, user_progress
  - vacancies, saved_vacancies
  - services, service_requests
  - blog_posts, blog_comments
  - advertisements, payments, contact_inquiries, audit_logs

**Key features**:
- UUID primary keys on all tables
- Foreign key constraints
- Comprehensive indexes for performance
- CHECK constraints for data validation
- RLS enabled on all tables

**Dependencies**: None (runs first)

**Execution time**: ~2 minutes

---

### 2. functions.sql (300 lines)
**What it does**: Creates helper functions for authorization and business logic

**Key functions**:
- `is_admin(user_id)` - Check if user is admin
- `is_content_manager(user_id)` - Check if user can manage content
- `has_role(user_id, role)` - Flexible role checking
- `handle_new_user()` - Auto-create profile on signup
- `update_book_average_rating()` - Recalculate ratings
- `get_python_progress(user_id)` - Track lesson completion
- `complete_python_lesson(user_id, lesson_id)` - Mark lesson done
- `save_vacancy(user_id, vacancy_id)` - Bookmark job
- `get_audit_logs(limit, offset)` - Admin reporting

**Security**: Uses `SECURITY DEFINER` where needed to bypass RLS

**Dependencies**: Requires schema.sql

**Execution time**: ~1 minute

---

### 3. triggers.sql (200 lines)
**What it does**: Sets up automatic event handling

**Key triggers**:
- `on_auth_user_created` - Create profile when user registers
- `update_book_rating_on_*` - Recalculate average ratings
- `log_*_creation` - Audit trail entries
- `increment_*_counter` - Track views/downloads
- Timestamp updates on all modified records

**Important**: Includes `moddatetime()` extension usage for automatic `updated_at` timestamps

**Dependencies**: Requires functions.sql

**Execution time**: ~1 minute

---

### 4. policies.sql (400 lines)
**What it does**: Implements Row Level Security access control

**Policy structure**:

| Table | SELECT | INSERT | UPDATE | DELETE |
|-------|--------|--------|--------|--------|
| profiles | All users | Own only | Own only | Admin |
| books | All users | Content mgr+ | Content mgr+ | Admin |
| book_reviews | All users | Authenticated | Own only | Own only |
| videos | All users | Content mgr+ | Content mgr+ | Admin |
| vacancies | All users | Content mgr+ | Content mgr+ | Admin |
| saved_vacancies | Own only | Authenticated | - | Own only |
| blog_posts | Published/Admin | Content mgr+ | Author+/Admin | Admin |
| payments | Own/Admin | Authenticated | Admin only | - |
| audit_logs | Admin only | System | - | - |

**Key principle**: Data access determined by user role

**Dependencies**: Requires functions.sql

**Execution time**: ~2 minutes

---

### 5. storage.sql (150 lines)
**What it does**: Documents and configures file storage

**Buckets created**:
1. **payment_slips** (Private)
   - Max 50 MB per file
   - MIME types: image/*, application/pdf
   - Users upload proofs, admins verify

2. **cms_assets** (Public)
   - Max 100 MB per file
   - MIME types: image/*, video/*, application/pdf
   - Book covers, video thumbnails, blog images

**Folder structure**:
```
payment_slips/
  └── {user_id}/
      └── payment-{reference}.pdf

cms_assets/
  ├── books/covers/
  ├── videos/thumbnails/
  ├── blog/featured/
  ├── advertisements/banners/
  └── avatars/
```

**Dependencies**: Storage buckets must exist (manual creation)

**Execution time**: ~3 minutes (including manual UI steps)

---

### 6. admin_setup.sql (150 lines)
**What it does**: Promotes manually created admin user to super_admin

**Process**:
1. Verifies admin user exists in auth.users
2. Updates profile role to super_admin
3. Logs promotion in audit_logs
4. Tests admin permissions
5. Lists all admin users

**Prerequisites**:
- Admin user manually created in Supabase Auth UI
- Email: abrahammsofi@gmail.com
- Must be confirmed before this script runs

**Verification queries included**:
- Check role assignment
- Test is_admin() function
- Verify audit log access
- Dashboard overview query

**Dependencies**: Requires schema.sql, functions.sql, and manual user creation

**Execution time**: ~1 minute

---

### 7. setup_guide.md (1000+ lines)
**What it does**: Complete step-by-step implementation guide

**Sections**:
- Prerequisites checklist
- Execution order with timing
- Detailed steps for each SQL file
- Manual setup instructions
- Verification queries
- Troubleshooting guide
- Testing procedures
- Production checklist
- Common SQL commands reference

**Read this first!** It guides you through the entire setup process.

---

## 🚀 Quick Start (5-Minute Summary)

### Step-by-Step Execution

```
1. Run: schema.sql              (2 min)
   └─ Verification: Check tables exist

2. Run: functions.sql           (1 min)
   └─ Verification: Check functions list

3. Run: triggers.sql            (1 min)
   └─ Verification: Check triggers list

4. Run: policies.sql            (2 min)
   └─ Verification: RLS enabled

5. Manual: Create storage buckets (2 min)
   └─ payment_slips (private)
   └─ cms_assets (public)

6. Manual: Create admin user (1 min)
   └─ Email: abrahammsofi@gmail.com

7. Run: admin_setup.sql         (1 min)
   └─ Verification: Admin role assigned

✅ DONE - Backend ready!
```

---

## 🔐 Security Features

### Authentication
- ✅ Supabase Auth integration
- ✅ Email/password signup
- ✅ Password reset support
- ✅ Profile auto-creation on signup
- ✅ Email verification

### Authorization
- ✅ 5-level role system (user → super_admin)
- ✅ Role-based access control (RBAC)
- ✅ Row Level Security (RLS) on all tables
- ✅ Function-level security (`SECURITY DEFINER`)
- ✅ Granular permission policies

### Audit & Compliance
- ✅ Comprehensive audit logging
- ✅ All admin actions tracked
- ✅ User activity tracking
- ✅ Timestamp auto-update
- ✅ Data change history (new_values stored)

### Data Protection
- ✅ Foreign key constraints
- ✅ Referential integrity
- ✅ CHECK constraints on values
- ✅ Email format validation
- ✅ Rating range validation (1-5)

---

## 📊 Data Models

### User System
```
auth.users (Supabase managed)
    ↓
profiles (public table)
    - id (UUID, FK to auth.users)
    - full_name (TEXT)
    - phone (TEXT)
    - role (user_role enum)
    - avatar_url (TEXT)
    - created_at, updated_at
```

### Books & Ratings
```
books
    ↓ (1:N)
book_reviews
book_ratings
book_downloads (analytics)
```

### Python Academy
```
lessons (1:N)
    ↓
lesson_quizzes
    ↓
user_progress (tracks completion)
```

### Vacancies
```
vacancies
    ↓
saved_vacancies (user bookmarks)
```

### Blog
```
blog_posts
    ↓
blog_comments
```

### Payments
```
payments (with status tracking)
    ↓
storage/payment_slips (uploaded proof)
```

---

## 🔧 Maintenance Commands

### Check Database Health
```sql
-- Database size
SELECT pg_size_pretty(pg_database_size('postgres'));

-- Active connections
SELECT count(*) FROM pg_stat_activity;

-- Slow queries
SELECT * FROM pg_stat_statements ORDER BY mean_exec_time DESC LIMIT 10;
```

### Monitor RLS
```sql
-- Check RLS enabled
SELECT tablename, rowsecurity FROM pg_tables 
WHERE schemaname = 'public' AND rowsecurity = true;

-- Count policies
SELECT COUNT(*) FROM pg_policies WHERE schemaname = 'public';
```

### Audit Trail
```sql
-- Recent admin actions
SELECT event, user_id, created_at FROM public.audit_logs 
ORDER BY created_at DESC LIMIT 10;

-- User activity
SELECT event, created_at FROM public.audit_logs 
WHERE user_id = '{user_id}' ORDER BY created_at DESC;
```

---

## 🐛 Common Issues & Fixes

| Issue | Cause | Fix |
|-------|-------|-----|
| "Type already exists" | Running setup twice | Normal; will skip duplicates |
| "Function not found" | Wrong execution order | Run files in correct order |
| "Permission denied" | Not admin user | Use project owner credentials |
| "RLS policy blocks query" | Too restrictive policy | Check policy allows your role |
| Storage upload fails | Bucket doesn't exist | Create manually in UI first |

See `setup_guide.md` for detailed troubleshooting.

---

## 📈 Database Statistics (Post-Setup)

| Object | Count |
|--------|-------|
| Tables | 21 |
| Enums | 5 |
| Indexes | 50+ |
| Functions | 20+ |
| Triggers | 20+ |
| RLS Policies | 60+ |
| Storage Buckets | 2 |

---

## 📝 Supabase Credentials

**Keep these in `.env.local` or similar:**

```env
# Public (safe to share)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGc...

# Private (never share)
SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...

# In frontend (supabase.js):
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
```

---

## 🎯 Next Steps After Setup

1. ✅ Run all 7 setup files (in order)
2. ✅ Create admin user via Supabase Auth UI
3. ✅ Run admin_setup.sql to promote super_admin
4. ✅ Test registration flow
5. ✅ Create sample content (books, videos, jobs)
6. ✅ Verify RLS policies working
7. ✅ Monitor audit logs
8. ✅ Deploy frontend with correct Supabase credentials
9. ✅ Set up regular backups
10. ✅ Monitor database usage

---

## 📞 Support Reference

**Supabase Documentation**: https://supabase.com/docs

**SQL Reference**: https://www.postgresql.org/docs/14/

**Admin Email**: abrahammsofi@gmail.com

---

**Version**: 1.0  
**Last Updated**: 2026-06-07  
**Status**: Production-Ready ✅
