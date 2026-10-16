import { defineConfig } from 'vitest/config'

// The board fuzzer, kept out of the everyday suite so that it stays quick.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'node',
    include: ['app/**/*.fuzz.test.ts'],
  },
})
