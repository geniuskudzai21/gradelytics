-- ═══════════════════════════════════════════════════════════════════════════
-- Gradelytics — migration 002: per-user admin roles
--
-- Run this in the Supabase SQL editor (Dashboard → SQL Editor → New query).
-- Safe to re-run.
--
-- Adds profiles.role so an admin can promote other users from the admin
-- console instead of editing the ADMIN_EMAILS env var and redeploying.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Role column
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.profiles add column if not exists role text not null default 'user';

-- Older rows were written before the constraint existed, so normalise first.
update public.profiles set role = 'user' where role is null or role not in ('user', 'admin');

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
    add constraint profiles_role_check check (role in ('user', 'admin'));

create index if not exists profiles_role_idx on public.profiles (role);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Stop users promoting themselves  ← the important part
--
-- The existing "Profiles are updatable by owner" policy is row-scoped, which
-- means it also covers the role column: without this fix any signed-in user
-- could run
--     supabase.from('profiles').update({ role: 'admin' }).eq('id', myId)
-- and make themselves an admin. RLS cannot exclude a column, so we drop the
-- blanket table-level UPDATE grant and re-grant it per column.
-- ─────────────────────────────────────────────────────────────────────────────
revoke update on table public.profiles from authenticated;
grant update (email, full_name) on table public.profiles to authenticated;

-- Keep the role out of client writes entirely: no INSERT override either.
revoke insert on table public.profiles from authenticated;
grant insert (id, email, full_name) on table public.profiles to authenticated;

-- Writes go through the service_role key (admin console) or the
-- handle_new_user() trigger, both of which bypass these grants.

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Seed the first admin
--
-- The owner keeps working through the ADMIN_PASSWORD env var, so this is only
-- needed if you want the owner to also get the in-app admin link. Add your own
-- address(es) below and run it once.
-- ─────────────────────────────────────────────────────────────────────────────
-- update public.profiles set role = 'admin' where lower(email) = 'you@example.com';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Convenience helper for RLS policies (optional; used only if you later
--    move admin reads onto the client). Kept here so the definition lives in
--    one place.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select coalesce(
        (select role = 'admin' from public.profiles where id = auth.uid()),
        false
    );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;