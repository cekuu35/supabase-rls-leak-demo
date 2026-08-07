-- ===========================================================================
-- Supabase / Postgres authorization boundary — read-only audit
--
-- Nine queries against the system catalogs. Every one is SELECT-only: nothing
-- here writes, locks, or changes a setting, so it is safe to paste into the
-- Supabase SQL editor on production. Run them as `postgres`.
--
-- Run Supabase's own linter first (Dashboard > Advisors > Security). It is
-- free and it already catches queries 1 and 2 below. What it cannot check is
-- whether a policy that *exists* is correct — queries 3 through 9 are the
-- gaps a linter has no way to see. If everything here reads the way you
-- expect, you are done and you do not need anything else.
--
-- MIT. Copy it into your own repo, CI job or checklist.
-- Part of https://github.com/cekuu35/supabase-rls-leak-demo
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- 1. Coverage: which tables have RLS on, and how many policies back it
--
-- rls_on = false  -> no row filter at all; the anon key in your frontend
--                    reads the whole table, and that key is public by design.
-- rls_on = true, policies = 0 -> RLS on with nothing behind it. Denies
--                    everything for non-owners, which usually shows up as a
--                    broken feature rather than a leak.
-- ---------------------------------------------------------------------------
select c.relname                as table_name,
       c.relrowsecurity         as rls_on,
       c.relforcerowsecurity    as rls_forced,
       count(p.polname)         as policies
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policy p on p.polrelid = c.oid
where n.nspname = 'public'
  and c.relkind = 'r'
group by 1, 2, 3
order by c.relrowsecurity, count(p.polname), c.relname;


-- ---------------------------------------------------------------------------
-- 2. Every policy, in full, with the roles it actually applies to
--
-- An empty roles array means polroles = {0}, i.e. the policy has no TO clause
-- and is therefore evaluated for EVERY role, anon included. "Authenticated
-- users can read their own rows" then quietly means "anyone holding the anon
-- key can". Generated schemas leave TO off constantly.
--
-- permissive = false is a RESTRICTIVE policy. Permissive policies OR together;
-- restrictive ones AND. One restrictive policy evaluating false blocks the
-- statement no matter how many `with check (true)` policies sit beside it.
-- ---------------------------------------------------------------------------
select c.relname                                  as table_name,
       p.polname                                  as policy_name,
       case p.polcmd
         when 'r' then 'SELECT' when 'a' then 'INSERT'
         when 'w' then 'UPDATE' when 'd' then 'DELETE'
         when '*' then 'ALL'    else p.polcmd::text
       end                                        as command,
       p.polpermissive                            as permissive,
       array(select rolname from pg_roles where oid = any(p.polroles)) as roles,
       pg_get_expr(p.polqual, p.polrelid)         as using_expr,
       pg_get_expr(p.polwithcheck, p.polrelid)    as with_check_expr
from pg_policy p
join pg_class c     on c.oid = p.polrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
order by c.relname, p.polpermissive, p.polcmd, p.polname;


-- ---------------------------------------------------------------------------
-- 3. The write side, read carefully
--
-- A common myth is that a missing WITH CHECK leaves writes unguarded. It does
-- not: Postgres applies USING to the new row when WITH CHECK is absent. The
-- real rule is narrower and more useful —
--
--   the write is constrained by exactly the same predicate as visibility,
--   and any column that predicate does not mention is unconstrained.
--
-- So read each row below against the table's column list and ask which
-- columns the expression never names. A policy of `using (tenant_id = ...)`
-- stops a row moving between tenants and does nothing about `is_admin`.
-- ---------------------------------------------------------------------------
select c.relname                               as table_name,
       p.polname                               as policy_name,
       coalesce(pg_get_expr(p.polwithcheck, p.polrelid),
                pg_get_expr(p.polqual, p.polrelid)) as effective_write_check,
       (p.polwithcheck is null)                as inherited_from_using,
       string_agg(a.attname, ', ' order by a.attnum) as columns_on_table
from pg_policy p
join pg_class c      on c.oid = p.polrelid
join pg_namespace n  on n.oid = c.relnamespace
join pg_attribute a  on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
where n.nspname = 'public'
  and p.polcmd in ('a', 'w', '*')
group by 1, 2, 3, 4
order by 1, 2;


-- ---------------------------------------------------------------------------
-- 4. What anon and authenticated can WRITE
--
-- Table privileges are checked before policies. A table with flawless RLS and
-- no INSERT grant is not writable; a table with a permissive policy and a
-- broad grant is. This is the question the read-side lint never asks.
-- ---------------------------------------------------------------------------
select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee in ('anon', 'authenticated')
  and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
order by grantee, table_name, privilege_type;


-- ---------------------------------------------------------------------------
-- 5. SECURITY DEFINER functions reachable from the client
--
-- A definer function executes as its owner, so the caller's policies never
-- run. Combined with `grant execute ... to anon`, the grant list *is* the
-- security boundary — and there is no policy for a linter to inspect.
--
-- A null search_path_pinned is the second half of the hole: without
-- `set search_path = ...` the function resolves unqualified names against
-- the caller's search_path.
-- ---------------------------------------------------------------------------
select n.nspname                                             as schema,
       p.proname                                             as function_name,
       pg_get_userbyid(p.proowner)                           as owner,
       has_function_privilege(to_regrole('anon')::oid,          p.oid, 'EXECUTE') as anon_can_call,
       has_function_privilege(to_regrole('authenticated')::oid, p.oid, 'EXECUTE') as auth_can_call,
       p.proconfig                                           as search_path_pinned
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where p.prosecdef
  and n.nspname not in ('pg_catalog', 'information_schema', 'extensions',
                        'graphql', 'graphql_public', 'pgbouncer', 'realtime',
                        'storage', 'vault', 'auth', 'net', 'cron', 'pgsodium')
order by anon_can_call desc, auth_can_call desc, 1, 2;


-- ---------------------------------------------------------------------------
-- 6. Views: the other way around a policy
--
-- A Postgres view runs with its OWNER's privileges unless it is created with
-- security_invoker = true. A view owned by postgres over an RLS-protected
-- table returns rows the caller could never select directly — which is a
-- legitimate pattern for a deliberate read API, and a silent leak when it
-- was not deliberate.
--
-- Any row here with security_invoker = false AND anon_select = true is worth
-- reading line by line.
-- ---------------------------------------------------------------------------
select c.relname                            as view_name,
       c.relkind                            as kind,   -- v = view, m = matview
       pg_get_userbyid(c.relowner)          as owner,
       coalesce((select option_value
                 from pg_options_to_table(c.reloptions)
                 where option_name = 'security_invoker'), 'false')
                                            as security_invoker,
       has_table_privilege(to_regrole('anon')::oid,          c.oid, 'SELECT') as anon_select,
       has_table_privilege(to_regrole('authenticated')::oid, c.oid, 'SELECT') as auth_select
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind in ('v', 'm')
order by anon_select desc, 1;


-- ---------------------------------------------------------------------------
-- 7. Owner bypass and BYPASSRLS
--
-- RLS does not apply to a table's owner unless FORCE ROW LEVEL SECURITY is
-- set, and it never applies to a role holding BYPASSRLS. If a table's owner
-- is a role your application can reach, its policies are decoration.
-- ---------------------------------------------------------------------------
select c.relname                     as table_name,
       pg_get_userbyid(c.relowner)   as owner,
       c.relrowsecurity              as rls_on,
       c.relforcerowsecurity         as rls_forced
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by c.relforcerowsecurity, 2, 1;

select rolname, rolbypassrls, rolsuper
from pg_roles
where rolbypassrls or rolsuper
order by 1;


-- ---------------------------------------------------------------------------
-- 8. Policy performance: unwrapped auth.uid() re-evaluates per row
--
-- `auth.uid() = user_id` calls the function once per row. `(select auth.uid())`
-- is hoisted into an InitPlan and evaluated once. On a table with real row
-- counts that is the difference between a policy you keep and one you rip out
-- for the wrong reason. Supabase's linter reports this as 0003_auth_rls_initplan.
-- ---------------------------------------------------------------------------
select c.relname   as table_name,
       p.polname   as policy_name,
       pg_get_expr(p.polqual, p.polrelid) as using_expr
from pg_policy p
join pg_class c     on c.oid = p.polrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and pg_get_expr(p.polqual, p.polrelid) ~* 'auth\.(uid|jwt|role)\(\)'
  and pg_get_expr(p.polqual, p.polrelid) !~* '\(\s*select\s+auth\.'
order by 1, 2;


-- ---------------------------------------------------------------------------
-- 9. Prove it against a real identity, without persisting anything
--
-- `set role authenticated` alone is not enough: request.jwt.claims is unset,
-- so auth.uid() evaluates to NULL and every ownership policy filters
-- everything away. That is why "it returns nothing in the SQL editor" is such
-- a common false alarm. Set the claims the API would set, and roll back.
--
-- Replace the sub with two real user ids in turn. The first should see their
-- own rows; the second should see none of the first user's rows. If both see
-- the same rows, that is the cross-tenant leak.
-- ---------------------------------------------------------------------------
begin;

select set_config(
  'request.jwt.claims',
  '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}',
  true
);
set local role authenticated;

-- put your own table here
-- select * from public.your_table;

reset role;
rollback;
