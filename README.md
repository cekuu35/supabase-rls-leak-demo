# Supabase/Postgres RLS isolation failure: a minimal reproducible example

This repository is a synthetic minimal reproduction of a missing-RLS
configuration in a PostgreSQL schema designed for Supabase-style auth. The
branches use the same tests and differ only by `db/policies.sql`. It is not an
export from, or evidence about, any named AI/no-code tool.

```bash
npm ci
npm run test:ci
```

No Docker, Supabase project, or credentials are required. The tests run
PostgreSQL in [PGlite](https://pglite.dev/docs/about) and exercise
[database-level row-security](https://www.postgresql.org/docs/17/ddl-rowsecurity.html)
behavior locally. They do not emulate Supabase Auth, PostgREST, Data API
exposure, network controls, or production configuration; the result proves
only this fixture's database-level behavior.

For a practical cross-user and cross-tenant test matrix, read
[How to test Supabase RLS policies before launch](https://cenkkurtoglu.com/blog/how-to-test-supabase-rls-policies?utm_source=github&utm_medium=readme&utm_campaign=rls_audit&utm_content=testing_guide).

| branch   | `db/policies.sql` | raw Vitest result  |
| -------- | ----------------- | ------------------- |
| `broken` | absent            | 4 failed, 1 passed  |
| `fixed`  | present           | 5 passed            |

`npm run test:ci` verifies that the exact expected signature occurs on each
branch. The raw `npm test` command exits non-zero on `broken`.

On `broken`:

```
× does not let user B read any row owned by user A
  → user B received 1 row(s) belonging to another user:
    ["A: card ending 4471, expiry 09/29"]
```

That note is synthetic seed data, not a real card. The suite plants two fake
rows — one per test user — so the isolation failure has recognizable output.

## The reproduced symptom

In this synthetic fixture, an authenticated role has table privileges while
the table lacks the policy file, so cross-user rows are returned. A production
UI might still appear correct if it requests only the current user's rows;
this repository does not model signup, login, a UI, or the Supabase network
path.

## Three configurations worth checking

1. **RLS was never enabled on the table.** If RLS is disabled, a role with the
   required table privileges is not filtered by RLS. Actual exposure still
   depends on grants, role attributes, and API/schema reachability.

2. **RLS is enabled but no policy matches.** PostgreSQL defaults to deny. That
   can prevent exposure but can also break legitimate access; detection time
   depends on monitoring and exercised paths.

3. **A policy exists but RLS was never enabled.** Those policies are not
   enforced. This can be overlooked because policy metadata exists; verify
   grants and API/schema exposure before calling it an externally reachable
   leak.

Disabling (or never enabling) RLS removes the row filter, but that is only half
the exposure story: whether those rows actually reach a caller still depends on
table grants and on whether the table is reachable through an API and exposed
schema. RLS is the row-level gate; grants and API/schema exposure are the gates
around it. This demo pins down the row-level gate in its own fixture.

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

Any row with `rls_enabled = false` is a table where PostgreSQL applies no RLS
row filter to roles subject to RLS. Investigate grants, role attributes, and
API/schema exposure; `policy_count > 0` does not by itself prove an externally
exploitable leak.

## The fix

In this fixture, the complete branch difference is
[`db/policies.sql`](db/policies.sql): one file, added on `fixed` and absent on
`broken`. It enables RLS and adds policies for four operations. These policies
fit this synthetic schema and must be adapted and tested against a real
application's authorization model. See the
[Supabase RLS guide](https://supabase.com/docs/guides/database/postgres/row-level-security)
and the
[PostgreSQL 17 row security docs](https://www.postgresql.org/docs/17/ddl-rowsecurity.html).

Two policy-testing details worth knowing:

- **Incomplete write-policy checks.** For `INSERT` and `UPDATE` policies,
  define and test the appropriate `WITH CHECK` conditions. Exact behavior
  depends on the command and the complete set of policies; this demo uses
  explicit policies per operation.
- **Testing as a role that bypasses RLS.** Table owners normally bypass RLS
  unless `FORCE ROW LEVEL SECURITY` is used; superusers and `BYPASSRLS` roles
  bypass it. This fixture switches to its `authenticated` role so the
  assertions exercise the intended policy path.

## About the test

[`tests/isolation.test.ts`](tests/isolation.test.ts) is byte-for-byte identical
on both branches. The harness sets a synthetic JWT subject claim, switches to
its `authenticated` database role, asks for everything in `public.notes`, and
asserts that nothing owned by user A comes back. It does not perform a real
Supabase Auth sign-in.

It also asserts that user B *can* still read their own row — otherwise
`revoke all` would pass the suite while breaking the fixture. A test that only
checks the door is locked cannot tell you the key still works.

## What this is

A synthetic minimal reproduction of one missing-RLS configuration. It is not
an export from, or audit of, any AI/no-code builder and makes no claim about
those tools' defaults or prevalence.

MIT licensed. Adapt the example to your schema and authorization model, then
retain regression tests that cover your actual roles and access paths.

## Provenance note

This repository is AI-assisted and human-reviewed. Some earlier commit
trailers contain a specific model label inserted by an automated tool; that
label was not independently verified and should not be treated as model
attestation.

## Broader launch review

This repository deliberately covers one synthetic, database-level RLS failure mode; it is not a complete Supabase or application security audit.

If you want the same evidence-first approach applied to your own Next.js +
Supabase authorization model, review the scope of my
[fixed-price Supabase RLS audit](https://cenkkurtoglu.com/supabase-rls-security-audit?utm_source=github&utm_medium=readme&utm_campaign=rls_audit&utm_content=hands_on_review).
The service tests cross-user and cross-tenant access paths and returns
prioritized findings with reproduction notes and remediation guidance. Do not
send production passwords or service-role keys before the project scope and
safe access method are agreed on Upwork.

Before ordering, you can inspect the
[synthetic sample audit report](SAMPLE_AUDIT_REPORT.md) to see the structure,
evidence style, remediation notes and explicit scope limitations. It is not a
client report and contains no real customer or production data.

If you are preparing a Next.js + Supabase release, I also sell a broader [60-check launch checklist with real PDF preview pages](https://cekuu35.github.io/nextjs-supabase-checklist-preview/?utm_source=github&utm_medium=readme&utm_campaign=launch_checklist&utm_content=rls_demo_readme). The complete 8-page PDF is a one-time [$12 purchase on Gumroad](https://cengokurtoglu.gumroad.com/l/xjnmxt?wanted=true&utm_source=github&utm_medium=readme&utm_campaign=launch_checklist&utm_content=rls_demo_readme).

It is a review aid, not a security, compliance, uptime, or launch-outcome guarantee.
