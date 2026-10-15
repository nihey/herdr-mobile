import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  resolve: {
    alias: {
      graphql: fileURLToPath(
        new URL('./node_modules/graphql/index.js', import.meta.url),
      ),
    },
  },
  test: {
    include: ['bridge/src/**/*.test.ts', 'mobile/src/**/*.test.ts'],
    testTimeout: 10000,
  },
});
