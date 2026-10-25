// Markdown export of one run: meta, metrics, tool calls, the full transcript and the raw stream.
// Pure TypeScript (no DOM, no Node APIs), like trajectory.ts.

import { extractMetrics, type RunModel, type TrajNode, type ToolNode } from './trajectory.ts';
import type { StreamLine } from './types.ts';

const dash = (v: unknown): string => (v === null || v === undefined || v === '' ? '—' : String(v));
const usd = (v: number | null): string => (v === null ? '—' : `$${v.toFixed(4)}`);
const ms = (v: number | null): string => (v === null ? '—' : `${(v / 1000).toFixed(1)} s`);

/** Escape a value for a single Markdown table cell. */
const cell = (v: unknown): string => dash(v).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');

/** Fenced code block whose fence is longer than any backtick run inside the text. */
export function fence(text: string, lang = ''): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((s) => s.length));
  const f = '`'.repeat(Math.max(3, longest + 1));
  return `${f}${lang}\n${text.replace(/\n$/, '')}\n${f}`;
}

const json = (v: unknown): string => {
  try {
    return JSON.stringify(v, null, 2) ?? String(v);
  } catch {
    return String(v);
  }
};

function flattenTools(nodes: TrajNode[], depth = 0, out: { tool: ToolNode; depth: number }[] = []) {
  for (const n of nodes) {
    if (n.kind !== 'tool') continue;
    out.push({ tool: n, depth });
    flattenTools(n.children, depth + 1, out);
  }
  return out;
}

export interface ExportOptions {
  /** Append the raw events.jsonl (default true). */
  raw?: boolean;
  /** Cut each tool result to this many characters (default: no limit). */
  maxResultChars?: number;
}

type TimeOf = (seq: number) => number | null;

function clip(text: string, max: number | undefined): string {
  if (!max || text.length <= max) return text;
  return `${text.slice(0, max)}
… [${text.length - max} more characters cut from this export]`;
}

function transcript(nodes: TrajNode[], depth: number, out: string[], opts: ExportOptions, timeOf: TimeOf): void {
  const h = '#'.repeat(Math.min(6, 4 + depth));
  for (const n of nodes) {
    switch (n.kind) {
      case 'text':
        out.push(`**Assistant**\n\n${n.text}`);
        break;
      case 'thinking':
        out.push(n.text.trim() ? `> _thinking:_ ${n.text.replace(/\n/g, '\n> ')}` : '> _thinking (content not included in stream)_');
        break;
      case 'user_text':
        out.push(`**User**\n\n${n.text}`);
        break;
      case 'note':
        out.push(`> ${n.level === 'info' ? 'ℹ' : n.level === 'warn' ? '⚠' : '✕'} ${n.label}${n.detail ? `\n>\n> ${n.detail.replace(/\n/g, '  \n> ')}` : ''}`);
        break;
      case 'result': {
        const r = n.json ?? {};
        out.push(`**Result event #${n.index}:** \`${dash(r.subtype)}\`${r.is_error ? ' (error)' : ''} · cost ${usd(typeof r.total_cost_usd === 'number' ? r.total_cost_usd : null)} · ${ms(typeof r.duration_ms === 'number' ? r.duration_ms : null)} · ${dash(r.num_turns)} turns`);
        break;
      }
      case 'raw':
        if (n.hiddenByDefault) break;
        out.push(`_raw event (${n.reason})_\n\n${fence(n.json ? json(n.json) : n.line, 'json')}`);
        break;
      case 'tool': {
        const sub = n.children.length ? ` · subagent${n.subagentType ? ` \`${n.subagentType}\`` : ''}` : '';
        out.push(`${h} ${n.name} — ${n.status}${sub}\n\n\`${n.id}\` · at ${ms(timeOf(n.seq))}${n.summary ? ` · ${n.summary.replace(/`/g, "'")}` : ''}`);
        out.push(`Input\n\n${fence(json(n.input), 'json')}`);
        if (n.result) out.push(`Result${n.result.isError ? ' (error)' : ''}\n\n${fence(clip(n.result.text, opts.maxResultChars))}`);
        else out.push('_No result._');
        if (n.task) out.push(`Background task: ${n.task.status}${n.task.summary ? ` — ${n.task.summary}` : ''}`);
        if (n.children.length) {
          transcript(n.children, depth + 1, out, opts, timeOf);
          out.push(`_End of ${n.name} \`${n.id}\`_`);
        }
        break;
      }
    }
  }
}

/** Build the Markdown document for a run. `lines` are the raw stdout lines, in order. */
export function runToMarkdown(run: RunModel, lines: StreamLine[], opts: ExportOptions = {}): string {
  const m = run.meta;
  const times = new Map(lines.map((l) => [l.seq, l.t]));
  const timeOf: TimeOf = (seq) => times.get(seq) ?? null;
  const took = (t: ToolNode): string => {
    const a = timeOf(t.seq);
    const b = t.result ? timeOf(t.result.seq) : null;
    return a !== null && b !== null ? ms(b - a) : '—';
  };
  const metrics = extractMetrics(run);
  const wall = m.mode === 'live' && m.endedAt ? Date.parse(m.endedAt) - Date.parse(m.startedAt) : null;
  const init = run.init ?? {};
  const out: string[] = [];

  out.push(`# Mads-Lens run ${m.index}${m.mode === 'replay' ? ' (replay)' : ''}`);
  out.push(`## Prompt\n\n${fence(m.prompt)}`);

  const rows: [string, unknown][] = [
    ['Status', m.status],
    ['Mode', m.mode === 'replay' ? `replay (fixtures/${dash(m.replaySource)})` : 'live'],
    ['Started', m.startedAt],
    ['Ended', m.endedAt],
    ['Working directory', m.cwd],
    ['Model', init.model],
    ['Permission mode', init.permissionMode],
    ['Claude Code version', init.claude_code_version],
    ['Claude session id', metrics.sessionId],
    ['Resumed session', m.resumeClaudeSessionId],
    ['Mads-Lens session / run', `${m.sessionId} / ${m.id}`],
    ['Exit code / signal', `${dash(m.exitCode)} / ${dash(m.signal)}`],
    ['Result subtype', m.resultSubtype],
    ['Error', m.error],
    ['Allowed tools', m.dangerouslySkipPermissions ? '--dangerously-skip-permissions' : m.allowedTools.join(', ')],
    ['CLI args', m.args.join(' ')],
  ];
  out.push(`## Run\n\n| Field | Value |\n|---|---|\n${rows.map(([k, v]) => `| ${k} | ${cell(v)} |`).join('\n')}`);

  const u = metrics.usage;
  const mrows: [string, unknown][] = [
    ['Cost', usd(metrics.costUsd)],
    ['Duration (CLI)', ms(metrics.durationMs)],
    ['Wall clock', m.mode === 'replay' ? '— (replay)' : ms(wall)],
    ['Turns', metrics.numTurns],
    ['Tokens in / out', u ? `${dash(u.input)} / ${dash(u.output)}` : null],
    ['Cache read / write', u ? `${dash(u.cacheRead)} / ${dash(u.cacheWrite)}` : null],
    ['Result events', metrics.resultCount],
    ['Raw lines / hidden system events / malformed', `${run.lineCount} / ${run.hiddenCount} / ${run.malformedCount}`],
  ];
  out.push(`## Metrics\n\n| Metric | Value |\n|---|---|\n${mrows.map(([k, v]) => `| ${k} | ${cell(v)} |`).join('\n')}`);
  if (metrics.resultCount > 1) out.push('_This run emitted more than one result event; metrics show the last one._');

  const tools = flattenTools(run.nodes);
  out.push(
    `## Tool calls (${tools.length})\n\n` +
      (tools.length
        ? `| # | Tool | Status | At | Took | Input |\n|---|---|---|---|---|---|\n${tools.map(({ tool, depth }, i) => `| ${i + 1} | ${'↳ '.repeat(depth)}${cell(tool.name)} | ${tool.status} | ${ms(timeOf(tool.seq))} | ${took(tool)} | ${cell(tool.summary)} |`).join('\n')}`
        : '_None._'),
  );

  const body: string[] = [];
  transcript(run.nodes, 0, body, opts, timeOf);
  out.push(`## Transcript\n\n${body.length ? body.join('\n\n') : '_No events._'}`);

  if (run.stderr.trim()) out.push(`## stderr\n\n${fence(run.stderr)}`);

  if (opts.raw === false) return out.join('\n\n') + '\n';
  const raw = lines.map((l) => l.line).join('\n');
  out.push(`## Raw stream (${lines.length} lines)\n\n<details><summary>events.jsonl</summary>\n\n${fence(raw, 'jsonl')}\n\n</details>`);

  return out.join('\n\n') + '\n';
}
