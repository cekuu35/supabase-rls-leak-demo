-- Case 1 (branch-local): the SECURITY DEFINER view over a protected table.
--
-- Reported in the Vercel Next.js discussion (#96888) by @Bhanuteja005: a view
-- over an RLS-protected table evaluates the base-table policies with the
-- view owner's privileges, not the querying user's - so base-table policies
-- are bypassed entirely, and pg_policies looks identical either way. The
-- same "configured in every UI" failure as the third surface, one layer up.
--
-- Postgres 15+ has the fix: security_invoker = on makes the view evaluate
-- base-table policies as the invoking user. This file ships the pair so the
-- assertions can be comparative rather than described.

-- The view as most people write it: no security_invoker, so it runs as its
-- owner (the role that applies db/policies.sql). With the base table's
-- policies present, this view still returns every row.
create or replace view public.notes_view_definer as
select id, user_id, body, created_at from public.notes;

-- The same view, with the role inversion convention. Each query through it
-- evaluates the base-table policies as the caller - which is the behavior
-- people assume the first one already had.
create or replace view public.notes_view_invoker as
select id, user_id, body, created_at from public.notes;

alter view public.notes_view_invoker set (security_invoker = on);

-- The grants on the table do not carry to the view: a view is its own
-- relation with its own ACL. Without this, `authenticated` gets 42501 on
-- the view rather than the rows - a different failure than the one this
-- case is about, and one that hides it.
grant select on public.notes_view_definer, public.notes_view_invoker to authenticated;
