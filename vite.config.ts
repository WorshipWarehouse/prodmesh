import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { helpContent } from './vite-plugin-help.js'

const here = dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // Renders docs/wiki/*.md to HTML at BUILD time, so the in-app Help drawer
    // works with no internet and ships no markdown parser. Same source files
    // as the public docs site, so the two cannot drift apart.
    helpContent(join(here, 'docs', 'wiki')),
  ],
  server: {
    // Forward API calls to the Express backend during development.
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
})
