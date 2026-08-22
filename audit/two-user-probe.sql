-- ============================================================================
-- Two-user probe: automatic cross-user isolation verdict for ONE table.
--
-- Companion to rls-audit.sql #9. That section proves the mechanism (set the
-- claims the API would set); you still had to swap UUIDs by hand and eyeball
-- two result sets. This script does both identities in one run and ends with
-- PASS/FAIL per access path -- read, update, delete, cross-user insert --
-- plus a self-proof that a deliberately permissive policy would be caught.
--
-- Usage: replace the three marked lines (table, owner column, seed INSERT)
-- with your own, then paste the whole file into psql or the Supabase SQL
-- editor against a COPY of your schema. Nothing persists: the entire run is
-- one transaction that rolls back.
--
-- Requires auth.uid() to exist (any Supabase database has it).
-- ============================================================================

begin;

create temp table probe_results (
  check_name text primary key,
  status     text not null check (status in ('PASS', 'FAIL')),
  detail     text
);

create or replace function pg_temp.record(p_name text, p_ok boolean, p_detail text default null)
returns void language sql as $$
  insert into probe_results values (p_name, case when p_ok then 'PASS' else 'FAIL' end, p_detail)
  on conflict (check_name) do update set status = excluded.status, detail = excluded.detail;
$$;

create or replace function pg_temp.act_as(uid uuid) returns void language sql as $$
  select set_config(
    'request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated')::text,
    true
  );
$$;

-- ---------------------------------------------------------------------------
-- ADAPT: point every public.notes reference below at your own table, and
-- adjust the seed INSERT's column list to its NOT NULL columns.
-- ---------------------------------------------------------------------------

do $$
declare
  uid_a uuid := gen_random_uuid();
  uid_b uuid := gen_random_uuid();
  n int;
begin
  -- -----------------------------------------------------------------------
  -- Seed as A. A failed seed makes every later check vacuous, so it aborts
  -- the run instead of producing a green report about rows that do not exist.
  -- -----------------------------------------------------------------------
  set local role authenticated;
  perform pg_temp.act_as(uid_a);
  insert into public.notes (user_id, body) values (uid_a, 'probe-row-from-a');
  reset role;

  -- -----------------------------------------------------------------------
  -- B probes every access path against A's row.
  -- -----------------------------------------------------------------------
  set local role authenticated;
  perform pg_temp.act_as(uid_b);

  select count(*) into n from public.notes where user_id = uid_a and body = 'probe-row-from-a';
  perform pg_temp.record('read:   B cannot SELECT A''s row', n = 0,
                         n || ' foreign rows visible');

  begin
    update public.notes set body = 'probe-row-from-a' where user_id = uid_a;
    get diagnostics n = row_count;
    perform pg_temp.record('write:  B cannot UPDATE A''s row', n = 0,
                           n || ' foreign rows updated');
  exception when insufficient_privilege then
    perform pg_temp.record('write:  B cannot UPDATE A''s row', true, 'blocked by policy');
  end;

  begin
    delete from public.notes where user_id = uid_a;
    get diagnostics n = row_count;
    perform pg_temp.record('write:  B cannot DELETE A''s row', n = 0,
                           n || ' foreign rows deleted');
  exception when insufficient_privilege then
    perform pg_temp.record('write:  B cannot DELETE A''s row', true, 'blocked by policy');
  end;

  -- A 23505 here means WITH CHECK let the row through and only the primary
  -- key stopped it: that is a leak, not a pass.
  begin
    insert into public.notes (user_id, body) values (uid_a, 'inserted-by-b');
    perform pg_temp.record('write:  B cannot INSERT as A', false, 'cross-user insert succeeded');
  exception when insufficient_privilege then
    perform pg_temp.record('write:  B cannot INSERT as A', true);
  when unique_violation then
    perform pg_temp.record('write:  B cannot INSERT as A', false,
                           'failed only on a constraint: policy let it through');
  end;

  reset role;

  -- -----------------------------------------------------------------------
  -- Self-proof: if a USING (true) policy would NOT be detected, the whole
  -- probe is decoration. Prove detection every run on a scratch table.
  -- -----------------------------------------------------------------------
  create table public.__probe_permissive (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null
  );
  alter table public.__probe_permissive enable row level security;
  create policy __probe_deliberate_hole on public.__probe_permissive
    for all using (true) with check (true);

  set local role authenticated;
  perform pg_temp.act_as(uid_a);
  insert into public.__probe_permissive (user_id) values (uid_a);
  perform pg_temp.act_as(uid_b);
  select count(*) into n from public.__probe_permissive;
  reset role;

  perform pg_temp.record(
    'selftest: permissive policy WOULD be caught',
    n > 0,
    case when n > 0 then 'B saw the deliberate hole: probe is live'
         else 'B saw nothing through USING(true): probe is blind' end);

  drop table public.__probe_permissive;

  -- -----------------------------------------------------------------------
  -- Verdict: any FAIL raises, so psql / SQL editor shows the failure and
  -- CI (psql -v ON_ERROR_STOP=1) exits non-zero.
  -- -----------------------------------------------------------------------
  if exists (select 1 from probe_results where status = 'FAIL') then
    raise exception 'TWO-USER PROBE FAILED: % check(s) red - see probe_results',
      (select count(*) from probe_results where status = 'FAIL');
  end if;
end $$;

select * from probe_results order by check_name;

rollback;
