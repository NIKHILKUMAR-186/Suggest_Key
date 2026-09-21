-- ==============================================================================
-- SUGGEST KEY - PHASE 3: AUTHENTICATION, PROFILES & ROLE AUTHORIZATION MIGRATION
-- ==============================================================================

-- 1. Create PROFILES table linked directly to auth.users
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT NOT NULL,
  avatar_url TEXT,
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast user lookup
CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);

-- 2. Create USER_ROLES table
CREATE TABLE IF NOT EXISTS public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('seeker', 'mentor', 'admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_user_roles_user_role UNIQUE (user_id, role)
);

CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON public.user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role ON public.user_roles(role);

-- ==============================================================================
-- 3. SECURITY DEFINER FUNCTIONS (Server-side authorization helpers)
-- ==============================================================================

-- Function to check if a specific user has a specific role
CREATE OR REPLACE FUNCTION public.has_role(check_user_id UUID, check_role TEXT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = check_user_id AND role = check_role
  );
$$;

-- Function to check if the current requesting user has the admin role
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT public.has_role(auth.uid(), 'admin');
$$;

-- Function to check if the current requesting user has the mentor role
CREATE OR REPLACE FUNCTION public.is_mentor()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT public.has_role(auth.uid(), 'mentor');
$$;

-- Function to get all roles for a user
CREATE OR REPLACE FUNCTION public.get_user_roles(check_user_id UUID)
RETURNS TABLE (role TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT ur.role FROM public.user_roles ur
  WHERE ur.user_id = check_user_id;
$$;

-- ==============================================================================
-- 4. ROW LEVEL SECURITY (RLS) POLICIES
-- ==============================================================================

-- Enable RLS on both tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------------------
-- PROFILES POLICIES
-- ------------------------------------------------------------------------------

-- Policy: Users can view their own profile
CREATE POLICY "Users can view own profile"
  ON public.profiles
  FOR SELECT
  USING (auth.uid() = id);

-- Policy: Mentors profile can be viewed by all authenticated users (for seeker discovery)
CREATE POLICY "Authenticated users can view mentor profiles"
  ON public.profiles
  FOR SELECT
  USING (
    auth.role() = 'authenticated' AND
    public.has_role(id, 'mentor')
  );

-- Policy: Admins can view all profiles
CREATE POLICY "Admins can view all profiles"
  ON public.profiles
  FOR SELECT
  USING (public.is_admin());

-- Policy: Users can insert their own profile
CREATE POLICY "Users can insert own profile"
  ON public.profiles
  FOR INSERT
  WITH CHECK (auth.uid() = id);

-- Policy: Users can update their own profile, or admins can update
CREATE POLICY "Users can update own profile"
  ON public.profiles
  FOR UPDATE
  USING (auth.uid() = id OR public.is_admin())
  WITH CHECK (auth.uid() = id OR public.is_admin());

-- Policy: Users can delete own profile or admin
CREATE POLICY "Users can delete own profile"
  ON public.profiles
  FOR DELETE
  USING (auth.uid() = id OR public.is_admin());

-- ------------------------------------------------------------------------------
-- USER_ROLES POLICIES
-- ------------------------------------------------------------------------------

-- Policy: Users can view only their own assigned roles
CREATE POLICY "Users can view own roles"
  ON public.user_roles
  FOR SELECT
  USING (auth.uid() = user_id);

-- Policy: Admins can view all role assignments
CREATE POLICY "Admins can view all roles"
  ON public.user_roles
  FOR SELECT
  USING (public.is_admin());

-- Policy: ONLY Admins can insert/assign roles (Prevent privilege escalation)
CREATE POLICY "Only admins can insert roles"
  ON public.user_roles
  FOR INSERT
  WITH CHECK (public.is_admin());

-- Policy: ONLY Admins can update roles
CREATE POLICY "Only admins can update roles"
  ON public.user_roles
  FOR UPDATE
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Policy: ONLY Admins can delete/revoke roles
CREATE POLICY "Only admins can delete roles"
  ON public.user_roles
  FOR DELETE
  USING (public.is_admin());

-- ==============================================================================
-- 5. AUTOMATIC PROFILE & ROLE PROVISIONING TRIGGER
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
  v_full_name TEXT;
  v_timezone TEXT;
BEGIN
  -- Extract metadata safely
  v_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1));
  v_timezone := COALESCE(NEW.raw_user_meta_data->>'timezone', 'Asia/Kolkata');
  
  -- Create Profile entry
  INSERT INTO public.profiles (id, email, full_name, timezone, created_at, updated_at)
  VALUES (NEW.id, NEW.email, v_full_name, v_timezone, NOW(), NOW())
  ON CONFLICT (id) DO UPDATE
  SET full_name = EXCLUDED.full_name,
      updated_at = NOW();

  -- Prevent arbitrary self-assignment of 'admin' role through signup metadata
  v_role := LOWER(COALESCE(NEW.raw_user_meta_data->>'requested_role', 'seeker'));
  IF v_role NOT IN ('seeker', 'mentor') THEN
    v_role := 'seeker';
  END IF;

  -- Insert initial role
  INSERT INTO public.user_roles (user_id, role, created_at)
  VALUES (NEW.id, v_role, NOW())
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN NEW;
END;
$$;

-- Drop trigger if exists and recreate
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- ==============================================================================
-- 6. SEED INITIAL SUPER ADMIN USER (Executed by platform administrator)
-- Note: Replace with actual admin UID if known, or run via Supabase SQL editor:
-- INSERT INTO public.user_roles (user_id, role) VALUES ('<admin-uuid>', 'admin');
-- ==============================================================================
