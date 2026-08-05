# Supabase RLS negative-test matrix

> Copy this into an issue, pull request or test plan and adapt it to your actual
> schema, roles and product rules. It is a review aid, not proof that a project
> is secure.

## 1. Inventory the boundary

Record each object reachable through the application or Data API.

| Object | Anonymous access intended? | Authenticated role | Ownership key | Tenant key | Privileged path |
|---|---|---|---|---|---|
| `public.example` | No | `authenticated` | `user_id` | `organization_id` | Server-only job |

Confirm separately:

- RLS is enabled on every applicable table.
- Grants match the API roles that can reach the object.
- Views, functions/RPCs, storage buckets and Realtime paths are reviewed where used.
- Secret or service-role keys never enter browser code, public logs or client bundles.

## 2. Seed distinct identities

Use synthetic data for at least:

- anonymous caller;
- user A in tenant A;
- user B in tenant A;
- user C in tenant B; and
- the minimum privileged server path, tested separately from user-facing RLS.

Do not reuse one session for every assertion. Each identity needs its own token
or database role context so the test actually crosses the authorization
boundary.

## 3. Negative-test matrix

Fill one matrix per protected object. `Denied` can mean an authorization error
or an empty result, depending on the operation and client contract.

| Caller and target | SELECT | INSERT | UPDATE | DELETE | Expected result |
|---|---:|---:|---:|---:|---|
| Anonymous → private row | ☐ | ☐ | ☐ | ☐ | Denied |
| User A → own row | ☐ | ☐ | ☐ | ☐ | Allowed only where intended |
| User A → user B row, same tenant | ☐ | ☐ | ☐ | ☐ | Denied unless explicitly shared |
| User A → tenant B row | ☐ | ☐ | ☐ | ☐ | Denied |
| User A inserts row owned by B | N/A | ☐ | N/A | N/A | Denied by `WITH CHECK` |
| User A changes ownership/tenant key | N/A | N/A | ☐ | N/A | Denied by `WITH CHECK` |
| Removed member → former tenant row | ☐ | ☐ | ☐ | ☐ | Denied |
| Expired invitation → tenant row | ☐ | ☐ | ☐ | ☐ | Denied |

Add product-specific cases for admin, support, invitation, suspension,
soft-delete and shared-resource behavior. A generic matrix cannot decide those
business rules for you.

## 4. Avoid false passes

- Pair every denial assertion with a legitimate self-access assertion. A
  blanket revoke should not look like a correct policy.
- Test writes as well as reads. `USING` and `WITH CHECK` cover different parts
  of write behavior.
- Run the test through the same client/JWT roles used by the application.
- Do not validate user-facing RLS with a service-role key, table owner,
  superuser or role carrying `BYPASSRLS`.
- Assert affected row counts and returned ownership/tenant keys, not only the
  absence of a thrown error.

## 5. Evidence to retain

For each failure or pass, keep:

- object and operation;
- caller identity/role (synthetic identifier only);
- expected versus actual result;
- minimal reproduction command or test name;
- relevant grant and policy definition;
- remediation commit; and
- regression-test output after the fix.

Never put production passwords, service-role keys, customer records or other
secrets into an issue, report or chat.

## 6. Example and next steps

- Run the [public five-test isolation fixture](https://github.com/cekuu35/supabase-rls-leak-demo).
- Read [How to test Supabase RLS policies before launch](https://cenkkurtoglu.com/blog/how-to-test-supabase-rls-policies?utm_source=github&utm_medium=test_matrix&utm_campaign=rls_audit&utm_content=guide).
- Inspect the [synthetic sample audit report](SAMPLE_AUDIT_REPORT.md).
- For a scoped review of your own authorization model, see the [fixed-price Supabase RLS audit](https://cenkkurtoglu.com/supabase-rls-security-audit?utm_source=github&utm_medium=test_matrix&utm_campaign=rls_audit&utm_content=service).

The audit reduces uncertainty within an agreed scope; it is not a security,
compliance, uptime or breach-prevention guarantee.
