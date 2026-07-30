-- THE FIX.
--
-- On the `broken` branch this file does not exist. On `fixed` it does.
-- Nothing else differs between the two branches — the application code is
-- identical and the test file is identical. Only this file is added.
--
-- Two separate things have to be true, and they are commonly confused:
--
--   1. RLS must be ENABLED on the table. Enabling it flips the table to
--      deny-by-default for non-owner roles.
--   2. A POLICY must exist that says which rows are allowed through.
--
-- Enabling RLS without a policy locks everyone out, which is loud and gets
-- noticed immediately. Writing a policy without enabling RLS leaves the table
-- wide open while *looking* secured in the dashboard — the policy is listed,
-- it just is not enforced. That second case is the one that ships to
-- production, because nothing about it looks wrong.

alter table public.notes enable row level security;

-- USING controls which existing rows are visible to SELECT / UPDATE / DELETE.
-- WITH CHECK controls which new or modified rows are permitted on INSERT / UPDATE.
--
-- Omitting WITH CHECK is the second most common mistake here: reads get locked
-- down correctly, but a user can still INSERT a row with someone else's
-- user_id, or UPDATE their own row to hand it to another account.
create policy notes_owner_select on public.notes
  for select
  to authenticated
  using (user_id = auth.uid());

create policy notes_owner_insert on public.notes
  for insert
  to authenticated
  with check (user_id = auth.uid());

create policy notes_owner_update on public.notes
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy notes_owner_delete on public.notes
  for delete
  to authenticated
  using (user_id = auth.uid());
