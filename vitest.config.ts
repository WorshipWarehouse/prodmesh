import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { helpContent } from './vite-plugin-help.js';

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // The help plugin is needed here too: it provides `virtual:help-content`,
  // which AppShell reaches through the Help drawer. Without it any test that
  // renders the shell fails to resolve the import.
  plugins: [react(), helpContent(join(here, 'docs', 'wiki'))],
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    restoreMocks: true,
  },
});
