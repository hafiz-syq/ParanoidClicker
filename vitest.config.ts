import { defineConfig } from 'vitest/config';

// Node pool: hanya logika murni (app + shared). Kode worker punya config sendiri.
export default defineConfig({
  test: {
    include: ['src/app/**/*.spec.ts', 'src/shared/**/*.spec.ts'],
    environment: 'node',
  },
});
