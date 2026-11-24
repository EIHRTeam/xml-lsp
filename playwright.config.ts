import { defineConfig } from '@playwright/test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const port = Number(process.env.XML_LSP_EXAMPLE_PORT ?? 4173)
const baseURL = `http://127.0.0.1:${port}`
export default defineConfig({
  testDir: './tests/browser',
  outputDir: join(tmpdir(), 'skland-xml-playwright-results'),
  projects: [
    {
      name: 'web',
      testMatch: ['parity.spec.ts', 'web.spec.ts'],
      use: { baseURL, browserName: 'chromium', channel: 'chromium' },
    },
    { name: 'mv3', testMatch: 'mv3.spec.ts' },
  ],
  webServer: {
    command: 'node tooling/serve-examples.ts',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
  },
})
