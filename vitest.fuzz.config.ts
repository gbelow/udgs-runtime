import { defineConfig } from 'vitest/config'

// The board fuzzer and the slow tests, kept out of the everyday suite so that
// it stays quick.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'node',
    include: ['app/**/*.fuzz.test.ts', 'app/**/*.slow.test.ts'],
    // a session of the house crowd takes about 5 s on a busy machine, the
    // default limit, so a slow run would fail on time rather than on a finding
    testTimeout: 20000,
  },
})
