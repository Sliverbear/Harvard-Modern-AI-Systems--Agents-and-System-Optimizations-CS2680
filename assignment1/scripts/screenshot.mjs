// Take a screenshot of a replayed fixture (dev helper; needs a running server).
// usage: node scripts/screenshot.mjs [fixture] [out.png] [width] [dark]
// Set PW_CHROMIUM to a Chromium executable if Playwright's bundled browser is not installed.
import { chromium } from '@playwright/test';

const [, , fixture = 'real/subagent.jsonl', out = 'demo/screenshot.png', w = '1400', dark = ''] = process.argv;
const port = process.env.MADS_PORT ?? 5174;
const b = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
const p = await b.newPage({ viewport: { width: +w, height: 900 }, colorScheme: dark ? 'dark' : 'light' });
const errs = [];
p.on('pageerror', (e) => errs.push(e.message));
p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
await p.goto(`http://127.0.0.1:${port}/`);
await p.getByRole('tab', { name: 'Replay' }).click();
await p.selectOption('#fixture', fixture);
await p.selectOption('#speed', 'instant');
await p.getByTestId('start-replay').click();
await p.waitForTimeout(2500);
await p.screenshot({ path: out });
console.log(`saved ${out}; page errors: ${errs.length ? errs.join(' | ') : 'none'}`);
await b.close();
