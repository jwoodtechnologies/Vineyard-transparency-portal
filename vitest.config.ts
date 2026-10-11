import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The Worker bundles migrations as text (wrangler rules); tests that import the ask handler need the same.
  plugins: [{ name: 'sql-as-text', transform: (code: string, id: string) => (id.endsWith('.sql') ? { code: `export default ${JSON.stringify(code)};`, map: null } : undefined) }],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
