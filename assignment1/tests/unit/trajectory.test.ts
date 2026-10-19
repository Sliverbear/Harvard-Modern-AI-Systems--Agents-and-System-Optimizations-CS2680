import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readJsonlWithTiming } from '../../server/runStore';
import { parseLine } from '../../server/lineBuffer';
import type { RunMeta, StreamLine } from '../../shared/types';
import {
  ancestorsOf,
  applyLine,
  applyMeta,
  buildOutline,
  countTree,
  createRun,
  extractMetrics,
  isSubagentNode,
  summarizeInput,
  type ToolNode,
} from '../../shared/trajectory';

const FIX = path.resolve(__dirname, '../../fixtures');

export function meta(over: Partial<RunMeta> = {}): RunMeta {
  return {
    id: 'run_t', sessionId: 's_t', index: 1, mode: 'replay', prompt: 'p', cwd: '/x', resumeClaudeSessionId: null, claudeSessionId: null,
    args: [], allowedTools: [], dangerouslySkipPermissions: false, status: 'running', startedAt: new Date().toISOString(), endedAt: null,
    exitCode: null, signal: null, error: null, stderrTail: null, resultSubtype: null, eventCount: 0, ...over,
  };
}

function runFrom(lines: (object | string)[]) {
  const run = createRun(meta());
  lines.forEach((l, seq) => {
    const line = typeof l === 'string' ? l : JSON.stringify(l);
    const p = parseLine(line);
    applyLine(run, { seq, t: seq, line, json: p.json, parseError: p.parseError } as StreamLine);
  });
  return run;
}
function runFromFile(rel: string) {
  const run = createRun(meta());
  for (const l of readJsonlWithTiming(path.join(FIX, rel))) applyLine(run, l);
  return run;
}

const A = (content: object[], parent: string | null = null) => ({ type: 'assistant', message: { content }, parent_tool_use_id: parent });
const R = (id: string, content: unknown, is_error = false, parent: string | null = null) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content, is_error }] }, parent_tool_use_id: parent });

describe('normalization', () => {
  it('renders every content block of one assistant message in order', () => {
    const run = runFrom([A([{ type: 'text', text: 'a' }, { type: 'thinking', thinking: 't' }, { type: 'tool_use', id: 'x', name: 'Read', input: { file_path: '/f' } }, { type: 'text', text: 'b' }])]);
    expect(run.nodes.map((n) => n.kind)).toEqual(['text', 'thinking', 'tool', 'text']);
  });

  it('pairs tool_result with tool_use by id and sets success / error status', () => {
    const run = runFrom([
      A([{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }, { type: 'tool_use', id: 't2', name: 'Read', input: { file_path: '/nope' } }]),
      R('t2', 'File does not exist.', true),
      R('t1', [{ type: 'text', text: 'a.py' }]),
    ]);
    const t1 = run.tools.get('t1')!;
    const t2 = run.tools.get('t2')!;
    expect(t1.status).toBe('success');
    expect(t1.result!.text).toBe('a.py');
    expect(t2.status).toBe('error');
    expect(t2.result!.isError).toBe(true);
  });

  it('tool status: pending until result, then no_result if the run ends first', () => {
    const run = runFrom([A([{ type: 'tool_use', id: 'p', name: 'Bash', input: { command: 'sleep 99' } }])]);
    expect(run.tools.get('p')!.status).toBe('pending');
    applyMeta(run, meta({ status: 'failed' }));
    expect(run.tools.get('p')!.status).toBe('no_result');
  });

  it('handles string, array, image and unknown result content', () => {
    const run = runFrom([
      A([{ type: 'tool_use', id: 'i', name: 'Read', input: {} }]),
      R('i', [{ type: 'text', text: 'caption' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAA' } }, { type: 'weird', x: 1 }]),
    ]);
    const parts = run.tools.get('i')!.result!.parts;
    expect(parts.map((p) => p.type)).toEqual(['text', 'image', 'other']);
  });

  it('keeps unknown event types and malformed lines as raw rows', () => {
    const run = runFrom([{ type: 'mystery', x: 1 }, 'not json', { type: 'rate_limit_event' }]);
    expect(run.nodes.map((n) => n.kind)).toEqual(['raw', 'raw', 'raw']);
    expect(run.malformedCount).toBe(1);
    expect((run.nodes[2] as any).hiddenByDefault).toBe(true);
    expect((run.nodes[0] as any).hiddenByDefault).toBe(false);
  });

  it('summarizes the key input of common tools', () => {
    expect(summarizeInput('Bash', { command: 'pytest -q', description: 'x' })).toBe('pytest -q');
    expect(summarizeInput('Read', { file_path: '/a/b.py' })).toBe('/a/b.py');
    expect(summarizeInput('Grep', { pattern: 'foo', path: 'src' })).toBe('foo in src');
    expect(summarizeInput('Agent', { description: 'Survey', prompt: 'long' })).toBe('Survey');
  });
});

describe('subagent tree', () => {
  it('nests by parent_tool_use_id (parallel + nested), independent of tool name', () => {
    const run = runFromFile('synthetic/parallel-nested-subagents.jsonl');
    const top = run.nodes.filter((n) => n.kind === 'tool') as ToolNode[];
    expect(top.map((t) => t.id)).toEqual(['toolu_a', 'toolu_b']);
    const a = top[0];
    expect(isSubagentNode(a)).toBe(true);
    expect(a.children.filter((c) => c.kind === 'tool').map((c) => (c as ToolNode).id)).toEqual(['toolu_a1', 'toolu_a2']);
    const nested = run.tools.get('toolu_a2')!;
    expect(nested.children.some((c) => c.kind === 'tool' && c.id === 'toolu_a2x')).toBe(true);
    expect(countTree(a.children)).toEqual({ events: 5, tools: 3 });
    expect(ancestorsOf(run.nodes, nested.children[0].key)).toEqual([a.key, nested.key, nested.children[0].key]);
    const outline = buildOutline(run.nodes);
    expect(outline[0].children[1].children[0].name).toBe('Read');
  });

  it('a different tool name is still treated as a subagent when children reference it', () => {
    const run = runFrom([A([{ type: 'tool_use', id: 'z', name: 'Task', input: { description: 'd' } }]), A([{ type: 'text', text: 'child' }], 'z')]);
    expect(isSubagentNode(run.tools.get('z')!)).toBe(true);
  });

  it('a child arriving before its parent call is kept under a placeholder', () => {
    const run = runFrom([A([{ type: 'text', text: 'early' }], 'later'), A([{ type: 'tool_use', id: 'later', name: 'Agent', input: { description: 'x' } }])]);
    const t = run.tools.get('later')!;
    expect(t.placeholder).toBe(false);
    expect(t.name).toBe('Agent');
    expect(t.children).toHaveLength(1);
  });

  it('runs without subagents stay flat', () => {
    const run = runFromFile('real/multistep.jsonl');
    const tools = run.nodes.filter((n) => n.kind === 'tool') as ToolNode[];
    expect(tools.length).toBeGreaterThan(2);
    expect(tools.every((t) => !isSubagentNode(t))).toBe(true);
    expect(tools.every((t) => t.status === 'success' || t.status === 'error')).toBe(true);
  });

  it('real async subagent recording nests the subagent events and tracks its task status', () => {
    const run = runFromFile('real/subagent.jsonl');
    const agent = [...run.tools.values()].find((t) => t.name === 'Agent')!;
    expect(isSubagentNode(agent)).toBe(true);
    expect(agent.subagentType).toBe('Explore');
    expect(agent.task?.status).toBe('completed');
    expect(countTree(agent.children).tools).toBeGreaterThanOrEqual(3);
    expect(run.results).toHaveLength(2);
  });
});

describe('metrics', () => {
  it('extracts cost/duration/turns/session from the final result only', () => {
    const run = runFromFile('real/multistep.jsonl');
    const m = extractMetrics(run);
    expect(m.costUsd).toBeGreaterThan(0);
    expect(m.durationMs).toBeGreaterThan(0);
    expect(m.numTurns).toBeGreaterThan(0);
    expect(m.sessionId).toMatch(/^[0-9a-f-]{36}$/);
  });
  it('missing fields stay null (rendered as —), never invented', () => {
    const run = runFrom([{ type: 'result', subtype: 'success', is_error: false }]);
    const m = extractMetrics(run);
    expect(m).toMatchObject({ costUsd: null, durationMs: null, numTurns: null, usage: null });
    expect(extractMetrics(runFrom([])).costUsd).toBeNull();
  });
});
