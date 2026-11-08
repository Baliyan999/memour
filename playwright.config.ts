import { defineConfig, devices } from '@playwright/test'
import { BASE_URL } from './tests/e2e/harness/env'

/**
 * E2E smoke tests (tests/e2e): the BUILT app (`pnpm build` first) against
 * a local Supabase, every outbound SMS / Telegram call mocked. Setup,
 * env variables and how to add a scenario: CONTRIBUTING.md → Tests.
 */
export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  // One app process holds the in-memory rate limits for the whole run;
  // the suite is small, so one worker keeps it predictable.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(process.env.E2E_CHROMIUM_CHANNEL ? { channel: process.env.E2E_CHROMIUM_CHANNEL } : {}),
      },
    },
  ],
})
