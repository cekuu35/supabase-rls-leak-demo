import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // PGlite boots a WebAssembly Postgres; give it room on a cold CI runner.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    reporters: ['verbose', 'json'],
    outputFile: { json: './vitest-report.json' },
  },
})
