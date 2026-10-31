import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import process from 'node:process'
import { fileURLToPath, URL } from 'node:url'

const rootDir = fileURLToPath(new URL('../', import.meta.url))
const reportPath = fileURLToPath(new URL('../vitest-report.json', import.meta.url))
const policiesPath = fileURLToPath(new URL('../db/policies.sql', import.meta.url))
const vitestCli = fileURLToPath(
  new URL('../node_modules/vitest/vitest.mjs', import.meta.url),
)

function fail(message) {
  process.stderr.write(`CI test verification failed: ${message}\n`)
  process.exit(1)
}

// A crashed run must not accidentally validate an older report.
rmSync(reportPath, { force: true })

const testRun = spawnSync(process.execPath, [vitestCli, 'run'], {
  cwd: rootDir,
  stdio: 'inherit',
})

if (testRun.error) {
  fail(`Vitest could not start: ${testRun.error.message}`)
}

if (testRun.signal !== null) {
  fail(`Vitest was terminated by signal ${testRun.signal}`)
}

let report
try {
  report = JSON.parse(readFileSync(reportPath, 'utf8'))
} catch (error) {
  fail(
    `Vitest did not produce a readable JSON report: ${
      error instanceof Error ? error.message : String(error)
    }`,
  )
}

// Each case is branch-local: a test file and the schema it boots. The counts
// per branch state differ by case because some cases exercise the fixed
// path (they pass either way - they document *and* close the hole) while
// others compare against the policies that only the fixed branch carries
// (one test of the pair is red on broken by design, which is the point).
//
// `fixed` / `broken` below are the expected PASSED counts per case.
const CASES = [
  {
    test: 'service-role-leak.test.ts',
    schema: 'schema.service-role.sql',
    fixed: 3,
    broken: 3,
  },
  {
    test: 'definer-view-leak.test.ts',
    schema: 'schema.definer-view.sql',
    fixed: 3,
    broken: 2,
  },
]

const policiesApplied = existsSync(policiesPath)

const base = policiesApplied
  ? { numPassedTests: 5, numFailedTests: 0 }
  : { numPassedTests: 1, numFailedTests: 4 }

let numPassedTests = base.numPassedTests
let numFailedTests = base.numFailedTests

for (const c of CASES) {
  const testApplied = existsSync(fileURLToPath(new URL(`../tests/${c.test}`, import.meta.url)))
  const schemaApplied = existsSync(fileURLToPath(new URL(`../db/${c.schema}`, import.meta.url)))
  if (!testApplied) continue

  // A case test without its schema is not a valid branch state: the harness
  // boots the schema, so its absence is a mistake, not a configuration.
  if (!schemaApplied) {
    fail(`${c.test} is present but db/${c.schema} is not — an inconsistent branch state, not a valid signature`)
  }

  const passed = policiesApplied ? c.fixed : c.broken
  numPassedTests += passed
  numFailedTests += 3 - passed
}

const success = numFailedTests === 0

const expected = {
  exitCode: success ? 0 : 1,
  success,
  numTotalTests: numPassedTests + numFailedTests,
  numPassedTests,
  numFailedTests,
  numPendingTests: 0,
  numTodoTests: 0,
}

const actual = {
  exitCode: testRun.status,
  success: report.success,
  numTotalTests: report.numTotalTests,
  numPassedTests: report.numPassedTests,
  numFailedTests: report.numFailedTests,
  numPendingTests: report.numPendingTests,
  numTodoTests: report.numTodoTests,
}

const mismatches = Object.entries(expected).filter(
  ([key, value]) => actual[key] !== value,
)

if (mismatches.length > 0) {
  fail(
    `unexpected result\nexpected: ${JSON.stringify(expected)}\nactual:   ${JSON.stringify(actual)}`,
  )
}

const state = policiesApplied ? 'fixed' : 'broken'
rmSync(reportPath, { force: true })
process.stdout.write(
  `Verified ${state} state exactly: ${actual.numPassedTests} passed, ` +
    `${actual.numFailedTests} failed, Vitest exit ${actual.exitCode}.\n`,
)
