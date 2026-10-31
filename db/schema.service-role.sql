-- Case 3 (branch-local): the service-role path with a client-supplied id.
--
-- This case is not a policy bug and no policy file fixes it. A server action
-- takes an id from the client and looks the row up with the service-role
-- credential: the query runs as service_role, which bypasses RLS by design,
-- and the policy on public.notes is never consulted. Both of the functions
-- below are "correct" in the sense that they parse, and only one of them
-- enforces the boundary.
--
-- The whole case is the pair: the unchecked function documents the exposure,
-- the checked one closes it. The assertions are in
-- tests/service-role-leak.test.ts.

-- Orders, the way a commerce app would add them next to public.notes.
create table if not exists public.orders (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null,
  total      integer not null,
  created_at timestamptz not null default now()
);

create index if not exists orders_user_id_idx on public.orders (user_id);

-- The server-side credential. On Supabase this is the service_role key:
-- BYPASSRLS is its defining property, which is what makes it correct for
-- trusted server work and wrong for anything the caller can steer.
-- (CREATE ROLE has no IF NOT EXISTS, hence the guard.)
do $$
begin
  if not exists (select from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end
$$;

grant usage on schema public, auth to service_role;
grant select, insert, update, delete on public.orders to service_role;

-- Seed: one order per user, so a cross-user read is visible as a foreign row.
insert into public.orders (user_id, total) values
  ('11111111-1111-1111-1111-111111111111', 4200),
  ('22222222-2222-2222-2222-222222222222', 1999);

-- The unchecked action: trusts the id the client sent. Looks like a
-- fetch-by-id and is one: it returns any row to any caller, because RLS
-- does not apply to service_role and nothing in the body checks who is asking.
create or replace function public.get_order_unchecked(p_id uuid)
returns table (id uuid, user_id uuid, total integer)
language sql
security definer
set search_path = public, pg_temp
as $$
  select id, user_id, total from public.orders where id = p_id;
$$;

-- The checked action: same surface, one more condition. The caller's
-- identity comes from the JWT claim, never from the argument.
create or replace function public.get_order_checked(p_id uuid)
returns table (id uuid, user_id uuid, total integer)
language sql
security definer
set search_path = public, pg_temp
as $$
  select id, user_id, total from public.orders
  where id = p_id and user_id = auth.uid();
$$;
