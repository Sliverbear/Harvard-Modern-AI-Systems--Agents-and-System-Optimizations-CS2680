import { buildOutline, type OutlineItem, type RunModel } from '../../../shared/trajectory';
import { RunStatusBadge, ToolStatusBadge } from './ui';

function Items({ items, onJump, depth }: { items: OutlineItem[]; onJump: (key: string) => void; depth: number }) {
  return (
    <ul className={depth ? 'ml-2.5 border-l border-slate-200 pl-2 dark:border-slate-700' : ''}>
      {items.map((it) => (
        <li key={it.key}>
          <button
            type="button"
            data-outline-key={it.key}
            onClick={() => onJump(it.key)}
            className="flex w-full min-w-0 items-center gap-1.5 rounded px-1.5 py-1 text-left text-[12.5px] hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 dark:hover:bg-slate-800"
            title={it.summary}
          >
            <ToolStatusBadge status={it.status} compact />
            <span className="shrink-0 font-mono font-semibold">{it.name}</span>
            {it.isSubagent && <span className="chip shrink-0 bg-indigo-50 px-1 text-[10px] text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">sub</span>}
            <span className="min-w-0 truncate font-mono text-slate-500">{it.summary}</span>
          </button>
          {it.children.length > 0 && <Items items={it.children} onJump={onJump} depth={depth + 1} />}
        </li>
      ))}
    </ul>
  );
}

export function Outline({ runs, onJump }: { runs: RunModel[]; onJump: (key: string) => void }) {
  if (!runs.length) return <p className="px-2 text-sm text-slate-500">Tool calls will be listed here.</p>;
  return (
    <nav aria-label="Tool call outline" className="space-y-3" data-testid="outline">
      {runs.map((r) => {
        const items = buildOutline(r.nodes);
        return (
          <div key={r.meta.id}>
            <button type="button" onClick={() => onJump(`run:${r.meta.id}`)} className="mb-1 flex w-full items-center gap-2 px-1.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-800 dark:hover:text-slate-200">
              Run {r.meta.index} <RunStatusBadge status={r.meta.status} />
            </button>
            {items.length ? <Items items={items} onJump={onJump} depth={0} /> : <p className="px-1.5 text-xs italic text-slate-400">no tool calls</p>}
          </div>
        );
      })}
    </nav>
  );
}
