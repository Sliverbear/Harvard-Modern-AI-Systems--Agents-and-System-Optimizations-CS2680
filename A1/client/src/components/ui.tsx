import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { RunStatus } from '../../../shared/types';
import type { ToolStatus } from '../../../shared/trajectory';

// ---------- icons (inline SVG, aria-hidden; status is always paired with a text label) ----------
const svg = (d: ReactNode, cls = 'h-4 w-4') => (
  <svg viewBox="0 0 24 24" className={cls} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d}
  </svg>
);
export const IconCheck = ({ cls }: { cls?: string }) => svg(<path d="M5 12.5l4.5 4.5L19 7.5" />, cls);
export const IconX = ({ cls }: { cls?: string }) => svg(<path d="M6 6l12 12M18 6L6 18" />, cls);
export const IconStop = ({ cls }: { cls?: string }) => svg(<rect x="6.5" y="6.5" width="11" height="11" rx="1.5" />, cls);
export const IconSlash = ({ cls }: { cls?: string }) => svg(<><circle cx="12" cy="12" r="8" /><path d="M7 17L17 7" /></>, cls);
export const IconChevron = ({ open, cls }: { open: boolean; cls?: string }) => (
  <svg viewBox="0 0 24 24" className={`${cls ?? 'h-4 w-4'} transition-transform ${open ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" strokeWidth={2.4} aria-hidden="true">
    <path d="M9 6l6 6-6 6" />
  </svg>
);
export const IconBranch = ({ cls }: { cls?: string }) => svg(<><circle cx="6" cy="5" r="2" /><circle cx="6" cy="19" r="2" /><circle cx="18" cy="12" r="2" /><path d="M6 7v10M6 12h10" /></>, cls);
export const IconPlay = ({ cls }: { cls?: string }) => svg(<path d="M7 5l12 7-12 7z" />, cls);
export const IconLock = ({ cls }: { cls?: string }) => svg(<><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 018 0v3" /></>, cls);
export const IconMoon = ({ cls }: { cls?: string }) => svg(<path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z" />, cls);
export const IconSun = ({ cls }: { cls?: string }) => svg(<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>, cls);
export const IconList = ({ cls }: { cls?: string }) => svg(<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />, cls);
export const IconDown = ({ cls }: { cls?: string }) => svg(<path d="M12 5v14M6 13l6 6 6-6" />, cls);

export function Spinner({ cls = 'h-4 w-4' }: { cls?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`${cls} animate-spin`} fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

// ---------- status ----------
const TOOL_STATUS: Record<ToolStatus, { label: string; cls: string; icon: ReactNode }> = {
  pending: { label: 'running', cls: 'text-amber-700 bg-amber-50 dark:text-amber-300 dark:bg-amber-950/60', icon: <Spinner cls="h-3.5 w-3.5" /> },
  success: { label: 'ok', cls: 'text-emerald-700 bg-emerald-50 dark:text-emerald-300 dark:bg-emerald-950/60', icon: <IconCheck cls="h-3.5 w-3.5" /> },
  error: { label: 'error', cls: 'text-rose-700 bg-rose-50 dark:text-rose-300 dark:bg-rose-950/60', icon: <IconX cls="h-3.5 w-3.5" /> },
  no_result: { label: 'no result', cls: 'text-slate-600 bg-slate-100 dark:text-slate-300 dark:bg-slate-800', icon: <IconSlash cls="h-3.5 w-3.5" /> },
};

export function ToolStatusBadge({ status, compact }: { status: ToolStatus; compact?: boolean }) {
  const s = TOOL_STATUS[status];
  return (
    <span className={`chip ${s.cls}`} data-status={status} title={`tool status: ${s.label}`}>
      {s.icon}
      {compact ? <span className="sr-only">{s.label}</span> : s.label}
    </span>
  );
}

const RUN_STATUS: Record<RunStatus, { label: string; cls: string; icon: ReactNode }> = {
  running: { label: 'Running', cls: 'text-amber-800 bg-amber-100 border-amber-300 dark:text-amber-200 dark:bg-amber-950 dark:border-amber-800', icon: <Spinner cls="h-3.5 w-3.5" /> },
  finished: { label: 'Finished', cls: 'text-emerald-800 bg-emerald-100 border-emerald-300 dark:text-emerald-200 dark:bg-emerald-950 dark:border-emerald-800', icon: <IconCheck cls="h-3.5 w-3.5" /> },
  failed: { label: 'Failed', cls: 'text-rose-800 bg-rose-100 border-rose-300 dark:text-rose-200 dark:bg-rose-950 dark:border-rose-800', icon: <IconX cls="h-3.5 w-3.5" /> },
  cancelled: { label: 'Cancelled', cls: 'text-slate-700 bg-slate-100 border-slate-300 dark:text-slate-200 dark:bg-slate-800 dark:border-slate-600', icon: <IconStop cls="h-3.5 w-3.5" /> },
};

export function RunStatusBadge({ status }: { status: RunStatus }) {
  const s = RUN_STATUS[status];
  return (
    <span className={`chip border ${s.cls}`} data-run-status={status} role="status">
      {s.icon}
      {s.label}
    </span>
  );
}

export function ReplayBadge() {
  return (
    <span className="chip border border-violet-300 bg-violet-100 font-bold tracking-wide text-violet-800 dark:border-violet-700 dark:bg-violet-950 dark:text-violet-200" title="Replayed from a saved events.jsonl — not a live run, no model calls">
      <IconPlay cls="h-3 w-3" /> REPLAY
    </span>
  );
}

// ---------- expand/collapse state shared by transcript + outline ----------
interface ExpandCtx {
  isOpen(key: string, dflt: boolean): boolean;
  toggle(key: string, dflt: boolean): void;
  openMany(keys: string[]): void;
}
const Ctx = createContext<ExpandCtx | null>(null);

export function ExpandProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Record<string, boolean>>({});
  const isOpen = useCallback((k: string, d: boolean) => state[k] ?? d, [state]);
  const toggle = useCallback((k: string, d: boolean) => setState((s) => ({ ...s, [k]: !(s[k] ?? d) })), []);
  const openMany = useCallback((keys: string[]) => setState((s) => ({ ...s, ...Object.fromEntries(keys.map((k) => [k, true])) })), []);
  const v = useMemo(() => ({ isOpen, toggle, openMany }), [isOpen, toggle, openMany]);
  return <Ctx.Provider value={v}>{children}</Ctx.Provider>;
}

export function useExpand(): ExpandCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('ExpandProvider missing');
  return c;
}
