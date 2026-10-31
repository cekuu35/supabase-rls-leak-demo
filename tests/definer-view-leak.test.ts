import { beforeAll, describe, expect, it } from 'vitest'
import {
  A_PRIVATE_NOTE,
  B_PRIVATE_NOTE,
  USER_B,
  createHarness,
  type Harness,
} from '../src/db.js'

/**
 * Case 1: the SECURITY DEFINER view over a protected table.
 *
 * A view without security_invoker runs with the view owner's privileges, so
 * the base-table policies are bypassed - while pg_policies still shows every
 * policy, correctly configured. This is the failure @Bhanuteja005 flagged in
 * the Vercel Next.js discussion (#96888): the same "green in every UI" mode
 * as the third surface, one layer above the table.
 *
 * The pair here is deliberate: notes_view_definer (the default) and
 * notes_view_invoker (Postgres 15+, security_invoker = on). The first test
 * passes *because* the leak reproduces; that is the fixture's job.
 */

let h: Harness

beforeAll(async () => {
  h = await createHarness()
})

interface NoteRow {
  body: string
  user_id: string
}

describe('SECURITY DEFINER view over the protected table', () => {
  it('exposes user A’s note through a default view, policies notwithstanding', async () => {
    const rows = await h.asUser<NoteRow>(
      USER_B,
      'select body, user_id from public.notes_view_definer',
    )

    expect(
      rows.map((r) => r.body),
      `default view returned no foreign rows - check the fixture seed and that ` +
        `the view was created on this branch: ${JSON.stringify(rows)}`,
    ).toContain(A_PRIVATE_NOTE)
  })

  it('does not expose user A’s note when the view is security_invoker', async () => {
    const rows = await h.asUser<NoteRow>(
      USER_B,
      'select body, user_id from public.notes_view_invoker',
    )

    expect(
      rows.map((r) => r.body),
      `security_invoker view returned ${rows.length} foreign row(s) - the base ` +
        `policies should apply as the caller: ${JSON.stringify(rows.map((r) => r.body))}`,
    ).not.toContain(A_PRIVATE_NOTE)

    expect(rows.filter((r) => r.user_id !== USER_B)).toHaveLength(0)
  })

  it('still returns the caller’s own note through the invoker view', async () => {
    // The fix must not degenerate into a view that returns nothing.
    const rows = await h.asUser<NoteRow>(
      USER_B,
      'select body, user_id from public.notes_view_invoker',
    )

    expect(rows.map((r) => r.body)).toContain(B_PRIVATE_NOTE)
  })
})
