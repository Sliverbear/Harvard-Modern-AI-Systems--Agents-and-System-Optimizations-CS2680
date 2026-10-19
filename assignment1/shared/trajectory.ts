// Event normalization + tool-call / subagent relationship tracking.
// Pure TypeScript (no DOM, no Node APIs) so it is shared by client and tests.
//
// Input: the raw stream lines of a run, in arrival order.
// Output: a tree of nodes. Events with parent_tool_use_id = null go to the run's
// top level (main agent); events with parent_tool_use_id = X are appended to the
// children of the tool call whose id is X — at any depth, for any tool name.

import type { RunMeta, StreamLine } from './types.ts';

export type ToolStatus = 'pending' | 'success' | 'error' | 'no_result';

export type ResultPart =
  | { type: 'text'; text: string }
  | { type: 'image'; mediaType: string; data: string | null }
  | { type: 'other'; json: unknown };

export interface ToolResultView {
  isError: boolean;
  parts: ResultPart[];
  text: string; // all text parts joined (for folding / search)
  seq: number;
}

interface NodeBase {
  key: string; // stable unique key within the session
  runId: string;
  seq: number;
}

export interface TextNode extends NodeBase { kind: 'text'; text: string }
export interface ThinkingNode extends NodeBase { kind: 'thinking'; text: string }
export interface UserTextNode extends NodeBase { kind: 'user_text'; text: string }
export interface NoteNode extends NodeBase {
  kind: 'note';
  label: string;
  detail?: string;
  level: 'info' | 'warn' | 'error';
}
export interface ResultNode extends NodeBase { kind: 'result'; json: any; index: number }
export interface RawNode extends NodeBase {
  kind: 'raw';
  line: string;
  json: unknown | null;
  reason: 'unknown_type' | 'malformed' | 'unpaired_result' | 'system';
  hiddenByDefault: boolean; // low-value known system events (shown with "all events")
}

export interface ToolNode extends NodeBase {
  kind: 'tool';
  id: string;
  name: string;
  input: unknown;
  summary: string;
  status: ToolStatus;
  result: ToolResultView | null;
  parentToolUseId: string | null;
  children: TrajNode[];
  /** Background task info from system task_* events (Agent tool / background Bash). */
  task: { status: string; description?: string; lastActivity?: string; summary?: string } | null;
  subagentType: string | null;
  placeholder: boolean; // created because a child referenced an id we have not seen yet
}

export type TrajNode = TextNode | ThinkingNode | UserTextNode | NoteNode | ResultNode | RawNode | ToolNode;

export interface RunModel {
  meta: RunMeta;
  nodes: TrajNode[];
  tools: Map<string, ToolNode>;
  results: any[];
  init: any | null;
  claudeSessionId: string | null;
  lineCount: number;
  malformedCount: number;
  hiddenCount: number;
  stderr: string;
  firstEventAt: number | null; // ms since run start of first line
}

/** Known-but-noisy events: preserved and countable, hidden unless "all events" is on. */
const QUIET_SYSTEM_SUBTYPES = new Set([
  'status',
  'thinking_tokens',
  'background_tasks_changed',
  'task_progress',
  'task_updated',
  'task_started',
  'task_notification',
  'hook_response',
  'hook_started',
]);
const QUIET_TYPES = new Set(['rate_limit_event', 'stream_event', 'active_goal', 'autocompact_state']);

export function createRun(meta: RunMeta): RunModel {
  return {
    meta,
    nodes: [],
    tools: new Map(),
    results: [],
    init: null,
    claudeSessionId: meta.claudeSessionId,
    lineCount: 0,
    malformedCount: 0,
    hiddenCount: 0,
    stderr: '',
    firstEventAt: null,
  };
}

/** One-line summary of the key input of a tool call. */
export function summarizeInput(name: string, input: unknown): string {
  if (input == null || typeof input !== 'object') return input == null ? '' : String(input);
  const o = input as Record<string, unknown>;
  const pick = (k: string) => (typeof o[k] === 'string' && (o[k] as string).trim() ? (o[k] as string) : null);
  const s =
    pick('command') ??
    pick('file_path') ??
    pick('notebook_path') ??
    (pick('pattern') ? `${o.pattern}${pick('path') ? `  in ${o.path}` : ''}` : null) ??
    pick('path') ??
    pick('url') ??
    pick('query') ??
    pick('description') ??
    pick('prompt') ??
    Object.values(o).find((v): v is string => typeof v === 'string') ??
    '';
  void name;
  const oneLine = s.replace(/\s+/g, ' ').trim();
  return oneLine.length > 160 ? oneLine.slice(0, 157) + '…' : oneLine;
}

function normalizeResultContent(content: unknown): { parts: ResultPart[]; text: string } {
  const parts: ResultPart[] = [];
  if (typeof content === 'string') parts.push({ type: 'text', text: content });
  else if (Array.isArray(content)) {
    for (const b of content) {
      if (b && typeof b === 'object' && (b as any).type === 'text' && typeof (b as any).text === 'string') {
        parts.push({ type: 'text', text: (b as any).text });
      } else if (b && typeof b === 'object' && (b as any).type === 'image') {
        const src = (b as any).source ?? {};
        parts.push({
          type: 'image',
          mediaType: String(src.media_type ?? 'image/png'),
          data: src.type === 'base64' && typeof src.data === 'string' ? src.data : null,
        });
      } else parts.push({ type: 'other', json: b });
    }
  } else if (content != null) parts.push({ type: 'other', json: content });
  const text = parts
    .map((p) => (p.type === 'text' ? p.text : p.type === 'image' ? `[image ${p.mediaType}]` : JSON.stringify(p.json, null, 2)))
    .join('\n');
  return { parts, text };
}

function containerFor(run: RunModel, parentId: string | null, seq: number): TrajNode[] {
  if (!parentId) return run.nodes;
  let parent = run.tools.get(parentId);
  if (!parent) {
    // A child arrived before (or without) its spawning call: keep it visible under a placeholder.
    parent = {
      kind: 'tool',
      key: `${run.meta.id}:tool:${parentId}`,
      runId: run.meta.id,
      seq,
      id: parentId,
      name: '(unknown parent call)',
      input: null,
      summary: parentId,
      status: 'pending',
      result: null,
      parentToolUseId: null,
      children: [],
      task: null,
      subagentType: null,
      placeholder: true,
    };
    run.tools.set(parentId, parent);
    run.nodes.push(parent);
  }
  return parent.children;
}

function rawNode(run: RunModel, l: StreamLine, reason: RawNode['reason'], hidden: boolean): RawNode {
  return { kind: 'raw', key: `${run.meta.id}:raw:${l.seq}`, runId: run.meta.id, seq: l.seq, line: l.line, json: l.json, reason, hiddenByDefault: hidden };
}

/** Apply one stream line to the run model (mutates). */
export function applyLine(run: RunModel, l: StreamLine): void {
  run.lineCount++;
  if (run.firstEventAt === null) run.firstEventAt = l.t;
  const ev = l.json;
  const id = run.meta.id;
  if (ev === null || typeof ev !== 'object' || Array.isArray(ev)) {
    run.malformedCount++;
    run.nodes.push(rawNode(run, l, 'malformed', false));
    return;
  }
  if (typeof ev.session_id === 'string' && !run.claudeSessionId) run.claudeSessionId = ev.session_id;
  const parentId: string | null = typeof ev.parent_tool_use_id === 'string' ? ev.parent_tool_use_id : null;

  switch (ev.type) {
    case 'system': {
      if (ev.subtype === 'init') {
        if (!run.init) run.init = ev;
        if (typeof ev.session_id === 'string') run.claudeSessionId = ev.session_id;
        const tools = Array.isArray(ev.tools) ? ev.tools.length : 0;
        const isFirst = run.init === ev;
        run.nodes.push({
          kind: 'note',
          key: `${id}:note:${l.seq}`,
          runId: id,
          seq: l.seq,
          level: 'info',
          label: isFirst ? `Session started · ${ev.model ?? 'model ?'} · ${tools} tools · permissions: ${ev.permissionMode ?? '?'}` : 'Session re-initialized (follow-up turn in the same process)',
          detail: isFirst ? `cwd: ${ev.cwd ?? '?'}\nsession: ${ev.session_id ?? '?'}` : undefined,
        });
        return;
      }
      // Background task lifecycle (subagents launched asynchronously, background Bash).
      if (typeof ev.subtype === 'string' && ev.subtype.startsWith('task_') && typeof ev.tool_use_id === 'string') {
        const t = run.tools.get(ev.tool_use_id);
        if (t) {
          t.task ??= { status: 'running' };
          if (ev.description) t.task.description = ev.description;
          if (ev.subtype === 'task_progress' && ev.description) t.task.lastActivity = ev.description;
          if (ev.subtype === 'task_notification') {
            t.task.status = typeof ev.status === 'string' ? ev.status : 'completed';
            if (typeof ev.summary === 'string') t.task.summary = ev.summary;
          }
        }
      }
      if (ev.subtype === 'permission_denied') {
        run.nodes.push({ kind: 'note', key: `${id}:note:${l.seq}`, runId: id, seq: l.seq, level: 'warn', label: 'Permission denied by Claude Code (headless mode cannot ask for approval)' });
        return;
      }
      const quiet = QUIET_SYSTEM_SUBTYPES.has(ev.subtype);
      if (quiet) run.hiddenCount++;
      containerFor(run, parentId, l.seq).push(rawNode(run, l, 'system', quiet));
      return;
    }
    case 'assistant': {
      const content = ev.message?.content;
      const target = containerFor(run, parentId, l.seq);
      if (!Array.isArray(content)) {
        target.push(rawNode(run, l, 'unknown_type', false));
        return;
      }
      content.forEach((b: any, i: number) => {
        const key = `${id}:${l.seq}:${i}`;
        if (b?.type === 'text') target.push({ kind: 'text', key, runId: id, seq: l.seq, text: String(b.text ?? '') });
        else if (b?.type === 'thinking' || b?.type === 'redacted_thinking') {
          target.push({ kind: 'thinking', key, runId: id, seq: l.seq, text: String(b.thinking ?? '') });
        } else if (b?.type === 'tool_use' || b?.type === 'server_tool_use') {
          const toolId = String(b.id ?? key);
          const existing = run.tools.get(toolId);
          if (existing?.placeholder) {
            // Upgrade the placeholder in place; move it under its real parent if needed.
            Object.assign(existing, { name: String(b.name), input: b.input, summary: summarizeInput(b.name, b.input), placeholder: false, parentToolUseId: parentId, seq: l.seq });
            if (parentId) {
              const idx = run.nodes.indexOf(existing);
              if (idx >= 0) run.nodes.splice(idx, 1);
              target.push(existing);
            }
            return;
          }
          const node: ToolNode = {
            kind: 'tool',
            key: `${id}:tool:${toolId}`,
            runId: id,
            seq: l.seq,
            id: toolId,
            name: String(b.name ?? '?'),
            input: b.input,
            summary: summarizeInput(String(b.name ?? ''), b.input),
            status: 'pending',
            result: null,
            parentToolUseId: parentId,
            children: [],
            task: null,
            subagentType: null,
            placeholder: false,
          };
          run.tools.set(toolId, node);
          target.push(node);
        } else {
          target.push({ kind: 'raw', key, runId: id, seq: l.seq, line: JSON.stringify(b), json: b, reason: 'unknown_type', hiddenByDefault: false });
        }
      });
      if (parentId && typeof ev.subagent_type === 'string') {
        const p = run.tools.get(parentId);
        if (p && !p.subagentType) p.subagentType = ev.subagent_type;
      }
      return;
    }
    case 'user': {
      const content = ev.message?.content;
      const target = containerFor(run, parentId, l.seq);
      if (typeof content === 'string') {
        target.push({ kind: 'user_text', key: `${id}:${l.seq}:u`, runId: id, seq: l.seq, text: content });
        return;
      }
      if (!Array.isArray(content)) {
        target.push(rawNode(run, l, 'unknown_type', false));
        return;
      }
      content.forEach((b: any, i: number) => {
        if (b?.type === 'tool_result') {
          const tool = run.tools.get(String(b.tool_use_id));
          const { parts, text } = normalizeResultContent(b.content);
          const isError = b.is_error === true;
          if (tool) {
            tool.result = { isError, parts, text, seq: l.seq };
            tool.status = isError ? 'error' : 'success';
          } else {
            target.push({ kind: 'raw', key: `${id}:${l.seq}:${i}`, runId: id, seq: l.seq, line: JSON.stringify(b), json: b, reason: 'unpaired_result', hiddenByDefault: false });
          }
        } else if (b?.type === 'text') {
          target.push({ kind: 'user_text', key: `${id}:${l.seq}:${i}`, runId: id, seq: l.seq, text: String(b.text ?? '') });
        } else {
          target.push({ kind: 'raw', key: `${id}:${l.seq}:${i}`, runId: id, seq: l.seq, line: JSON.stringify(b), json: b, reason: 'unknown_type', hiddenByDefault: false });
        }
      });
      return;
    }
    case 'result': {
      run.results.push(ev);
      if (typeof ev.session_id === 'string') run.claudeSessionId = ev.session_id;
      run.nodes.push({ kind: 'result', key: `${id}:result:${l.seq}`, runId: id, seq: l.seq, json: ev, index: run.results.length });
      return;
    }
    default: {
      const quiet = QUIET_TYPES.has(ev.type);
      if (quiet) run.hiddenCount++;
      containerFor(run, parentId, l.seq).push(rawNode(run, l, 'unknown_type', quiet));
    }
  }
}

/** Called when run meta changes; when the run is over, nothing may stay pending. */
export function applyMeta(run: RunModel, meta: RunMeta): void {
  run.meta = meta;
  if (meta.claudeSessionId && !run.claudeSessionId) run.claudeSessionId = meta.claudeSessionId;
  if (meta.status !== 'running') {
    for (const t of run.tools.values()) {
      if (t.status === 'pending') t.status = 'no_result';
      if (t.task && t.task.status === 'running') t.task.status = 'ended';
    }
  }
}

export interface Metrics {
  costUsd: number | null;
  durationMs: number | null;
  numTurns: number | null;
  sessionId: string | null;
  usage: { input: number | null; output: number | null; cacheRead: number | null; cacheWrite: number | null } | null;
  resultCount: number;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Metrics come only from the final result event; missing fields stay null (shown as "—"). */
export function extractMetrics(run: RunModel): Metrics {
  const r = run.results[run.results.length - 1];
  if (!r) return { costUsd: null, durationMs: null, numTurns: null, sessionId: run.claudeSessionId, usage: null, resultCount: 0 };
  const u = r.usage && typeof r.usage === 'object' ? r.usage : null;
  return {
    costUsd: num(r.total_cost_usd),
    durationMs: num(r.duration_ms),
    numTurns: num(r.num_turns),
    sessionId: typeof r.session_id === 'string' ? r.session_id : run.claudeSessionId,
    usage: u
      ? { input: num(u.input_tokens), output: num(u.output_tokens), cacheRead: num(u.cache_read_input_tokens), cacheWrite: num(u.cache_creation_input_tokens) }
      : null,
    resultCount: run.results.length,
  };
}

export interface OutlineItem {
  key: string;
  name: string;
  summary: string;
  status: ToolStatus;
  isSubagent: boolean;
  children: OutlineItem[];
}

export function isSubagentNode(t: ToolNode): boolean {
  return t.children.some((c) => c.kind !== 'raw' || !c.hiddenByDefault);
}

export function buildOutline(nodes: TrajNode[]): OutlineItem[] {
  const out: OutlineItem[] = [];
  for (const n of nodes) {
    if (n.kind !== 'tool') continue;
    out.push({ key: n.key, name: n.name, summary: n.summary, status: n.status, isSubagent: isSubagentNode(n), children: buildOutline(n.children) });
  }
  return out;
}

export function countTree(nodes: TrajNode[]): { events: number; tools: number } {
  let events = 0;
  let tools = 0;
  for (const n of nodes) {
    if (n.kind === 'raw' && n.hiddenByDefault) continue;
    events++;
    if (n.kind === 'tool') {
      tools++;
      const c = countTree(n.children);
      events += c.events;
      tools += c.tools;
    }
  }
  return { events, tools };
}

/** Find the chain of tool keys from the top level down to (and including) `key`. */
export function ancestorsOf(nodes: TrajNode[], key: string, path: string[] = []): string[] | null {
  for (const n of nodes) {
    if (n.key === key) return [...path, n.key];
    if (n.kind === 'tool' && n.children.length) {
      const r = ancestorsOf(n.children, key, [...path, n.key]);
      if (r) return r;
    }
  }
  return null;
}
