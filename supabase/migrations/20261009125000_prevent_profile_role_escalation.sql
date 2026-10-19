CREATE OR REPLACE FUNCTION public.prevent_profile_role_escalation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  actor_id UUID;
  actor_role public.user_role;
BEGIN
  actor_id := auth.uid();

  IF actor_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT role
  INTO actor_role
  FROM public.profiles
  WHERE id = actor_id;

  IF actor_role IS DISTINCT FROM 'admin'::public.user_role
     AND actor_role IS DISTINCT FROM 'super_admin'::public.user_role THEN
    RAISE EXCEPTION 'Only admins can change profile roles.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.is_admin(UUID)
  SET search_path = pg_catalog, pg_temp;

ALTER FUNCTION public.is_content_manager(UUID)
  SET search_path = pg_catalog, pg_temp;

REVOKE ALL ON FUNCTION public.prevent_profile_role_escalation()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS prevent_profile_role_escalation ON public.profiles;

CREATE TRIGGER prevent_profile_role_escalation
BEFORE UPDATE OF role ON public.profiles
FOR EACH ROW
WHEN (OLD.role IS DISTINCT FROM NEW.role)
EXECUTE FUNCTION public.prevent_profile_role_escalation();
