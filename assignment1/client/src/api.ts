import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { ServerConfigView, ServerMessage, SessionMeta } from '../../shared/types';
import { SessionModel } from '../../shared/sessionModel';

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((data as any).error ?? `HTTP ${r.status}`);
  return data as T;
}

export const api = {
  config: () => req<ServerConfigView>('GET', '/api/config'),
  sessions: () => req<SessionMeta[]>('GET', '/api/sessions'),
  validateCwd: (cwd: string) => req<{ ok: boolean; path?: string; error?: string }>('POST', '/api/validate-cwd', { cwd }),
  startRun: (b: { sessionId: string | null; cwd: string; prompt: string }) => req<{ session: SessionMeta }>('POST', '/api/runs', b),
  cancel: (runId: string) => req('POST', `/api/runs/${runId}/cancel`),
  fixtures: () => req<{ name: string; runs: number; synthetic: boolean }[]>('GET', '/api/fixtures'),
  replay: (fixture: string, speed: string) => req<{ session: SessionMeta }>('POST', '/api/replay', { fixture, speed }),
};

export type Conn = 'idle' | 'connecting' | 'open' | 'error';

/** Subscribe to a session's SSE stream and keep a SessionModel up to date (re-render at most once per frame). */
export function useSessionModel(sessionId: string | null) {
  const model = useMemo(() => new SessionModel(), [sessionId]);
  const [conn, setConn] = useState<Conn>('idle');
  const listeners = useRef(new Set<() => void>());
  const snap = useRef(0);

  useEffect(() => {
    if (!sessionId) {
      setConn('idle');
      return;
    }
    setConn('connecting');
    let frame = 0;
    const notify = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        snap.current = model.version;
        listeners.current.forEach((l) => l());
      });
    };
    const es = new EventSource(`/api/sessions/${sessionId}/stream`);
    es.onopen = () => setConn('open');
    es.onerror = () => setConn(es.readyState === EventSource.CLOSED ? 'error' : 'connecting');
    es.onmessage = (e) => {
      try {
        model.apply(JSON.parse(e.data) as ServerMessage);
        notify();
      } catch (err) {
        console.error('bad SSE message', err);
      }
    };
    return () => {
      es.close();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [sessionId, model]);

  const version = useSyncExternalStore(
    (cb) => {
      listeners.current.add(cb);
      return () => listeners.current.delete(cb);
    },
    () => snap.current,
  );
  return { model, version, conn };
}

export function formatUsd(v: number | null): string {
  if (v === null) return '—';
  return v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`;
}

export function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  const m = Math.floor(s / 60);
  return `${m} min ${Math.round(s - m * 60)} s`;
}

export function formatTokens(v: number | null): string {
  if (v === null) return '—';
  return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v);
}
