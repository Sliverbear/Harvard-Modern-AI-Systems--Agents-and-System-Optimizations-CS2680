import { useEffect, useRef, useState } from 'react';
import type { SessionMeta } from '../../../shared/types';
import { api } from '../api';
import { IconX } from './ui';

/**
 * "Manage history" popover: lets the user bulk-delete saved sessions (and all their runs'
 * data on disk) instead of removing them one at a time. Opens next to the History select.
 */
export function HistoryManager({
  sessions,
  currentSessionId,
  onDeleted,
}: {
  sessions: SessionMeta[];
  currentSessionId: string | null;
  onDeleted: (deletedIds: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape, like the other menus in this app.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggleOpen = () => {
    setError(null);
    setChecked(new Set());
    setOpen((v) => !v);
  };

  const toggleOne = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allChecked = sessions.length > 0 && checked.size === sessions.length;
  const toggleAll = () => setChecked(allChecked ? new Set() : new Set(sessions.map((s) => s.id)));

  const deleteSelected = async () => {
    if (checked.size === 0) return;
    const ids = [...checked];
    const label = ids.length === 1 ? '1 session' : `${ids.length} sessions`;
    if (!window.confirm(`Delete ${label}? This removes all of their runs and events from disk. This cannot be undone.`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.deleteSessions(ids);
      onDeleted(res.deleted);
      setChecked(new Set());
      if (res.skipped.length) {
        setError(res.skipped.map((s) => `${s.id.slice(0, 12)}…: ${s.reason}`).join(' '));
      } else {
        setOpen(false);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative" ref={boxRef}>
      <button type="button" className="btn btn-ghost" onClick={toggleOpen} aria-expanded={open} data-testid="manage-history">
        Manage…
      </button>
      {open && (
        <div
          className="absolute right-0 top-full z-30 mt-1 w-80 rounded-lg border border-slate-200 bg-white p-2 shadow-xl dark:border-slate-700 dark:bg-slate-900"
          role="dialog"
          aria-label="Manage session history"
        >
          <div className="flex items-center justify-between px-1 py-1">
            <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
              <input type="checkbox" checked={allChecked} onChange={toggleAll} disabled={sessions.length === 0} />
              Select all ({sessions.length})
            </label>
            <button type="button" className="btn btn-ghost px-1.5 py-0.5" onClick={() => setOpen(false)} aria-label="Close">
              <IconX cls="h-3.5 w-3.5" />
            </button>
          </div>
          <ul className="max-h-64 overflow-y-auto" data-testid="history-manager-list">
            {sessions.length === 0 && <li className="px-1 py-2 text-xs text-slate-500">No saved sessions.</li>}
            {sessions.map((s) => (
              <li key={s.id} className="flex items-start gap-2 rounded px-1 py-1 text-xs hover:bg-slate-50 dark:hover:bg-slate-800/60">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={checked.has(s.id)}
                  onChange={() => toggleOne(s.id)}
                  aria-label={`Select session ${s.title}`}
                />
                <span className="min-w-0 flex-1 truncate" title={s.title}>
                  {s.mode === 'replay' ? '[REPLAY] ' : ''}
                  {new Date(s.createdAt).toLocaleString()} — {s.title.slice(0, 40)}
                  {s.id === currentSessionId && <span className="ml-1 text-teal-600 dark:text-teal-400">(current)</span>}
                </span>
              </li>
            ))}
          </ul>
          {error && <p role="alert" className="mt-1 px-1 text-xs text-rose-600 dark:text-rose-400">{error}</p>}
          <div className="mt-2 flex justify-end gap-2 border-t border-slate-100 pt-2 dark:border-slate-800">
            <button
              type="button"
              className="btn btn-danger"
              onClick={deleteSelected}
              disabled={checked.size === 0 || busy}
              data-testid="delete-selected"
            >
              {busy ? 'Deleting…' : `Delete selected (${checked.size})`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
