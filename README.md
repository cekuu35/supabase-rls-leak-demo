# Supabase/Postgres RLS isolation failure: a minimal reproducible example

[![CI](https://github.com/cekuu35/supabase-rls-leak-demo/actions/workflows/ci.yml/badge.svg?branch=fixed)](https://github.com/cekuu35/supabase-rls-leak-demo/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/cekuu35/supabase-rls-leak-demo?label=stable%20release)](https://github.com/cekuu35/supabase-rls-leak-demo/releases/tag/v1.0.0)
[![Isolation tests](https://img.shields.io/badge/isolation%20tests-5%20passing-15803d)](https://github.com/cekuu35/supabase-rls-leak-demo/actions/workflows/ci.yml)

![Supabase RLS negative-test matrix — free, copyable and evidence-first](https://github.com/cekuu35/supabase-rls-leak-demo/releases/download/v1.0.0/rls-matrix-social-card.png)

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
You can also copy the repository's
[ready-to-adapt negative-test matrix](RLS_TEST_MATRIX.md) into your own issue,
pull request or test plan. For the specific misconfigurations that leak data
even when RLS looks enabled in the dashboard, see
[7 ways your Supabase app still leaks data with RLS enabled](https://cenkkurtoglu.com/blog/7-supabase-rls-leak-surfaces?utm_source=github&utm_medium=readme&utm_campaign=rls_kit_launch&utm_content=7_surfaces_link).

Run the free checks first. Supabase ships a database linter that already
catches RLS switched off and RLS switched on with no policy behind it, and the
query further down this page tells you the same thing directly. If that is all
you needed, you are done and you have spent nothing.

### Free: [`audit/rls-audit.sql`](audit/rls-audit.sql)

Nine read-only queries against the system catalogs, MIT, nothing to install
and nothing to send anywhere. Every one is `SELECT`-only, so it is safe to
paste into the Supabase SQL editor on production:

1. RLS coverage per table
2. Every policy in full, **with the roles it actually applies to** — an empty
   roles array means no `TO` clause, so the policy is evaluated for `anon` too
3. The effective write check, and which columns its predicate never mentions
4. What `anon` and `authenticated` can `INSERT`, `UPDATE` and `DELETE`
5. `SECURITY DEFINER` functions the client can call, and whether `search_path`
   is pinned
6. Views that run as their owner rather than the caller
7. Owner bypass, `FORCE ROW LEVEL SECURITY`, and roles holding `BYPASSRLS`
8. Policies calling `auth.uid()` unwrapped, which re-evaluates per row
9. A `BEGIN … ROLLBACK` harness that sets `request.jwt.claims` the way the API
   does, so you can query as a real user without persisting anything

Query 9 is the one people most often get wrong on their own: `set role
authenticated` by itself leaves `request.jwt.claims` unset, `auth.uid()`
returns NULL, every ownership policy filters everything away, and you conclude
a correct policy is broken.

### Free: [`audit/two-user-probe.sql`](audit/two-user-probe.sql)

Query 9 proves you can act as a real user; this one automates the verdict.
Point it at any table with a `user_id`, paste, run: it seeds a row as user A,
probes read/update/delete/cross-user-insert as user B, prints PASS/FAIL per
access path, and — every single run — plants a deliberate `USING (true)`
policy on a scratch table to prove the probe itself would catch the leak it
exists to find. Whole run is one transaction that rolls back; nothing persists,
and any FAIL raises so CI (`psql -v ON_ERROR_STOP=1`) goes red automatically.

What none of those can check is whether a policy that *exists* is actually
correct — a permissive policy silently cancelling a restrictive one, a
membership join that is not isolated, or a service-role key reachable from a
client path. Reading a policy against the schema it guards is manual work, and
there are two ways to get it done.

**[Supabase RLS Audit Kit — $29, one time](https://cengokurtoglu.gumroad.com/l/supabase-rls-audit-kit?utm_source=github&utm_medium=readme&utm_campaign=rls_kit&utm_content=demo_top)**

Seven commented SQL audits you run against your own catalogs — RLS coverage,
policy conflicts, write-side `WITH CHECK` gaps, grants, bypass paths, Storage
and Realtime — plus a role-simulation harness that wraps its probes in
`BEGIN … ROLLBACK`, a 60-check workflow, and report and remediation templates.
Nothing leaves your database and there is nothing to send me.

Would rather not do it yourself? The
[Supabase RLS Security Audit](https://www.upwork.com/services/product/2083862107074689176?utm_source=github&utm_medium=readme&utm_campaign=rls_audit&utm_content=demo_top)
is a fixed-price review from $99 with 2-day delivery: every table and policy
enumerated across SELECT, INSERT, UPDATE and DELETE, anonymous and
authenticated roles, `USING` and `WITH CHECK` gaps, and cross-user or
cross-tenant failure paths, returned as severity-ranked findings with
reproducible proof. Send only sanitized schema and policy SQL — never
production secrets, service-role keys or customer data.

Both are for projects you own or are authorized to test. Neither is a
penetration test, a certification, or a guarantee that an application is
secure.

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
Supabase authorization model, the self-serve option is the
[Supabase RLS Audit Kit](https://cengokurtoglu.gumroad.com/l/supabase-rls-audit-kit?utm_source=github&utm_medium=readme&utm_campaign=rls_kit&utm_content=footer)
at $29 — seven commented SQL audits you run yourself, so nothing leaves your
database. If you would rather have it done, the
[Supabase RLS Security Audit](https://www.upwork.com/services/product/2083862107074689176?utm_source=github&utm_medium=readme&utm_campaign=rls_audit&utm_content=footer)
is fixed-price from $99 with 2-day delivery, covering cross-user and
cross-tenant access paths across every table and policy and returning
prioritized findings with reproduction notes and remediation guidance. Do not
send production passwords, service-role keys or customer data; use sanitized
schema and policy SQL, or an authorized staging or read-only setup.

Before ordering, you can inspect the
[synthetic sample audit report](SAMPLE_AUDIT_REPORT.md) to see the structure,
evidence style, remediation notes and explicit scope limitations. It is not a
client report and contains no real customer or production data.

Not ready to order anything? The ten checks I run before shipping a
Next.js + Supabase app are a
[free 2-page PDF](https://cengokurtoglu.gumroad.com/l/nextjs-supabase-10-checks-free?utm_source=github&utm_medium=readme&utm_campaign=launch_checklist)
— name your own price, or just enter 0 to download it. It is a review aid, not
a security, compliance, uptime, or launch-outcome guarantee.

Built your Supabase app fast — by hand or with an AI coding tool — and want a
go-live pass wider than this one RLS surface? The
[Next.js + Supabase Launch Checklist](https://cengokurtoglu.gumroad.com/l/xjnmxt?utm_source=github&utm_medium=readme&utm_campaign=launch_checklist&utm_content=leak_demo_readme)
is an 8-page PDF, $19, with 60 practical checks across secrets, RLS, auth,
performance, SEO, reliability, monitoring, backups and environment setup. Like
the others here, it is a review aid — not a security, compliance, or
launch-outcome guarantee.

---

> "I built my AI assistant Victorio with Claude ... not having ANY idea about
> the security aspects of this build. Then I got an email from Cenk ... I bought
> Cenk's checklist, and with it Claude was able to plug all my security holes. I
> am very thankful to Cenk — he is amazing, and I highly recommend all founders
> who are not technical to talk to him."
>
> — **Stan Altshuller, Founder & CEO, [Acadia.im](https://www.acadia.im)** — on
> the $19 checklist above, after a live anon-key leak in his AI-built Supabase
> app was found and fixed through exactly this process.

If this fixture (or the free checks above) helped you catch something, a ⭐ on the repo helps other developers find it.
