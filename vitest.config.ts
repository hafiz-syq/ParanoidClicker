import { defineConfig } from 'vitest/config';

// Node pool: hanya logika murni (app + shared) + gerbang bukti tooling (scripts).
// scripts/gerbang.spec.ts ikut di sini supaya penjaga README dan penjaga ikon tidak bisa
// lagi "dijanjikan tapi tidak pernah dijalankan" — lihat komentar di file itu.
export default defineConfig({
  test: {
    include: ['src/app/**/*.spec.ts', 'src/shared/**/*.spec.ts', 'scripts/gerbang.spec.ts'],
    environment: 'node',
  },
});
