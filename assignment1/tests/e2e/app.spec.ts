import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Cost of the last result event in a fixture, formatted like the UI ($0.0035 / $1.23). */
function costOf(rel: string): string {
  const lines = fs.readFileSync(path.resolve('fixtures', rel), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const v = lines.filter((l) => l.type === 'result').at(-1).total_cost_usd as number;
  return v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`;
}
const sessionOf = (rel: string) => fs.readFileSync(path.resolve('fixtures', rel), 'utf8').match(/"session_id":\s*"([^"]+)"/)![1];

async function replay(page: Page, fixture: string, speed = 'instant') {
  await page.goto('/');
  await page.getByRole('tab', { name: 'Replay' }).click();
  await page.selectOption('#fixture', fixture);
  await page.selectOption('#speed', speed);
  await page.getByTestId('start-replay').click();
}

test('replayed subagent run: REPLAY label, nested tree, collapsible group, outline click-to-scroll', async ({ page }) => {
  await replay(page, 'synthetic/parallel-nested-subagents.jsonl');
  await expect(page.locator('[data-run-status="finished"]').first()).toBeVisible();
  await expect(page.getByText('REPLAY').first()).toBeVisible();

  // Nested subagent: the Read call lives inside Agent(toolu_a) > Agent(toolu_a2)
  const outer = page.locator('[data-subagent-group="toolu_a"]');
  await expect(outer).toBeVisible();
  const nestedRead = page.locator('[data-subagent-group="toolu_a2"] [data-tool-name="Read"]');
  await expect(nestedRead).toBeVisible();

  // Collapse the outer group: summary stays visible, children are hidden.
  await outer.getByRole('button', { name: /Subagent/ }).first().click();
  await expect(outer.getByText(/5 events, 3 tools/)).toBeVisible();
  await expect(nestedRead).toBeHidden();

  // Outline click expands collapsed ancestors, scrolls to and highlights the call.
  await page.locator('aside [data-outline-key$=":tool:toolu_a2x"]').click();
  const target = page.locator('[data-node-key$=":tool:toolu_a2x"]');
  await expect(target).toBeVisible();
  await expect(target).toHaveAttribute('data-highlighted', 'true');
  await expect(target).toBeInViewport();
});

test('edge cases: folding, error result, malformed + unknown rows, missing result => failed, pending => no result', async ({ page }) => {
  await replay(page, 'synthetic/edge-malformed-unknown-noresult.jsonl');
  const card = page.getByTestId('run-card').first();
  await expect(card.locator('[data-run-status="failed"]')).toBeVisible();
  await expect(card.getByTestId('run-error')).toContainText('without a result event');
  await expect(card.getByTestId('run-error')).toContainText('exit code: 1');

  const bash = card.locator('[data-tool-name="Bash"]');
  const out = bash.getByTestId('tool-output');
  await expect(out).not.toContainText('line 120:');
  await bash.getByRole('button', { name: /110 more lines/ }).click();
  await expect(out).toContainText('line 120:');

  await expect(card.locator('[data-tool-name="Read"]').first().locator('[data-status="error"]')).toBeVisible();
  await expect(card.locator('[data-tool-name="Read"]').nth(1).locator('[data-status="no_result"]')).toBeVisible();
  await expect(card.locator('[data-raw-reason="malformed"]')).toHaveCount(2);
  await expect(card.getByText(/raw event · mystery_event/)).toBeVisible();
  await expect(card.locator('.md strong', { hasText: 'markdown' })).toBeVisible();
  await expect(card.locator('.md pre code')).toContainText("print('hi')");
});

test('multi-run replay: earlier run folds, resumed label, metrics; results persist after reload', async ({ page }) => {
  await replay(page, 'real/resumed-session');
  await expect(page.getByTestId('run-card')).toHaveCount(2);
  await expect(page.getByTestId('run-card').locator('header [data-run-status="finished"]')).toHaveCount(2, { timeout: 15000 });
  const [first, second] = [page.getByTestId('run-card').nth(0), page.getByTestId('run-card').nth(1)];
  await expect(second.getByTestId('resumed-label')).toContainText('resumed session');
  await expect(first.getByTestId('trajectory')).toHaveCount(0); // folded by default
  await expect(second.getByTestId('metrics')).toContainText(costOf('real/resumed-session/run-2.jsonl'));
  await expect(second.getByTestId('metrics')).toContainText(sessionOf('real/resumed-session/run-1.jsonl').slice(0, 8));

  await page.reload();
  await expect(page.getByTestId('run-card')).toHaveCount(2);
  await expect(page.getByTestId('run-card').nth(1).locator('[data-tool-name="Edit"]')).toBeVisible();
});

test('submit a prompt (test-double CLI), Ctrl+Enter, follow-up resumes with cwd locked; invalid dir shows error', async ({ page }) => {
  await page.goto('/');
  await page.fill('#cwd', os.tmpdir());
  await page.fill('#prompt', 'fix the failing test');
  await page.press('#prompt', 'Control+Enter');
  const card = page.getByTestId('run-card').first();
  await expect(card.locator('[data-run-status="finished"]')).toBeVisible();
  await expect(card.getByTestId('metrics')).toContainText(costOf('real/multistep.jsonl'));
  await expect(page.locator('#cwd')).toBeDisabled();

  await page.fill('#prompt', 'now update the README');
  await page.getByTestId('run').click();
  await expect(page.getByTestId('run-card')).toHaveCount(2);
  await expect(page.getByTestId('run-card').nth(1).getByTestId('resumed-label')).toBeVisible();
  await expect(page.getByTestId('run-card').nth(1).locator('[data-run-status="finished"]')).toBeVisible();

  await page.getByTestId('new-session').click();
  await page.fill('#cwd', '/definitely/not/here');
  await page.fill('#prompt', 'hello');
  await page.getByTestId('run').click();
  await expect(page.getByTestId('run-error')).toContainText('does not exist');
});

test('narrow window: outline is a drawer, no horizontal scroll', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await replay(page, 'real/subagent.jsonl');
  await expect(page.locator('[data-run-status="finished"]').first()).toBeVisible();
  await expect(page.locator('aside')).toBeHidden();
  await page.getByRole('button', { name: 'Show outline' }).click();
  const drawer = page.getByRole('dialog', { name: 'Outline' });
  await expect(drawer.getByTestId('outline')).toBeVisible();
  await drawer.locator('[data-outline-key]').first().click();
  await expect(drawer).toBeHidden();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
