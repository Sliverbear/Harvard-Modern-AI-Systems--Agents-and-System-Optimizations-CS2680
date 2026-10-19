import { defineConfig } from '@playwright/test';
import path from 'node:path';

// E2E tests run against replay fixtures and a test-double CLI: no model usage.
const PORT = 5199;
const fake = path.resolve('tests/fake-claude/fake-claude.mjs');

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'logs/playwright-results.json' }]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    launchOptions: { executablePath: process.env.PW_CHROMIUM || undefined },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npx vite build && npx tsx server/index.ts',
    url: `http://127.0.0.1:${PORT}/api/config`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      MADS_PORT: String(PORT),
      MADS_DATA_DIR: 'test-results/e2e-data',
      MADS_CLAUDE_BIN: fake,
      FAKE_SCENARIO: 'fixture',
      FAKE_FIXTURE: path.resolve('fixtures/real/multistep.jsonl'),
    },
  },
});
