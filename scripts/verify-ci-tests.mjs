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

const expected = policiesApplied
  ? {
      exitCode: 0,
      success: true,
      numTotalTests: 5,
      numPassedTests: 5,
      numFailedTests: 0,
      numPendingTests: 0,
      numTodoTests: 0,
    }
  : {
      exitCode: 1,
      success: false,
      numTotalTests: 5,
      numPassedTests: 1,
      numFailedTests: 4,
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
