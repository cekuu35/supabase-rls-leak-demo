# Your Supabase app is probably leaking rows between users

This repository reproduces the most common data leak in AI-generated Supabase
apps, and fixes it. Two branches, one file of difference, the same test suite
on both.

```bash
npm install
npm test
```

No Docker, no Supabase project, no credentials. The tests run a real Postgres
([PGlite](https://pglite.dev), Postgres compiled to WebAssembly), so the
row-level security here is the same row-level security your project runs.

| branch  | `db/policies.sql` | `npm test`                |
| ------- | ----------------- | ------------------------- |
| `broken` | absent            | 4 failed, 1 passed        |
| `fixed`  | present           | 5 passed                  |

On `broken`:

```
× does not let user B read any row owned by user A
  → user B received 1 row(s) belonging to another user:
    ["A: card ending 4471, expiry 09/29"]
```

## The symptom

Everything works. Signup works, login works, each user sees their own data in
the UI. Nothing looks wrong, because the frontend only ever asks for the
current user's rows — so the current user's rows are all you ever see.

The leak is not in the UI. It is in what the API will hand over when someone
asks it a slightly different question.

## Three things it usually is

1. **RLS was never enabled on the table.** Grants exist, the app works, and
   every authenticated request can read every row. Grants control which
   *operations* a role may attempt. They say nothing about which *rows*.

2. **RLS is enabled but no policy matches.** Loud and harmless — everything
   returns empty and you find out in about four minutes.

3. **A policy exists but RLS was never enabled.** The dangerous one. The
   dashboard lists your policy, so the table looks protected. It is not
   enforced. Nothing about this looks wrong from anywhere in the product.

Case 3 is the one that ships.

## The query that tells you which

Run this against your own database:

```sql
select
  c.relname                as table_name,
  c.relrowsecurity         as rls_enabled,
  count(p.polname)         as policy_count
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policy p on p.polrelid = c.oid
where n.nspname = 'public' and c.relkind = 'r'
group by c.relname, c.relrowsecurity
order by c.relrowsecurity, c.relname;
```

Any row with `rls_enabled = false` is readable by every signed-in user of your
application. `policy_count > 0` alongside `rls_enabled = false` is case 3.

## The fix

[`db/policies.sql`](db/policies.sql) — enable RLS, then write policies for all
four operations. Both halves are required.

The two mistakes worth knowing about:

- **`USING` without `WITH CHECK`.** Reads get locked down, writes stay open. A
  user can still insert a row carrying someone else's `user_id`, or update
  their own row to hand it to another account. The `insert` and `update` tests
  here cover exactly this.
- **Testing as the table owner.** The owner bypasses RLS by design, so a test
  written as the owner passes on a completely unprotected table.
  [`src/db.ts`](src/db.ts) drops to the `authenticated` role before every query
  for this reason.

## About the test

[`tests/isolation.test.ts`](tests/isolation.test.ts) is byte-for-byte identical
on both branches. It signs in as user B, asks for everything in `public.notes`,
and asserts that nothing owned by user A comes back.

It also asserts that user B *can* still read their own row — otherwise
`revoke all` would pass the suite while breaking the product. A test that only
checks the door is locked cannot tell you the key still works.

## What this is

A minimal app written to reproduce the pattern that no-code and AI app builders
ship by default. It is not an export from any particular tool, and it is not a
security audit of one. It is the smallest complete example of the bug, so that
the fix can be demonstrated rather than described.

MIT licensed. Copy the policies, copy the test, keep the test in your repo so
the bug cannot come back quietly.
