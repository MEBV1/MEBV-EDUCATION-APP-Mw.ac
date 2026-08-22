ALTER TABLE public.books
  ADD COLUMN IF NOT EXISTS subject TEXT,
  ADD COLUMN IF NOT EXISTS educational_level TEXT,
  ADD COLUMN IF NOT EXISTS isbn TEXT,
  ADD COLUMN IF NOT EXISTS year_published INTEGER,
  ADD COLUMN IF NOT EXISTS edition TEXT,
  ADD COLUMN IF NOT EXISTS language TEXT DEFAULT 'English',
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;

UPDATE public.books
SET language = 'English'
WHERE language IS NULL OR language = '';

UPDATE public.books
SET is_active = TRUE
WHERE is_active IS NULL;
