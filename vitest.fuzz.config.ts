import { defineConfig } from 'vitest/config'

// The board fuzzer and the slow tests, kept out of the everyday suite so that
// it stays quick.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'node',
    include: ['app/**/*.fuzz.test.ts', 'app/**/*.slow.test.ts'],
  },
})
