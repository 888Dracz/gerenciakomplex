import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  define: { __MODO_WEB__: 'true' },
  resolve: {
    alias: {
      '@dominio': fileURLToPath(new URL('./server/src/dominio', import.meta.url)),
      '@backend': fileURLToPath(new URL('./web/src/local/servidor.ts', import.meta.url)),
    },
  },
  test: {
    include: ['server/src/**/*.test.ts', 'web/src/**/*.test.ts'],
    environment: 'node',
  },
});
