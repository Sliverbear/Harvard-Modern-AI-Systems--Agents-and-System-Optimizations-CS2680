import { memo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { countTree, isSubagentNode, type RawNode, type ToolNode, type TrajNode } from '../../../shared/trajectory';
import { formatDuration, formatUsd } from '../api';
import { IconBranch, IconChevron, Spinner, ToolStatusBadge, useExpand } from './ui';

export const RESULT_PREVIEW_LINES = 10;

export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{ a: ({ node: _n, ...p }) => <a {...p} target="_blank" rel="noopener noreferrer" /> }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});

function JsonBlock({ value }: { value: unknown }) {
  let s: string;
  try {
    s = JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    s = String(value);
  }
  return <pre className="mono max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md bg-slate-100 p-2.5 dark:bg-slate-950/70">{s}</pre>;
}

/** Tool output, folded to the first N lines; full output scrolls inside a bounded box. */
export function FoldedText({ text, isError, nodeKey }: { text: string; isError: boolean; nodeKey: string }) {
  const { isOpen, toggle } = useExpand();
  const lines = text.replace(/\n+$/, '').split('\n');
  const extra = lines.length - RESULT_PREVIEW_LINES;
  const k = `${nodeKey}:full`;
  const full = isOpen(k, false);
  const shown = full || extra <= 0 ? text.replace(/\n+$/, '') : lines.slice(0, RESULT_PREVIEW_LINES).join('\n');
  return (
    <div>
      <pre
        data-testid="tool-output"
        className={`mono overflow-auto whitespace-pre-wrap break-words rounded-md p-2.5 ${full ? 'max-h-[28rem]' : ''} ${
          isError ? 'bg-rose-50 text-rose-900 ring-1 ring-rose-200 dark:bg-rose-950/40 dark:text-rose-100 dark:ring-rose-900' : 'bg-slate-100 dark:bg-slate-950/70'
        }`}
      >
        {shown || <span className="italic text-slate-500">(empty output)</span>}
      </pre>
      {extra > 0 && (
        <button type="button" className="mt-1 text-xs font-medium text-teal-700 hover:underline dark:text-teal-400" onClick={() => toggle(k, false)} aria-expanded={full}>
          {full ? '▾ show less' : `▸ ${extra} more line${extra === 1 ? '' : 's'}`}
        </button>
      )}
    </div>
  );
}

function ToolResult({ t }: { t: ToolNode }) {
  if (!t.result) {
    if (t.status === 'pending') return <div className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-300"><Spinner cls="h-3 w-3" /> waiting for result…</div>;
    return <div className="text-xs italic text-slate-500">No result was received before the run ended.</div>;
  }
  const r = t.result;
  return (
    <div className="space-y-1.5">
      <div className={`text-[11px] font-semibold uppercase tracking-wide ${r.isError ? 'text-rose-700 dark:text-rose-300' : 'text-slate-500'}`}>{r.isError ? 'Error result' : 'Result'}</div>
      {r.parts.some((p) => p.type === 'text') || r.parts.length === 0 ? <FoldedText text={r.parts.filter((p) => p.type === 'text').map((p) => (p as any).text).join('\n')} isError={r.isError} nodeKey={t.key} /> : null}
      {r.parts.map((p, i) =>
        p.type === 'image' ? (
          p.data ? <img key={i} alt="tool result image" className="max-h-80 rounded border border-slate-200 dark:border-slate-700" src={`data:${p.mediaType};base64,${p.data}`} /> : <div key={i} className="text-xs italic">[image {p.mediaType}]</div>
        ) : p.type === 'other' ? (
          <JsonBlock key={i} value={p.json} />
        ) : null,
      )}
    </div>
  );
}

function subagentState(t: ToolNode): { label: string; running: boolean; failed: boolean } {
  const s = t.task?.status ?? (t.status === 'pending' ? 'running' : t.status === 'error' ? 'failed' : t.status === 'no_result' ? 'ended' : 'completed');
  return { label: s, running: s === 'running', failed: s === 'failed' || s === 'error' || s === 'killed' };
}

export function ToolCall({ t, showAll }: { t: ToolNode; showAll: boolean }) {
  const { isOpen, toggle } = useExpand();
  const sub = isSubagentNode(t);
  const detailsKey = `${t.key}:details`;
  const groupKey = `${t.key}:group`;
  const open = isOpen(detailsKey, false);
  const groupOpen = isOpen(groupKey, true);
  const counts = sub ? countTree(t.children) : null;
  const st = sub ? subagentState(t) : null;
  return (
    <div data-node-key={t.key} data-tool-name={t.name} className="rounded-md border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/60">
      <button type="button" className="flex w-full min-w-0 items-center gap-2 px-2.5 py-1.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800/50" onClick={() => toggle(detailsKey, false)} aria-expanded={open} title={open ? 'Hide input' : 'Show full input'}>
        <IconChevron open={open} cls="h-3.5 w-3.5 shrink-0 text-slate-400" />
        <ToolStatusBadge status={t.status} compact />
        <span className="shrink-0 font-mono text-[13px] font-semibold text-slate-900 dark:text-slate-100">{t.name}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-slate-600 dark:text-slate-400" title={t.summary}>{t.summary}</span>
        {t.result && !open && t.result.isError && <span className="chip shrink-0 bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300">failed</span>}
      </button>
      {open && (
        <div className="border-t border-slate-100 px-3 py-2 dark:border-slate-800">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Input</div>
          <JsonBlock value={t.input} />
        </div>
      )}
      {sub && counts && st && (
        <div className="border-t border-slate-100 dark:border-slate-800" data-subagent-group={t.id}>
          <button type="button" onClick={() => toggle(groupKey, true)} aria-expanded={groupOpen} className="flex w-full items-center gap-2 bg-indigo-50/60 px-2.5 py-1.5 text-left text-xs text-indigo-900 hover:bg-indigo-50 dark:bg-indigo-950/30 dark:text-indigo-200 dark:hover:bg-indigo-950/50">
            <IconChevron open={groupOpen} cls="h-3.5 w-3.5" />
            <IconBranch cls="h-3.5 w-3.5" />
            <span className="font-semibold">Subagent{t.subagentType ? ` · ${t.subagentType}` : ''}</span>
            <span className={`chip ${st.running ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200' : st.failed ? 'bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-200' : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200'}`}>
              {st.running ? <Spinner cls="h-3 w-3" /> : null}
              {st.label}
            </span>
            <span className="text-indigo-700/80 dark:text-indigo-300/80">· {counts.events} events, {counts.tools} tools</span>
            {st.running && t.task?.lastActivity && <span className="truncate text-indigo-700/70 dark:text-indigo-300/70">· {t.task.lastActivity}</span>}
          </button>
          {groupOpen && (
            <div className="ml-3 border-l-2 border-indigo-200 py-2 pl-3 pr-2 dark:border-indigo-900">
              <NodeList nodes={t.children} showAll={showAll} />
            </div>
          )}
        </div>
      )}
      <div className={`px-3 pb-2 ${sub ? 'border-t border-slate-100 pt-2 dark:border-slate-800' : 'pt-0.5'}`}>
        <ToolResult t={t} />
      </div>
    </div>
  );
}

function RawRow({ n }: { n: RawNode }) {
  const [open, setOpen] = useState(false);
  const label =
    n.reason === 'malformed' ? 'Malformed line (not valid JSON) — recorded, skipped' : n.reason === 'unpaired_result' ? 'tool_result without a matching tool call' : `raw event · ${(n.json as any)?.type ?? '?'}${(n.json as any)?.subtype ? `/${(n.json as any).subtype}` : ''}`;
  const warn = n.reason === 'malformed' || n.reason === 'unpaired_result';
  return (
    <div data-node-key={n.key} data-raw-reason={n.reason} className={`rounded border border-dashed px-2 py-1 text-xs ${warn ? 'border-amber-400 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200' : 'border-slate-300 text-slate-500 dark:border-slate-700 dark:text-slate-400'}`}>
      <button type="button" className="flex items-center gap-1.5" onClick={() => setOpen(!open)} aria-expanded={open}>
        <IconChevron open={open} cls="h-3 w-3" />
        <span className="font-mono">{warn ? '⚠ ' : ''}{label}</span>
      </button>
      {open && <pre className="mono mt-1 max-h-72 overflow-auto whitespace-pre-wrap break-all">{n.json ? JSON.stringify(n.json, null, 2) : n.line}</pre>}
    </div>
  );
}

export function NodeView({ n, showAll }: { n: TrajNode; showAll: boolean }) {
  switch (n.kind) {
    case 'text':
      return <div data-node-key={n.key} className="px-0.5"><Markdown text={n.text} /></div>;
    case 'thinking':
      return (
        <details data-node-key={n.key} className="text-xs text-slate-500">
          <summary className="cursor-pointer select-none italic">thinking{n.text ? '' : ' (content not included in stream)'}</summary>
          {n.text && <div className="mt-1 whitespace-pre-wrap border-l-2 border-slate-200 pl-2 dark:border-slate-700">{n.text}</div>}
        </details>
      );
    case 'user_text':
      return (
        <div data-node-key={n.key} className="rounded-md bg-sky-50 px-2.5 py-1.5 text-sm text-sky-900 dark:bg-sky-950/40 dark:text-sky-100">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-300">Prompt</div>
          <div className="whitespace-pre-wrap">{n.text}</div>
        </div>
      );
    case 'note':
      return (
        <div data-node-key={n.key} className={`text-xs ${n.level === 'warn' ? 'text-amber-700 dark:text-amber-300' : n.level === 'error' ? 'text-rose-700' : 'text-slate-500 dark:text-slate-400'}`} title={n.detail}>
          {n.level === 'warn' ? '⚠ ' : '• '}
          {n.label}
        </div>
      );
    case 'result': {
      const r = n.json;
      const ok = r.subtype === 'success' && !r.is_error;
      return (
        <div data-node-key={n.key} className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded border px-2 py-1 text-xs ${ok ? 'border-emerald-200 text-emerald-800 dark:border-emerald-900 dark:text-emerald-300' : 'border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200'}`}>
          <span className="font-semibold">{ok ? '✓' : '✕'} result event #{n.index}: {String(r.subtype)}</span>
          <span>{formatUsd(typeof r.total_cost_usd === 'number' ? r.total_cost_usd : null)}</span>
          <span>{formatDuration(typeof r.duration_ms === 'number' ? r.duration_ms : null)}</span>
          <span>{typeof r.num_turns === 'number' ? `${r.num_turns} turns` : '— turns'}</span>
        </div>
      );
    }
    case 'raw':
      if (n.hiddenByDefault && !showAll) return null;
      return <RawRow n={n} />;
    case 'tool':
      return <ToolCall t={n} showAll={showAll} />;
  }
}

export function NodeList({ nodes, showAll }: { nodes: TrajNode[]; showAll: boolean }) {
  return (
    <div className="space-y-2">
      {nodes.map((n) => (
        <NodeView key={n.key} n={n} showAll={showAll} />
      ))}
    </div>
  );
}
