import { defineConfig, devices } from '@playwright/test'

// Backend auth: APIRequestContext calls (webhooks, fixtures, helpers) carry a
// bearer token via extraHTTPHeaders. Legacy browsers use localStorage seeded in
// tests/uat/global-setup.ts. Set UAT_API_TOKEN to match the backend's
// API_TOKEN env (or run the UAT backend with AUTH_DISABLED=true locally).
const uatApiToken = process.env.UAT_API_TOKEN || ''

export default defineConfig({
  testDir: './tests/uat',
  timeout: 60_000,
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  reporter: [['list']],
  globalSetup: './tests/uat/global-setup.ts',
  use: {
    baseURL: process.env.UAT_BASE_URL || 'http://127.0.0.1:3000',
    trace: 'on-first-retry',
    storageState: 'test-results/uat-storage-state.json',
    ...(uatApiToken
      ? { extraHTTPHeaders: { Authorization: `Bearer ${uatApiToken}` } }
      : {}),
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
