import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Unit tests for pure logic (tests/unit). No Nuxt runtime: the Nuxt
// aliases point at the real folders, and the few auto-imports the code
// under test touches are shimmed in tests/unit/setup.ts. E2E tests live
// in tests/e2e and run with Playwright (playwright.config.ts).
const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '#shared': r('./shared'),
      '~~': r('.'),
      '~': r('./app'),
      '#supabase/server': r('./tests/unit/stubs/supabase-server.ts'),
      '#imports': r('./tests/unit/stubs/imports.ts'),
    },
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['tests/unit/setup.ts'],
  },
})
