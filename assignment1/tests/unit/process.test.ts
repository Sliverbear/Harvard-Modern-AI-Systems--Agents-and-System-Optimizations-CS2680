import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildArgs, childEnv, resolveClaudeBin, validateCwd } from '../../server/claudeProcess';
import { loadConfig, type Config } from '../../server/config';
import { HttpError, RunManager } from '../../server/runManager';
import type { RunMeta, ServerMessage } from '../../shared/types';

const ROOT = path.resolve(__dirname, '../..');
const FAKE = path.join(ROOT, 'tests/fake-claude/fake-claude.mjs');
const sessionIdOf = (rel: string): string =>
  JSON.parse(fs.readFileSync(path.join(ROOT, 'fixtures', rel), 'utf8').split('\n').find((l) => l.includes('"init"'))!).session_id;
let tmp: string;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mads-test-'));
});
afterAll(() => {
  delete process.env.FAKE_SCENARIO;
  delete process.env.FAKE_FIXTURE;
  delete process.env.FAKE_ARGV_OUT;
  delete process.env.FAKE_IGNORE_TERM;
});

function mgr(over: Partial<Config> = {}): RunManager {
  const cfg = { ...loadConfig({}), claudeBin: FAKE, dataDir: fs.mkdtempSync(path.join(tmp, 'data-')), killTimeoutMs: 300, ...over };
  return new RunManager(cfg);
}

function waitForEnd(m: RunManager, sessionId: string, runId: string, timeout = 8000): Promise<RunMeta> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout waiting for run end')), timeout);
    const check = (msg: ServerMessage) => {
      if (msg.kind === 'run' && msg.run.id === runId && msg.run.status !== 'running') {
        clearTimeout(t);
        unsub();
        resolve(msg.run);
      }
    };
    const unsub = m.subscribe(sessionId, (msg) => {
      if (msg.kind === 'hello') {
        const r = msg.runs.find((x) => x.id === runId);
        if (r && r.status !== 'running') {
          clearTimeout(t);
          setTimeout(() => unsub());
          resolve(r);
        }
      } else check(msg);
    });
  });
}

describe('argument construction', () => {
  it('builds a stream-json headless command with an explicit allow-list', () => {
    expect(buildArgs({ prompt: 'fix it', resumeSessionId: null, allowedTools: ['Read', 'Bash(pytest:*)'], model: null, dangerouslySkipPermissions: false })).toEqual([
      '-p', 'fix it', '--output-format', 'stream-json', '--verbose', '--allowedTools', 'Read', 'Bash(pytest:*)',
    ]);
  });
  it('adds --resume <id> for follow-ups and never interpolates into a shell string', () => {
    const a = buildArgs({ prompt: 'x"; rm -rf / #', resumeSessionId: 'abc-123', allowedTools: [], model: 'haiku', dangerouslySkipPermissions: false });
    expect(a.slice(0, 4)).toEqual(['-p', '--resume', 'abc-123', 'x"; rm -rf / #']);
    expect(a).toContain('--model');
  });
  it('a prompt starting with "-" cannot become a flag', () => {
    expect(buildArgs({ prompt: '--help', resumeSessionId: null, allowedTools: [], model: null, dangerouslySkipPermissions: false })[1]).toBe(' --help');
  });
  it('dangerous mode is only added when explicitly enabled', () => {
    const a = buildArgs({ prompt: 'p', resumeSessionId: null, allowedTools: ['Read'], model: null, dangerouslySkipPermissions: true });
    expect(a).toContain('--dangerously-skip-permissions');
    expect(loadConfig({}).dangerouslySkipPermissions).toBe(false);
  });
});

describe('environment and validation', () => {
  it('strips API keys and parent Claude Code session variables from the child env', () => {
    const env = childEnv(loadConfig({}), { PATH: '/bin', ANTHROPIC_API_KEY: 'sk-x', ANTHROPIC_AUTH_TOKEN: 't', CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 's', CLAUDE_CONFIG_DIR: '/c', HOME: '/h' });
    expect(env).toEqual({ PATH: '/bin', CLAUDE_CONFIG_DIR: '/c', HOME: '/h' });
  });
  it('validates the working directory', () => {
    expect(validateCwd(tmp)).toEqual({ ok: true, path: tmp });
    expect(validateCwd(path.join(tmp, 'nope')).ok).toBe(false);
    expect(validateCwd(FAKE).ok).toBe(false);
    expect(validateCwd('').ok).toBe(false);
  });
  it('on Windows, resolves an npm claude.cmd shim to node + cli.js (no shell needed)', () => {
    const bin = fs.mkdtempSync(path.join(tmp, 'win-'));
    fs.writeFileSync(path.join(bin, 'claude.cmd'), '@echo off');
    const cli = path.join(bin, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
    fs.mkdirSync(path.dirname(cli), { recursive: true });
    fs.writeFileSync(cli, '');
    const r = resolveClaudeBin('claude', 'win32', { PATH: bin });
    expect(r.command).toBe(process.execPath);
    expect(r.prefixArgs).toEqual([cli]);
    fs.writeFileSync(path.join(bin, 'claude.exe'), '');
    expect(resolveClaudeBin('claude', 'win32', { PATH: bin }).command).toBe(path.join(bin, 'claude.exe'));
    expect(resolveClaudeBin('claude', 'linux', {}).command).toBe('claude');
  });
});

describe('run lifecycle with a test-double CLI', () => {
  it('streams a chunked recording, persists every raw line, and finishes', async () => {
    process.env.FAKE_SCENARIO = 'fixture';
    process.env.FAKE_FIXTURE = path.join(ROOT, 'fixtures/real/multistep.jsonl');
    process.env.FAKE_ARGV_OUT = path.join(tmp, 'argv1.json');
    process.env.ANTHROPIC_API_KEY = 'sk-should-not-leak';
    const m = mgr();
    const { session, run } = m.startRun({ cwd: tmp, prompt: 'go' });
    const end = await waitForEnd(m, session.id, run.id);
    delete process.env.ANTHROPIC_API_KEY;
    expect(end.status).toBe('finished');
    const original = fs.readFileSync(process.env.FAKE_FIXTURE, 'utf8').split('\n').filter(Boolean);
    const saved = fs.readFileSync(path.join(m.store.runDir(run.id), 'events.jsonl'), 'utf8').split('\n').filter(Boolean);
    expect(saved).toEqual(original);
    expect(end.claudeSessionId).toBe(sessionIdOf('real/multistep.jsonl'));
    const argv = JSON.parse(fs.readFileSync(process.env.FAKE_ARGV_OUT!, 'utf8'));
    expect(argv.cwd).toBe(fs.realpathSync(tmp));
    expect(argv.hasApiKey).toBe(false);
    expect(argv.argv).toContain('stream-json');
    const meta = JSON.parse(fs.readFileSync(path.join(m.store.runDir(run.id), 'meta.json'), 'utf8'));
    expect(meta).toMatchObject({ prompt: 'go', exitCode: 0, status: 'finished' });
  });

  it('follow-up uses --resume with the stored session id; cwd is locked per session; duplicate submit rejected', async () => {
    process.env.FAKE_SCENARIO = 'fixture';
    process.env.FAKE_FIXTURE = path.join(ROOT, 'fixtures/real/resumed-session/run-1.jsonl');
    process.env.FAKE_ARGV_OUT = path.join(tmp, 'argv2.json');
    const m = mgr();
    const first = m.startRun({ cwd: tmp, prompt: 'one' });
    expect(() => m.startRun({ sessionId: first.session.id, cwd: tmp, prompt: 'dup' })).toThrow(/already in progress/);
    await waitForEnd(m, first.session.id, first.run.id);
    const other = fs.mkdtempSync(path.join(tmp, 'other-'));
    expect(() => m.startRun({ sessionId: first.session.id, cwd: other, prompt: 'x' })).toThrow(HttpError);
    const second = m.startRun({ sessionId: first.session.id, cwd: tmp, prompt: 'now update the README' });
    const sid = sessionIdOf('real/resumed-session/run-1.jsonl');
    expect(second.run.resumeClaudeSessionId).toBe(sid);
    expect(second.run.index).toBe(2);
    await waitForEnd(m, first.session.id, second.run.id);
    const argv = JSON.parse(fs.readFileSync(process.env.FAKE_ARGV_OUT!, 'utf8')).argv;
    expect(argv.slice(0, 3)).toEqual(['-p', '--resume', sid]);
  });

  it('exit without a result event => failed with exit code and stderr', async () => {
    process.env.FAKE_SCENARIO = 'noresult';
    delete process.env.FAKE_ARGV_OUT;
    const m = mgr();
    const { session, run } = m.startRun({ cwd: tmp, prompt: 'x' });
    const end = await waitForEnd(m, session.id, run.id);
    expect(end.status).toBe('failed');
    expect(end.exitCode).toBe(3);
    expect(end.error).toContain('without a result event');
    expect(end.error).toContain('fatal: something broke');
  });

  it('non-success result => failed (exit code from the CLI)', async () => {
    process.env.FAKE_SCENARIO = 'fixture';
    process.env.FAKE_FIXTURE = path.join(ROOT, 'fixtures/real/failed-max-turns.jsonl');
    const m = mgr();
    const { session, run } = m.startRun({ cwd: tmp, prompt: 'x' });
    const end = await waitForEnd(m, session.id, run.id);
    expect(end.status).toBe('failed');
    expect(end.resultSubtype).toBe('error_max_turns');
  });

  it('spawn error (missing binary) => failed, never hangs', async () => {
    const m = mgr({ claudeBin: path.join(tmp, 'definitely-not-claude') });
    const { session, run } = m.startRun({ cwd: tmp, prompt: 'x' });
    const end = await waitForEnd(m, session.id, run.id);
    expect(end.status).toBe('failed');
    expect(end.error).toMatch(/ENOENT/);
  });

  it('invalid working directory => a visible failed run without spawning', async () => {
    const m = mgr();
    const { session, run } = m.startRun({ cwd: path.join(tmp, 'missing-dir'), prompt: 'x' });
    const end = await waitForEnd(m, session.id, run.id);
    expect(end.status).toBe('failed');
    expect(end.error).toContain('does not exist');
  });

  it('Stop: SIGTERM then SIGKILL after the timeout => cancelled', async () => {
    process.env.FAKE_SCENARIO = 'hang';
    process.env.FAKE_IGNORE_TERM = '1';
    const m = mgr({ killTimeoutMs: 200 });
    const { session, run } = m.startRun({ cwd: tmp, prompt: 'x' });
    await new Promise((r) => setTimeout(r, 400));
    m.cancel(run.id);
    const end = await waitForEnd(m, session.id, run.id);
    delete process.env.FAKE_IGNORE_TERM;
    expect(end.status).toBe('cancelled');
    expect(end.signal).toBe('SIGKILL');
  });

  it('replay streams a saved file through the same path and labels it as replay', async () => {
    const m = mgr();
    const s = m.startReplay('real/subagent.jsonl', 'instant');
    const seen: string[] = [];
    const done = new Promise<RunMeta>((resolve) => {
      m.subscribe(s.id, (msg) => {
        if (msg.kind === 'line') seen.push(msg.data.line);
        if (msg.kind === 'run' && msg.run.status !== 'running') resolve(msg.run);
      });
    });
    const end = await done;
    expect(end.mode).toBe('replay');
    expect(end.status).toBe('finished');
    expect(seen.length).toBe(fs.readFileSync(path.join(ROOT, 'fixtures/real/subagent.jsonl'), 'utf8').split('\n').filter(Boolean).length);
    expect(() => m.startRun({ sessionId: s.id, cwd: tmp, prompt: 'x' })).toThrow(/Replay sessions/);
  });

  it('fixture listing ignores *.timing.jsonl sidecars and counts multi-run sessions', () => {
    const list = mgr().listFixtures();
    expect(list.some((f) => f.name.includes('.timing.'))).toBe(false);
    expect(list.find((f) => f.name === 'real/resumed-session')?.runs).toBe(2);
  });

  it('replay of a synthetic file with no result event ends as failed (no infinite spinner)', async () => {
    const m = mgr();
    const s = m.startReplay('synthetic/edge-malformed-unknown-noresult.jsonl', 'instant');
    const end = await new Promise<RunMeta>((resolve) => m.subscribe(s.id, (msg) => msg.kind === 'run' && msg.run.status !== 'running' && resolve(msg.run)));
    expect(end.status).toBe('failed');
    expect(end.error).toContain('without a result event');
  });
});
