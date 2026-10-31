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

const policiesApplied = existsSync(policiesPath)

// Case 3 (the service-role path) is a branch-local pair: the test file and
// the schema file it boots. The broken and fixed branches of the original
// pair have neither; the branch that carries the case has both. The keying
// file is the test — it is what enters vitest's total. If the test is
// present without the schema, its beforeAll throws and the three tests fail,
// which is exactly what verification should refuse to pass: an inconsistent
// branch state is not a valid signature.
const case3TestApplied = existsSync(
  fileURLToPath(new URL('../tests/service-role-leak.test.ts', import.meta.url)),
)
const case3SchemaApplied = existsSync(
  fileURLToPath(new URL('../db/schema.service-role.sql', import.meta.url)),
)
const case3 = case3TestApplied
  ? { numPassedTests: case3SchemaApplied ? 3 : 0, numFailedTests: case3SchemaApplied ? 0 : 3 }
  : { numPassedTests: 0, numFailedTests: 0 }

const base = policiesApplied
  ? { numPassedTests: 5, numFailedTests: 0 }
  : { numPassedTests: 1, numFailedTests: 4 }

// A case-3 test file without its schema is not a valid branch state: the
// harness boots the schema, so its absence is a mistake, not a
// configuration. Refuse to score it rather than bake the mistake in.
if (case3TestApplied && !case3SchemaApplied) {
  fail(
    'tests/service-role-leak.test.ts is present but db/schema.service-role.sql is not — ' +
      'an inconsistent branch state, not a valid signature',
  )
}

const numPassedTests = base.numPassedTests + case3.numPassedTests
const numFailedTests = base.numFailedTests + case3.numFailedTests
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
