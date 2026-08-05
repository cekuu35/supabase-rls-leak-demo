# Sample Supabase RLS audit report

> **Synthetic example — not a client report.** This document uses only the
> deliberately vulnerable fixture in this repository. It does not describe a
> real company, production database, Supabase project, customer record, or
> discovered vulnerability.

## 1. Executive summary

The reviewed fixture models a `public.notes` table with two synthetic users.
On the `broken` branch, the authenticated database role has table privileges
while Row Level Security is not enabled. The same five-test suite demonstrates
that one user can read, insert, update, and delete rows belonging to another
user. On the `fixed` branch, RLS and operation-specific ownership policies
restore the intended boundary while preserving access to the current user's
own row.

| Severity | Finding | Status in fixture |
|---|---|---|
| High | Cross-user row access because the table has no enforced RLS boundary | Reproduced on `broken`; remediated on `fixed` |
| Informational | Policy regression coverage for SELECT, INSERT, UPDATE and DELETE | Five tests pass on `fixed` |

## 2. Scope

Included in this synthetic review:

- `public.notes`
- `authenticated` database role
- Synthetic JWT subject claim used by the local test harness
- SELECT, INSERT, UPDATE and DELETE ownership paths
- `db/policies.sql` on the `fixed` branch

Not included:

- A live Supabase project or production data
- Supabase Auth sign-in behavior
- PostgREST/Data API exposure
- Storage, Realtime, Edge Functions, RPCs or network controls
- Secret scanning, compliance assessment or penetration testing

## 3. Finding RLS-001 — cross-user row access

**Severity:** High in this fixture  
**Affected object:** `public.notes`  
**Security property:** An authenticated user must only access rows they own.

### Evidence

The test suite seeds one synthetic row for user A and one for user B, switches
to the fixture's `authenticated` role, and sets user B's synthetic subject
claim. On the `broken` branch:

- user B can read user A's row;
- user B can insert a row owned by user A;
- user B can modify user A's row; and
- user B can delete user A's row.

The raw test command exits non-zero with four failed isolation assertions and
one passing self-access assertion. The self-access check matters because a
blanket revoke could otherwise make the negative tests pass while breaking the
application.

### Root cause

The authenticated role has table privileges, but the `broken` branch does not
apply an RLS policy file. PostgreSQL therefore applies no row filter to this
role for the reviewed table. Whether the same configuration is externally
reachable in a real application would additionally depend on grants, role
attributes, exposed schemas and API paths.

### Remediation demonstrated in the fixture

The `fixed` branch adds `db/policies.sql`, which:

1. enables Row Level Security on `public.notes`;
2. defines an ownership condition for reads and deletes;
3. defines appropriate ownership checks for inserts and updates; and
4. retains legitimate self-access.

These policies are specific to the synthetic schema. A real remediation must
be adapted to the application's organization model, roles, invitation flow,
admin behavior, service processes and storage/API paths.

### Verification

On the current `fixed` branch:

```text
Test Files  1 passed (1)
Tests       5 passed (5)
```

The five checks confirm that user B cannot read, insert, update or delete user
A's rows and can still read their own row.

## 4. Example production follow-up checklist

A real audit would continue beyond this fixture and validate, where included
in the agreed scope:

- which tables and views are reachable through the public API;
- anonymous versus authenticated grants and policies;
- organization membership changes and invitation acceptance;
- admin, support and service-role boundaries;
- SECURITY DEFINER functions and callable RPCs;
- storage object paths and bucket policies;
- Realtime publication and subscription behavior; and
- regression tests using the application's actual roles and ownership model.

## 5. Handling and limitations

- Do not send production passwords or service-role keys in chat.
- Share only the minimum schema, policy and test context agreed in the project.
- Findings are limited to the reviewed scope and evidence available at review
  time.
- An audit reduces uncertainty; it is not a security, compliance, uptime or
  breach-prevention guarantee.

For the live service scope, see the
[Supabase RLS security audit](https://cenkkurtoglu.com/supabase-rls-security-audit?utm_source=github&utm_medium=sample_report&utm_campaign=rls_audit).

For a reusable negative-test matrix before launch, read
[How to test Supabase RLS policies](https://cenkkurtoglu.com/blog/how-to-test-supabase-rls-policies?utm_source=github&utm_medium=sample_report&utm_campaign=rls_audit&utm_content=testing_guide).
