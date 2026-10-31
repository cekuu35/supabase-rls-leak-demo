import { beforeAll, describe, expect, it } from 'vitest'
import { USER_A, USER_B, createHarness, type Harness } from '../src/db.js'

/**
 * Case 3: the service-role path with a client-supplied id.
 *
 * This case goes red on both branches of the broken/fixed pair, because it
 * is not a policy bug. A server action that takes an id from the client and
 * looks the row up with the service-role credential runs as service_role,
 * which bypasses RLS by design — and no policy file on public.orders changes
 * that. The two functions in db/schema.service-role.sql differ by exactly
 * one condition, and this file pins both directions down.
 *
 * The first test documents the exposure: it passes *because* the unchecked
 * action returns another user's row. That is the whole point of the fixture —
 * the failure is reproducible in one command rather than described.
 */

let h: Harness

beforeAll(async () => {
  h = await createHarness()
})

interface OrderRow {
  id: string
  user_id: string
  total: number
}

/** User A's order, fetched by id, so the assertions can name it. */
async function userAOrderId(): Promise<string> {
  const rows = await h.asService<OrderRow>(
    USER_A,
    'select id, user_id, total from public.orders where user_id = $1 limit 1',
    [USER_A],
  )
  if (!rows[0]) throw new Error('fixture seed missing: user A has no order')
  return rows[0].id
}

describe('service-role server action with a client-supplied id', () => {
  it('exposes another user’s order when the action trusts the client id', async () => {
    const orderId = await userAOrderId()

    // The unchecked action is called by user B, with user A's order id.
    const rows = await h.asService<OrderRow>(
      USER_B,
      'select * from public.get_order_unchecked($1)',
      [orderId],
    )

    expect(
      rows.length,
      'unchecked action returned no row — the fixture would no longer ' +
        'demonstrate the exposure, check the seed data',
    ).toBeGreaterThan(0)

    expect(
      rows.map((r) => r.user_id),
      `unchecked action returned rows belonging to ${rows.map((r) => r.user_id).join(', ')} — expected user A's order to be reachable`,
    ).toContain(USER_A)
  })

  it('does not expose another user’s order when the action checks the caller', async () => {
    const orderId = await userAOrderId()

    const rows = await h.asService<OrderRow>(
      USER_B,
      'select * from public.get_order_checked($1)',
      [orderId],
    )

    expect(
      rows,
      `checked action returned user A's order to user B: ${JSON.stringify(rows)}`,
    ).toHaveLength(0)
  })

  it('still returns the caller’s own order through the checked action', async () => {
    // The fix has to close the hole without disabling the feature, so the
    // own-order case has to keep working — the same two-direction check the
    // isolation suite applies to reads.
    const own = await h.asService<OrderRow>(
      USER_B,
      'select id from public.orders where user_id = $1 limit 1',
      [USER_B],
    )
    if (!own[0]) throw new Error('fixture seed missing: user B has no order')

    const rows = await h.asService<OrderRow>(
      USER_B,
      'select * from public.get_order_checked($1)',
      [own[0].id],
    )

    expect(rows.map((r) => r.user_id)).toContain(USER_B)
  })
})
