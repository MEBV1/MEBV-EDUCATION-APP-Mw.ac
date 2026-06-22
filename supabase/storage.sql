-- ============================================================================
-- MALAWI EDUCATION BOOKS AND VACANCIES - SUPABASE STORAGE CONFIGURATION
-- ============================================================================
-- Storage buckets and their RLS policies
-- Execution Order: 5th (after policies.sql, before admin_setup.sql)
-- NOTE: Storage buckets are managed via Supabase UI or API
-- This file documents the required structure
-- ============================================================================

-- ============================================================================
-- STORAGE BUCKETS
-- ============================================================================
-- Manual creation in Supabase Dashboard:
-- 
-- Bucket 1: payment_slips
-- - Public: No (private bucket)
-- - File size limit: 50 MB
-- - Allowed MIME types: image/*, application/pdf
-- 
-- Bucket 2: cms_assets
-- - Public: Yes (public bucket)
-- - File size limit: 100 MB
-- - Allowed MIME types: image/*, video/*, application/pdf

-- ============================================================================
-- PAYMENT SLIPS STORAGE POLICIES
-- ============================================================================

-- Policy: Users can upload their own payment proof
CREATE POLICY "Users can upload their own payment proof" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'payment_slips' AND
  auth.uid()::text = (storage.foldername(name))[1]
);

-- Policy: Users can view their own payment proof
CREATE POLICY "Users can view their own payment proof" ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'payment_slips' AND
  auth.uid()::text = (storage.foldername(name))[1]
);

-- Policy: Admins can view all payment proofs
CREATE POLICY "Admins can view all payment proofs" ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'payment_slips' AND
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role IN ('admin', 'super_admin')
  )
);

-- Policy: Admins can delete payment proofs
CREATE POLICY "Admins can delete payment proofs" ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'payment_slips' AND
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role IN ('admin', 'super_admin')
  )
);

-- ============================================================================
-- CMS ASSETS STORAGE POLICIES
-- ============================================================================

-- Policy: Content managers can upload assets
CREATE POLICY "Content managers can upload assets" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'cms_assets' AND
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role IN ('content_manager', 'admin', 'super_admin')
  )
);

-- Policy: Everyone can view public assets
CREATE POLICY "Everyone can view public assets" ON storage.objects
FOR SELECT
USING (bucket_id = 'cms_assets');

-- Policy: Content managers can update assets
CREATE POLICY "Content managers can update assets" ON storage.objects
FOR UPDATE TO authenticated
USING (
  bucket_id = 'cms_assets' AND
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role IN ('content_manager', 'admin', 'super_admin')
  )
)
WITH CHECK (
  bucket_id = 'cms_assets' AND
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role IN ('content_manager', 'admin', 'super_admin')
  )
);

-- Policy: Admins can delete assets
CREATE POLICY "Admins can delete assets" ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'cms_assets' AND
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role IN ('admin', 'super_admin')
  )
);

-- ============================================================================
-- STORAGE RECOMMENDATIONS
-- ============================================================================

/*

BUCKET SETUP INSTRUCTIONS (Via Supabase Dashboard):

1. Navigate to Storage → Buckets
2. Create new bucket "payment_slips"
   - Privacy: Private
   - File size limit: 50 MB
   - Enable row-level security

3. Create new bucket "cms_assets"
   - Privacy: Public
   - File size limit: 100 MB
   - Enable row-level security

FOLDER STRUCTURE RECOMMENDATIONS:

payment_slips/
  ├── {user_id}/
      ├── payment-{reference}.pdf
      ├── payment-{reference}.jpg
      └── payment-{reference}.png

cms_assets/
  ├── books/
      ├── covers/
      │   └── book-{id}.jpg
      └── files/
          └── book-{id}.pdf
  ├── videos/
      ├── thumbnails/
      │   └── video-{id}.jpg
      └── files/
          └── video-{id}.mp4
  ├── blog/
      ├── featured/
      │   └── post-{id}.jpg
      └── content/
          └── post-{id}-content/
  ├── advertisements/
      ├── banners/
      │   └── ad-{id}.jpg
      └── images/
          └── ad-{id}.png
  └── avatars/
      └── profile-{user_id}.jpg

URL FORMAT:
- Public (cms_assets):
  https://{project}.supabase.co/storage/v1/object/public/cms_assets/path/to/file
  
- Private (payment_slips):
  Use signed URLs: supabaseClient.storage.from('payment_slips').getPublicUrl(path)
  Or: supabaseClient.storage.from('payment_slips').download(path)

*/

-- ============================================================================
-- ENABLE ROW LEVEL SECURITY ON STORAGE OBJECTS
-- ============================================================================

-- Note: RLS is automatically managed by Supabase for storage.objects
-- The policies above handle all access control
