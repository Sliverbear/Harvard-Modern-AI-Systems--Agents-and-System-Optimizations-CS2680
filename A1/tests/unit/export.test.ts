import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readJsonlWithTiming } from '../../server/runStore';
import { loadConfig } from '../../server/config';
import { HttpError, RunManager } from '../../server/runManager';
import { fence, runToMarkdown } from '../../shared/runExport';
import { applyLine, applyMeta, createRun } from '../../shared/trajectory';
import type { RunMeta } from '../../shared/types';

const FIX = path.resolve(__dirname, '../../fixtures');

const meta = (over: Partial<RunMeta> = {}): RunMeta => ({
  id: 'run_t', sessionId: 's_t', index: 1, mode: 'replay', prompt: 'p', cwd: '/x', resumeClaudeSessionId: null, claudeSessionId: null,
  args: [], allowedTools: [], dangerouslySkipPermissions: false, status: 'running', startedAt: new Date().toISOString(), endedAt: null,
  exitCode: null, signal: null, error: null, stderrTail: null, resultSubtype: null, eventCount: 0, ...over,
});

function exportFixture(rel: string) {
  const lines = readJsonlWithTiming(path.join(FIX, rel));
  const run = createRun(meta());
  for (const l of lines) applyLine(run, l);
  applyMeta(run, meta({ status: 'finished', endedAt: new Date().toISOString() }));
  return { md: runToMarkdown(run, lines), lines };
}

describe('runToMarkdown', () => {
  it('includes meta, metrics, every tool call with its result, and the raw stream', () => {
    const { md, lines } = exportFixture('real/multistep.jsonl');
    expect(md).toContain('## Prompt');
    expect(md).toContain('| Model | claude-haiku-5-5 |');
    expect(md).toMatch(/\| Cost \| \$\d+\.\d{4} \|/);
    expect(md).toMatch(/## Tool calls \(\d+\)/);
    expect(md).toContain('## Transcript');
    expect(md).toContain('Result\n\n```');
    expect(md).toContain(`## Raw stream (${lines.length} lines)`);
    for (const l of lines) expect(md).toContain(l.line);
  });

  it('nests subagent calls under their parent', () => {
    const { md } = exportFixture('real/subagent.jsonl');
    expect(md).toMatch(/\| \d+ \| ↳ /);
    expect(md).toMatch(/subagent/);
  });

  it('marks tools that never got a result', () => {
    const { md } = exportFixture('synthetic/edge-malformed-unknown-noresult.jsonl');
    expect(md).toContain('no_result');
    expect(md).toContain('_No result._');
  });
});

describe('fence', () => {
  it('uses a fence longer than any backtick run in the content', () => {
    expect(fence('a ``` b')).toBe('````\na ``` b\n````');
    expect(fence('plain', 'json')).toBe('```json\nplain\n```');
  });
});

describe('RunManager.exportMarkdown', () => {
  it('404s for an unknown run', () => {
    const m = new RunManager({ ...loadConfig({}), dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'mads-export-')) });
    expect(() => m.exportMarkdown('run_nope')).toThrow(HttpError);
  });
});

describe('runToMarkdown options', () => {
  it('can leave out the raw stream and clip long tool results; the tool table has timing', () => {
    const lines = readJsonlWithTiming(path.join(FIX, 'real/multistep.jsonl'));
    const run = createRun(meta());
    for (const l of lines) applyLine(run, l);
    const md = runToMarkdown(run, lines, { raw: false, maxResultChars: 20 });
    expect(md).not.toContain('## Raw stream');
    expect(md).toContain('more characters cut from this export');
    expect(md).toContain('| # | Tool | Status | At | Took | Input |');
  });
});
