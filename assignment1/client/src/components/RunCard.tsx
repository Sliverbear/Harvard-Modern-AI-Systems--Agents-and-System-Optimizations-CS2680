import { useState } from 'react';
import { extractMetrics, type RunModel } from '../../../shared/trajectory';
import { formatDuration, formatTokens, formatUsd } from '../api';
import { NodeList } from './Trajectory';
import { IconChevron, ReplayBadge, RunStatusBadge, useExpand } from './ui';

function Metric({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[10.5px] font-semibold uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`truncate text-sm font-semibold text-slate-900 dark:text-slate-100 ${mono ? 'font-mono text-[12.5px]' : ''}`} title={value}>{value}</div>
    </div>
  );
}

export function MetricsBar({ run }: { run: RunModel }) {
  const m = extractMetrics(run);
  return (
    <div data-testid="metrics" className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-slate-100 bg-slate-50/70 px-4 py-2.5 sm:grid-cols-4 xl:grid-cols-7 dark:border-slate-800 dark:bg-slate-950/40">
      <Metric label="Cost" value={formatUsd(m.costUsd)} />
      <Metric label="Duration" value={formatDuration(m.durationMs)} />
      <Metric label="Wall clock" value={run.meta.mode === 'replay' ? '— (replay)' : run.meta.endedAt ? formatDuration(Date.parse(run.meta.endedAt) - Date.parse(run.meta.startedAt)) : '—'} />
      <Metric label="Turns" value={m.numTurns === null ? '—' : String(m.numTurns)} />
      <Metric label="Tokens in / out" value={m.usage ? `${formatTokens(m.usage.input)} / ${formatTokens(m.usage.output)}` : '—'} />
      <Metric label="Cache read / write" value={m.usage ? `${formatTokens(m.usage.cacheRead)} / ${formatTokens(m.usage.cacheWrite)}` : '—'} />
      <Metric label="Session" value={m.sessionId ?? '—'} mono />
      {m.resultCount > 1 && (
        <div className="col-span-full text-xs text-slate-500">
          This run emitted {m.resultCount} result events (e.g. a background subagent finished after the first turn). Metrics show the last one; each is listed in the transcript.
        </div>
      )}
    </div>
  );
}

export function RunCard({ run, isLast }: { run: RunModel; isLast: boolean }) {
  const { isOpen, toggle } = useExpand();
  const [showAll, setShowAll] = useState(false);
  const k = `run:${run.meta.id}`;
  const open = isOpen(k, isLast || run.meta.status === 'running');
  const meta = run.meta;
  const started = new Date(meta.startedAt);
  return (
    <section data-run-id={meta.id} data-testid="run-card" className="card overflow-hidden shadow-sm">
      <header className="flex flex-wrap items-start gap-x-3 gap-y-1.5 px-4 py-3">
        <button type="button" onClick={() => toggle(k, isLast)} aria-expanded={open} className="mt-0.5 rounded p-0.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label={open ? 'Fold run' : 'Unfold run'}>
          <IconChevron open={open} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">Run {meta.index}</span>
            <RunStatusBadge status={meta.status} />
            {meta.mode === 'replay' && <ReplayBadge />}
            {meta.resumeClaudeSessionId && (
              <span className="chip bg-sky-50 text-sky-800 dark:bg-sky-950/60 dark:text-sky-200" data-testid="resumed-label">
                ↻ resumed session <span className="font-mono">{meta.resumeClaudeSessionId.slice(0, 8)}…</span>
              </span>
            )}
            <span className="text-xs text-slate-500" title={meta.startedAt}>{started.toLocaleTimeString()}</span>
          </div>
          <p className={`mt-1 whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300 ${open ? '' : 'line-clamp-1'}`}>{meta.prompt}</p>
          {meta.replaySource && <p className="mt-0.5 text-xs text-violet-700 dark:text-violet-300">source: fixtures/{meta.replaySource}</p>}
        </div>
      </header>

      {meta.status === 'failed' && meta.error && (
        <div role="alert" data-testid="run-error" className="mx-4 mb-3 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-900 dark:border-rose-800 dark:bg-rose-950/50 dark:text-rose-100">
          <div className="font-semibold">✕ Run failed</div>
          <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-xs">{meta.error}</pre>
          <div className="mt-1 text-xs opacity-80">
            exit code: {meta.exitCode ?? '—'} · signal: {meta.signal ?? '—'} · result: {meta.resultSubtype ?? 'none'} · cwd: <span className="font-mono">{meta.cwd}</span>
          </div>
        </div>
      )}
      {meta.status === 'cancelled' && <div className="mx-4 mb-3 rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800/60">■ Cancelled — the claude process was terminated.</div>}

      {open && (
        <div className="space-y-2 border-t border-slate-100 px-4 py-3 dark:border-slate-800" data-testid="trajectory">
          {run.nodes.length === 0 && meta.status === 'running' && <div className="text-sm text-slate-500">Waiting for the first event from Claude Code…</div>}
          <NodeList nodes={run.nodes} showAll={showAll} />
          {(run.hiddenCount > 0 || run.malformedCount > 0) && (
            <div className="flex flex-wrap items-center gap-3 pt-1 text-xs text-slate-500">
              <span>{run.lineCount} raw lines · {run.hiddenCount} low-level system events hidden{run.malformedCount ? ` · ${run.malformedCount} malformed` : ''}</span>
              <button type="button" className="font-medium text-teal-700 hover:underline dark:text-teal-400" onClick={() => setShowAll(!showAll)}>
                {showAll ? 'hide system events' : 'show all events'}
              </button>
              <a className="font-medium text-teal-700 hover:underline dark:text-teal-400" href={`/api/runs/${meta.id}/events`} target="_blank" rel="noreferrer">raw JSON</a>
            </div>
          )}
          {run.stderr.trim() && meta.status !== 'failed' && (
            <details className="text-xs text-slate-500"><summary className="cursor-pointer">stderr</summary><pre className="mono whitespace-pre-wrap">{run.stderr}</pre></details>
          )}
        </div>
      )}
      {meta.status !== 'running' && <MetricsBar run={run} />}
    </section>
  );
}
