import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'

const here = dirname(fileURLToPath(import.meta.url))
const dbDir = join(here, '..', 'db')

const SCHEMA_SQL = join(dbDir, 'schema.sql')
const POLICIES_SQL = join(dbDir, 'policies.sql')

/** Fixed test identities, so the assertions can name them. */
export const USER_A = '11111111-1111-1111-1111-111111111111'
export const USER_B = '22222222-2222-2222-2222-222222222222'

/** A row only user A should ever be able to read. */
export const A_PRIVATE_NOTE = 'A: card ending 4471, expiry 09/29'
export const B_PRIVATE_NOTE = 'B: pick up dry cleaning'

export interface Harness {
  db: PGlite
  /** True when db/policies.sql was present and applied. */
  policiesApplied: boolean
  /**
   * Run a query the way supabase-js runs one for a signed-in user:
   * as the `authenticated` role, with the caller's id on the request context.
   */
  asUser: <T = Record<string, unknown>>(
    userId: string,
    sql: string,
    params?: unknown[],
  ) => Promise<T[]>
}

/**
 * Boot an in-memory Postgres, apply the schema, and apply the policies if
 * this branch has them.
 *
 * PGlite is real Postgres compiled to WebAssembly, so row-level security here
 * is the same row-level security Supabase runs. No Docker, no cloud project,
 * no credentials — which is the point: anyone can reproduce this in one command.
 */
export async function createHarness(): Promise<Harness> {
  const db = await PGlite.create()

  await db.exec(await readFile(SCHEMA_SQL, 'utf8'))

  const policiesApplied = existsSync(POLICIES_SQL)
  if (policiesApplied) {
    await db.exec(await readFile(POLICIES_SQL, 'utf8'))
  }

  await db.query(
    `insert into public.notes (user_id, body) values ($1, $2), ($3, $4)`,
    [USER_A, A_PRIVATE_NOTE, USER_B, B_PRIVATE_NOTE],
  )

  const asUser = async <T = Record<string, unknown>>(
    userId: string,
    sql: string,
    params: unknown[] = [],
  ): Promise<T[]> => {
    // A transaction is used so `set local` reverts afterwards and one
    // caller's identity cannot leak into the next assertion.
    await db.exec('begin')
    try {
      await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId])
      // Drop from the owner role to the app role. The table owner bypasses RLS
      // by design, so testing as the owner would prove nothing.
      await db.exec('set local role authenticated')
      const result = await db.query<T>(sql, params)
      return result.rows
    } finally {
      await db.exec('rollback')
    }
  }

  return { db, policiesApplied, asUser }
}
