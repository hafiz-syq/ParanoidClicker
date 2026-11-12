import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      // true = memanggil Cloudflare asli dan butuh akun/login; spike ini harus jalan offline.
      remoteBindings: false,
    }),
  ],
  test: {
    include: ['src/worker/**/*.spec.ts'],
  },
});
