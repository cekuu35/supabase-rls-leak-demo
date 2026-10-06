# Community Share Templates

Value-first snippets for GitHub, the Supabase community (GitHub discussions / Discord help channels), and dev forums. Rules: answer the actual question completely, link the free checker or the demo repo only where it genuinely helps, never price/pitch, never post the same canned text twice in a thread.

## 1. GitHub issue reply — "RLS not working / permission denied" questions

> What you're hitting is usually one of three configs: (1) RLS was never enabled on the table, (2) RLS is enabled but no policy matches (Postgres defaults to deny), (3) a policy exists but RLS is still disabled — the policy just sits there unenforced.
>
> This query tells you which in one shot:
>
> ```sql
> select c.relname, c.relrowsecurity as rls_enabled, count(p.polname) as policy_count
> from pg_class c
> join pg_namespace n on n.oid = c.relnamespace
> left join pg_policy p on p.polrelid = c.oid
> where n.nspname = 'public' and c.relkind = 'r'
> group by c.relname, c.relrowsecurity;
> ```
>
> `rls_enabled = false` → the row filter isn't applied at all. `policy_count = 0` on a table you expect to be readable → the deny-default is what's biting. Happy to help read the output if you paste it.

## 2. Supabase community / Discord — "is my anon key safe?" questions

> The anon key is designed to be public — that's why RLS matters. The two things worth checking: (a) no policy that's `USING (true)` with `TO anon`/`TO public` (or no `TO` clause at all — that defaults to public) on a table holding user data; (b) the service-role key only ever on the server — if it's referenced with a `VITE_`/`NEXT_PUBLIC_` prefix anywhere, it's baked into the client bundle.
>
> 30-second check for (a): `select policyname, roles, qual from pg_policies where roles::text = '{anon}' and qual = 'true';` — empty result is what you want.
>
> There's a free client-side scanner that checks public repos for both (reads migrations + env files, nothing else): [link]. Not mine, just useful. *(If it IS yours, say "mine" — honesty reads better.)*

## 3. Forum / Reddit — "AI built my app, is it secure?" posts

> The honest answer: AI-generated Supabase apps are good at making the login work and bad at noticing what the policies actually allow. The pattern I keep finding in real apps: a helper added for one feature (e.g. "check if this email exists on the login page") written as `FOR SELECT TO anon USING (true)` — which works, and quietly exposes the whole table.
>
> Before shipping: run the 30-second policy check (SQL below), rotate anything that ever touched a commit, and add one regression test that logs in as user B and asserts user A's rows don't come back.
>
> ```sql
> select tablename, policyname, roles, qual from pg_policies
> where roles::text in ('{anon}','{public}') and qual = 'true';
> ```

## 4. GitHub issue comment — offering an audit (only when asked or clearly welcome)

> I do paid RLS audits if you want the full pass (every table × policy, grants review, remediation SQL). If not — the free checker + the 30-second queries above will get you most of the way: [link]. Either way, the staff-table policy from earlier in this thread is worth fixing today; the verify query is in my previous comment.

## Posting rules

- One helpful comment per thread; never reply to yourself to bump.
- Match the community's language; answer first, link second.
- If a mod asks for disclosure ("is this your product?") — disclose immediately and fully.
- Weekly volume per community: 1-3 genuinely helpful comments. Zero templated blasts.
