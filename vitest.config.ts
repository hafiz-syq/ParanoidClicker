import { defineConfig } from 'vitest/config';

// Node pool: hanya logika murni (app + shared) + gerbang bukti tooling (scripts). Pola `scripts`
// dibuat wildcard supaya spec baru tidak bisa lolos dari `npm run check` hanya karena lupa
// didaftarkan di sini.
export default defineConfig({
  test: {
    include: ['src/app/**/*.spec.ts', 'src/shared/**/*.spec.ts', 'scripts/**/*.spec.ts'],
    environment: 'node',
  },
});
