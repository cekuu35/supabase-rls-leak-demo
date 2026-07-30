-- Schema for a two-user notes app, shaped the way Supabase shapes it.
--
-- This is the part AI app-builders get right: tables, columns, a user_id
-- foreign key, and grants so the app role can reach the table.
--
-- What is missing is on the next line down, and it is not visible from the UI:
-- there is no row-level security here. Every authenticated request can read
-- every row in public.notes, regardless of who owns it.

create schema if not exists auth;

-- Supabase exposes the caller's user id through auth.uid(), which reads the
-- `sub` claim off the current request. Policies are written against this.
create or replace function auth.uid() returns uuid
language sql stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

create table public.notes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null,
  body       text not null,
  created_at timestamptz not null default now()
);

create index notes_user_id_idx on public.notes (user_id);

-- `authenticated` is the role supabase-js runs as once a user is signed in.
-- Note that the grants below are table-wide. Grants control which *operations*
-- a role may attempt. They say nothing about which *rows* it may touch.
-- That distinction is the whole bug.
create role authenticated nologin;

grant usage on schema public, auth to authenticated;
grant select, insert, update, delete on public.notes to authenticated;
