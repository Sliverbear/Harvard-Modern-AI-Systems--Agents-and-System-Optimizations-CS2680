// Live integration tests A–E against the REAL Claude Code CLI (uses model usage — keep prompts small).
// Prerequisites: `npm run build`, server running (`npm start`), Claude Code logged in.
// usage: node scripts/live-tests.mjs [--only A,B,C,D,E] [--export-fixtures]
// Writes logs/live/<test>.json and logs/live-tests.md. A test is PASS only if its checks pass on real output.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { redactText } from './redact-fixture.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = `http://127.0.0.1:${process.env.MADS_PORT ?? 5174}`;
const SCRATCH = path.join(ROOT, 'scratch', 'work', 'inventory');
const LOGDIR = path.join(ROOT, 'logs', 'live');
const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : ['A', 'B', 'C', 'D', 'E', 'S'];
const exportFixtures = args.includes('--export-fixtures');
fs.mkdirSync(LOGDIR, { recursive: true });

const post = async (url, body) => {
  const r = await fetch(BASE + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw Object.assign(new Error(j.error), { status: r.status, body: j });
  return j;
};

/** Follow a session's SSE stream until the given run ends; record receive times of every message. */
async function follow(sessionId, runId, timeoutMs = 300000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const res = await fetch(`${BASE}/api/sessions/${sessionId}/stream`, { signal: ctrl.signal });
  const dec = new TextDecoder();
  let buf = '';
  const lines = [];
  let meta = null;
  const t0 = Date.now();
  try {
    for await (const chunk of res.body) {
      buf += dec.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) !== -1) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (!block.startsWith('data: ')) continue;
        const msg = JSON.parse(block.slice(6));
        if (msg.kind === 'line' && msg.runId === runId) lines.push({ ...msg.data, recvMs: Date.now() - t0 });
        if (msg.kind === 'run' && msg.run.id === runId) meta = msg.run;
        if (msg.kind === 'hello') meta = msg.runs.find((r) => r.id === runId) ?? meta;
        if (meta && meta.status !== 'running') {
          ctrl.abort();
          clearTimeout(timer);
          return { meta, lines };
        }
      }
    }
  } catch (e) {
    if (!meta || meta.status === 'running') throw new Error(`stream ended before run finished: ${e.message}`);
  }
  clearTimeout(timer);
  return { meta, lines };
}

const toolUses = (lines) => lines.flatMap((l) => (l.json?.type === 'assistant' ? l.json.message.content.filter((b) => b.type === 'tool_use').map((b) => ({ ...b, parent: l.json.parent_tool_use_id, seq: l.seq })) : []));
const toolResults = (lines) => lines.flatMap((l) => (l.json?.type === 'user' && Array.isArray(l.json.message.content) ? l.json.message.content.filter((b) => b.type === 'tool_result').map((b) => ({ ...b, parent: l.json.parent_tool_use_id })) : []));
const results = (lines) => lines.filter((l) => l.json?.type === 'result').map((l) => l.json);
const texts = (lines) => lines.flatMap((l) => (l.json?.type === 'assistant' && !l.json.parent_tool_use_id ? l.json.message.content.filter((b) => b.type === 'text').map((b) => b.text) : [])).join('\n');

const report = [];
function record(name, checks, data) {
  const pass = checks.every((c) => c.ok);
  report.push({ name, pass, checks });
  fs.writeFileSync(path.join(LOGDIR, `${name.split(' ')[0]}.json`), JSON.stringify({ name, pass, checks, ...data }, null, 2));
  console.log(`\n${pass ? 'PASS' : 'FAIL'}  ${name}`);
  for (const c of checks) console.log(`   ${c.ok ? '✓' : '✕'} ${c.label}${c.detail ? ` — ${c.detail}` : ''}`);
  return pass;
}
const check = (label, ok, detail) => ({ label, ok: !!ok, detail: detail === undefined ? undefined : String(detail) });

function exportRun(runId, dest, metaExtra = {}) {
  const dir = path.join(ROOT, process.env.MADS_DATA_DIR ?? 'data', 'runs', runId);
  const maps = [[SCRATCH, '<SCRATCH>/inventory'], [ROOT, '<ASSIGNMENT1>']];
  const write = (src, out) => fs.writeFileSync(out, redactText(fs.readFileSync(src, 'utf8'), maps));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  write(path.join(dir, 'events.jsonl'), `${dest}.jsonl`);
  fs.copyFileSync(path.join(dir, 'timing.jsonl'), `${dest}.timing.jsonl`);
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
  const keep = { prompt: m.prompt, cwd: m.cwd, exitCode: m.exitCode, signal: m.signal, resumeClaudeSessionId: m.resumeClaudeSessionId, allowedTools: m.allowedTools, args: m.args, status: m.status, error: m.error, recordedWith: 'Mads-Lens live run', ...metaExtra };
  fs.writeFileSync(`${dest}.meta.json`, redactText(JSON.stringify(keep, null, 2), maps));
}

const cfg = await (await fetch(`${BASE}/api/config`)).json();
console.log(`server ${BASE} · model ${cfg.model ?? '(default)'} · tools ${cfg.allowedTools.join(' ')}`);
let A = null;

if (only.includes('A') || only.includes('B')) {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts/reset-scratch.mjs')]);
  const prompt = 'The pytest suite in this directory has one failing test. Read the relevant code, diagnose the bug, fix it with a minimal change, and rerun pytest to confirm everything passes. Keep your answer short.';
  const { session, run } = await post('/api/runs', { cwd: SCRATCH, prompt });
  const out = await follow(session.id, run.id);
  const tu = toolUses(out.lines);
  const pytestRuns = tu.filter((t) => t.name === 'Bash' && /pytest/.test(t.input?.command ?? ''));
  const edits = tu.filter((t) => ['Edit', 'Write', 'MultiEdit'].includes(t.name));
  const reads = tu.filter((t) => ['Read', 'Grep'].includes(t.name) || (t.name === 'Bash' && /\b(cat|grep|rg|sed|head|less)\b/.test(t.input?.command ?? '')));
  let suite = '';
  try {
    suite = execFileSync('python3', ['-m', 'pytest', '-q'], { cwd: SCRATCH, encoding: 'utf8' });
  } catch (e) {
    try { suite = execFileSync('pytest', ['-q'], { cwd: SCRATCH, encoding: 'utf8' }); } catch (e2) { suite = String(e2.stdout ?? e2.message); }
  }
  A = { session, run, out };
  record('A multi-step task (read → diagnose → fix → rerun tests)', [
    check('run finished', out.meta.status === 'finished', out.meta.status),
    check('read the code (Read/Grep tool or cat/grep/sed in Bash)', reads.length > 0, reads.map((r) => r.input.file_path ?? r.input.pattern ?? r.input.command).join(', ')),
    check('edited a file', edits.length > 0, edits.map((e) => e.input.file_path).join(', ')),
    check('ran pytest at least twice (diagnose + confirm) or once after the edit', pytestRuns.length >= 2 || (pytestRuns.length >= 1 && pytestRuns.at(-1).seq > (edits[0]?.seq ?? 1e9)), `${pytestRuns.length} pytest call(s)`),
    check('every tool_use got a tool_result', tu.every((t) => toolResults(out.lines).some((r) => r.tool_use_id === t.id)), `${tu.length} calls`),
    check('suite passes afterwards (checked independently)', /\b5 passed\b/.test(suite) && !/failed/.test(suite), suite.trim().split('\n').at(-1)),
    check('result metrics present', results(out.lines).at(-1)?.total_cost_usd !== undefined, JSON.stringify({ cost: results(out.lines).at(-1)?.total_cost_usd, turns: results(out.lines).at(-1)?.num_turns })),
  ], { sessionId: session.id, runId: run.id, claudeSessionId: out.meta.claudeSessionId, tools: tu.map((t) => `${t.name}: ${JSON.stringify(t.input).slice(0, 120)}`), finalText: texts(out.lines) });
  if (exportFixtures) exportRun(run.id, path.join(ROOT, 'fixtures/real/multistep'));
}

if (only.includes('B') && A) {
  const readmeBefore = fs.readFileSync(path.join(SCRATCH, 'README.md'), 'utf8');
  const prompt = 'Now update the README to document the bug you just fixed: which function, what was wrong, and how you fixed it. Two or three sentences.';
  const { run } = await post('/api/runs', { sessionId: A.session.id, cwd: SCRATCH, prompt });
  const out = await follow(A.session.id, run.id);
  const readme = fs.readFileSync(path.join(SCRATCH, 'README.md'), 'utf8');
  const init = out.lines.find((l) => l.json?.type === 'system' && l.json.subtype === 'init')?.json;
  const r = results(out.lines).at(-1);
  record('B resume (follow-up depends on A)', [
    check('run finished', out.meta.status === 'finished', out.meta.status),
    check('command used --resume <A session id>', out.meta.args.includes('--resume') && out.meta.args[out.meta.args.indexOf('--resume') + 1] === A.out.meta.claudeSessionId, out.meta.args.slice(0, 3).join(' ')),
    check('same session_id in init and result', init?.session_id === A.out.meta.claudeSessionId && r?.session_id === A.out.meta.claudeSessionId, `${init?.session_id} / ${r?.session_id}`),
    check('README changed', readme !== readmeBefore),
    check('README mentions the fixed function (context carried over, not given in the prompt)', /low_stock/.test(readme) && /(<=|threshold|at or below)/i.test(readme), readme.split('\n').filter((l) => /low_stock/.test(l)).join(' | ').slice(0, 300)),
  ], { runId: run.id, readme, finalText: texts(out.lines) });
  if (exportFixtures) {
    exportRun(A.run.id, path.join(ROOT, 'fixtures/real/resumed-session/run-1'));
    exportRun(run.id, path.join(ROOT, 'fixtures/real/resumed-session/run-2'));
  }
}

if (only.includes('C')) {
  const prompt = 'Use a subagent (the Agent/Task tool) to survey this directory and report its structure in 3 short bullets. Do not survey it yourself; wait for the subagent result.';
  const { session, run } = await post('/api/runs', { cwd: SCRATCH, prompt });
  const out = await follow(session.id, run.id);
  const tu = toolUses(out.lines);
  const parents = out.lines.filter((l) => typeof l.json?.parent_tool_use_id === 'string');
  const spawnIds = new Set(parents.map((l) => l.json.parent_tool_use_id));
  const spawner = tu.filter((t) => spawnIds.has(t.id));
  record('C subagent', [
    check('run finished', out.meta.status === 'finished', out.meta.status),
    check('raw stream has events with non-null parent_tool_use_id', parents.length > 0, `${parents.length} events`),
    check('those events reference a tool_use in the same stream', spawner.length > 0, spawner.map((s) => `${s.name}(${s.id})`).join(', ')),
    check('subagent made its own tool calls', tu.some((t) => t.parent), `${tu.filter((t) => t.parent).length} nested calls`),
  ], { runId: run.id, subagentTool: spawner.map((s) => s.name), nestedTools: tu.filter((t) => t.parent).map((t) => t.name) });
  if (exportFixtures) exportRun(run.id, path.join(ROOT, 'fixtures/real/subagent'));
}

if (only.includes('D')) {
  const bad = path.join(os.tmpdir(), 'mads-lens-no-such-dir-' + Date.now());
  const { session, run } = await post('/api/runs', { cwd: bad, prompt: 'hello' });
  const out = await follow(session.id, run.id, 20000);
  const prompt = 'Use the Bash tool to run exactly: touch /tmp/mads_lens_denied_probe.txt — then report what happened. Do not try alternatives.';
  const s2 = await post('/api/runs', { cwd: SCRATCH, prompt });
  const out2 = await follow(s2.session.id, s2.run.id);
  const errs = toolResults(out2.lines).filter((r) => r.is_error);
  record('D failures (invalid directory + denied tool)', [
    check('invalid dir run ends failed (no hang)', out.meta.status === 'failed', out.meta.status),
    check('error message names the bad path', (out.meta.error ?? '').includes(bad), out.meta.error),
    check('no claude events for the invalid dir', out.lines.length === 0),
    check('denied tool comes back as tool_result is_error=true', errs.length > 0, errs.map((e) => String(typeof e.content === 'string' ? e.content : JSON.stringify(e.content)).slice(0, 140)).join(' | ')),
    check('file was not created', !fs.existsSync('/tmp/mads_lens_denied_probe.txt')),
    check('run itself still completes (denial is not a crash)', ['finished', 'failed'].includes(out2.meta.status), out2.meta.status),
  ], { invalidRun: out.meta, deniedRunId: s2.run.id });
  if (exportFixtures) exportRun(s2.run.id, path.join(ROOT, 'fixtures/real/failed-denied-tool'));
}

if (only.includes('E')) {
  // Browser-level check: tool rows appear in the DOM while the run is still running (before the result event).
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
  await page.goto(BASE);
  await page.getByTestId('new-session').click();
  await page.fill('#cwd', SCRATCH);
  await page.fill('#prompt', 'List the files in this directory with ls, then read inventory/core.py, then run pytest -q, then reply with one sentence.');
  const t0 = Date.now();
  await page.getByTestId('run').click();
  await page.locator('[data-tool-name]').first().waitFor({ timeout: 120000 });
  const firstToolMs = Date.now() - t0;
  const stillRunning = await page.locator('[data-testid="run-card"] header [data-run-status="running"]').count();
  const toolsWhileRunning = await page.locator('[data-tool-name]').count();
  await page.screenshot({ path: path.join(LOGDIR, 'E-mid-run.png') });
  await page.locator('[data-testid="run-card"] header [data-run-status="finished"], [data-testid="run-card"] header [data-run-status="failed"]').first().waitFor({ timeout: 300000 });
  const doneMs = Date.now() - t0;
  const finalTools = await page.locator('[data-tool-name]').count();
  await page.screenshot({ path: path.join(LOGDIR, 'E-finished.png'), fullPage: false });
  await browser.close();
  record('E live streaming (events in DOM before the result event)', [
    check('a tool call was in the DOM while the run status was still "running"', stillRunning > 0 && toolsWhileRunning > 0, `first tool at ${firstToolMs} ms, ${toolsWhileRunning} tool row(s), run still running: ${stillRunning > 0}`),
    check('run finished later than the first tool row appeared', doneMs > firstToolMs + 200, `finished at ${doneMs} ms`),
    check('more tool rows appeared after the first (incremental updates)', finalTools > toolsWhileRunning, `${toolsWhileRunning} → ${finalTools}`),
  ], { firstToolMs, doneMs, toolsWhileRunning, finalTools });
}

if (only.includes('S')) {
  // Stop button path: cancel a real run mid-flight; the process must be terminated and the run marked cancelled.
  const prompt = 'Read every file in this directory one by one with the Read tool, then write a detailed summary of each.';
  const { session, run } = await post('/api/runs', { cwd: SCRATCH, prompt });
  const t0 = Date.now();
  // wait for the first claude event, then cancel
  for (let i = 0; i < 100; i++) {
    const lines = await (await fetch(`${BASE}/api/runs/${run.id}/events`)).json();
    if (lines.length > 0) break;
    await new Promise((r) => setTimeout(r, 300));
  }
  await post(`/api/runs/${run.id}/cancel`, {});
  const out = await follow(session.id, run.id, 30000);
  const stopMs = Date.now() - t0;
  record('S stop (cancel a live run)', [
    check('run ends as cancelled', out.meta.status === 'cancelled', out.meta.status),
    check('process terminated by a signal or exit', out.meta.signal !== null || out.meta.exitCode !== null, `signal=${out.meta.signal} exit=${out.meta.exitCode}`),
    check('no result event recorded after cancel (run did not complete)', !out.lines.some((l) => l.json?.type === 'result'), `${out.lines.length} lines before stop`),
  ], { runId: run.id, stopMs, meta: out.meta });
}

const md = [`# Live integration tests (real Claude Code CLI)`, '', `Date: ${new Date().toISOString()}  `, `Server: ${BASE} · model: ${cfg.model ?? '(Claude Code default)'}  `, `Allowed tools: \`${cfg.allowedTools.join(' ')}\``, '', '| Test | Result |', '|---|---|',
  ...report.map((r) => `| ${r.name} | ${r.pass ? 'PASS' : 'FAIL'} |`), '', ...report.flatMap((r) => [`## ${r.name} — ${r.pass ? 'PASS' : 'FAIL'}`, ...r.checks.map((c) => `- ${c.ok ? '✓' : '✕'} ${c.label}${c.detail ? ` — ${String(c.detail).replace(/\n/g, ' ')}` : ''}`), ''])];
const mdPath = path.join(ROOT, 'logs', only.length === 6 ? 'live-tests.md' : `live-tests-${only.join('')}.md`);
fs.writeFileSync(mdPath, redactText(md.join('\n'), [[SCRATCH, '<SCRATCH>/inventory'], [ROOT, '<ASSIGNMENT1>']]));
console.log(`\nwrote ${path.relative(ROOT, mdPath)}`);
process.exit(report.every((r) => r.pass) ? 0 : 1);
