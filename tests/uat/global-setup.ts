import { mkdirSync, writeFileSync } from 'fs'
import { dirname } from 'path'

/**
 * Seeds a Playwright storageState file so every browser context starts with
 * the backend API token already in localStorage (the same place the
 * ApiTokenGate component stores it). Without this, an auth-enabled UAT
 * backend would 401 every page-level fetch and the token gate would block
 * the UI.
 */
export default async function globalSetup() {
  const baseURL = process.env.UAT_BASE_URL || 'http://127.0.0.1:3000'
  const token = process.env.UAT_API_TOKEN || ''
  const statePath = 'test-results/uat-storage-state.json'

  const state = {
    cookies: [],
    origins: token
      ? [
          {
            origin: baseURL,
            localStorage: [{ name: 'alpha-edge-api-token', value: token }],
          },
        ]
      : [],
  }

  mkdirSync(dirname(statePath), { recursive: true })
  writeFileSync(statePath, JSON.stringify(state, null, 2))
}
