import { beforeAll, describe, expect, it } from 'vitest'
import {
  A_PRIVATE_NOTE,
  B_PRIVATE_NOTE,
  USER_A,
  USER_B,
  createHarness,
  type Harness,
} from '../src/db.js'

/**
 * This file is byte-for-byte identical on the `broken` and `fixed` branches.
 * The only difference between those branches is whether db/policies.sql exists.
 *
 * On `broken` these tests fail: user B reads user A's rows and can write rows
 * belonging to user A.
 * On `fixed` they pass.
 *
 * A passing run means the data is isolated. Read the assertions rather than
 * trusting that sentence.
 */

let h: Harness

beforeAll(async () => {
  h = await createHarness()
  // eslint-disable-next-line no-console
  console.log(
    h.policiesApplied
      ? 'db/policies.sql found and applied  -> expecting isolation'
      : 'db/policies.sql absent             -> expecting a leak',
  )
})

interface NoteRow {
  body: string
  user_id: string
}

describe('tenant isolation on public.notes', () => {
  it('does not let user B read any row owned by user A', async () => {
    const rows = await h.asUser<NoteRow>(USER_B, 'select body, user_id from public.notes')

    const foreign = rows.filter((r) => r.user_id !== USER_B)

    // The whole demo is this assertion. On `broken` it receives user A's
    // private note and fails.
    expect(
      foreign,
      `user B received ${foreign.length} row(s) belonging to another user: ` +
        JSON.stringify(foreign.map((r) => r.body)),
    ).toHaveLength(0)

    expect(rows.map((r) => r.body)).not.toContain(A_PRIVATE_NOTE)
  })

  it('still lets user B read their own row', async () => {
    // Guards against a "fix" that simply denies everything. Locking the table
    // shut would satisfy the test above while breaking the product, so the
    // suite has to pin down both directions.
    const rows = await h.asUser<NoteRow>(USER_B, 'select body, user_id from public.notes')

    expect(rows.map((r) => r.body)).toContain(B_PRIVATE_NOTE)
  })

  it('does not let user B insert a row owned by user A', async () => {
    // Read policies without WITH CHECK are a common half-fix: selects get
    // locked down, writes stay open.
    await expect(
      h.asUser(
        USER_B,
        `insert into public.notes (user_id, body) values ($1, $2)`,
        [USER_A, 'planted by B'],
      ),
    ).rejects.toThrow()
  })

  it('does not let user B modify user A’s row', async () => {
    const updated = await h.asUser<NoteRow>(
      USER_B,
      `update public.notes set body = $1 where user_id = $2 returning body, user_id`,
      ['overwritten by B', USER_A],
    )

    expect(
      updated,
      `user B updated ${updated.length} row(s) belonging to user A`,
    ).toHaveLength(0)
  })

  it('does not let user B delete user A’s row', async () => {
    const deleted = await h.asUser<NoteRow>(
      USER_B,
      `delete from public.notes where user_id = $1 returning body, user_id`,
      [USER_A],
    )

    expect(
      deleted,
      `user B deleted ${deleted.length} row(s) belonging to user A`,
    ).toHaveLength(0)
  })
})
