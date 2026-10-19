import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ServerConfigView, SessionMeta } from '../../shared/types';
import { ancestorsOf } from '../../shared/trajectory';
import { api, useSessionModel } from './api';
import { Outline } from './components/Outline';
import { RunCard } from './components/RunCard';
import { ExpandProvider, IconDown, IconList, IconLock, IconMoon, IconSun, IconX, ReplayBadge, RunStatusBadge, useExpand } from './components/ui';

function readHashSession(): string | null {
  const m = location.hash.match(/s=([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

export function App() {
  const [sessionId, setSessionId] = useState<string | null>(readHashSession);
  useEffect(() => {
    const onHash = () => setSessionId(readHashSession());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const selectSession = useCallback((id: string | null) => {
    history.replaceState(null, '', id ? `#s=${id}` : location.pathname);
    setSessionId(id);
  }, []);
  return (
    <ExpandProvider key={sessionId ?? 'none'}>
      <Shell sessionId={sessionId} selectSession={selectSession} />
    </ExpandProvider>
  );
}

function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    try {
      localStorage.setItem('mads-theme', dark ? 'dark' : 'light');
    } catch {
      /* storage unavailable */
    }
  }, [dark]);
  return [dark, setDark] as const;
}

function Shell({ sessionId, selectSession }: { sessionId: string | null; selectSession: (id: string | null) => void }) {
  const { model, version, conn } = useSessionModel(sessionId);
  const [config, setConfig] = useState<ServerConfigView | null>(null);
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [dark, setDark] = useTheme();
  const [outlineOpen, setOutlineOpen] = useState(false);
  const expand = useExpand();
  const scroller = useRef<HTMLDivElement>(null);
  const [following, setFollowing] = useState(true);

  const refreshSessions = useCallback(() => {
    api.sessions().then(setSessions).catch(() => {});
  }, []);
  useEffect(() => {
    api.config().then(setConfig).catch(() => {});
    refreshSessions();
  }, [refreshSessions, sessionId]);

  const runs = model.runList;
  const session = model.session;
  const active = model.activeRun;
  const last = runs[runs.length - 1] ?? null;
  const isReplay = session?.mode === 'replay';

  // Follow the live tail unless the user scrolled up.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && following) el.scrollTop = el.scrollHeight;
  }, [version, following]);
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    if (atBottom !== following) setFollowing(atBottom);
  };
  const jumpToLatest = () => {
    setFollowing(true);
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  };

  const jump = useCallback(
    (key: string) => {
      setFollowing(false);
      setOutlineOpen(false);
      let selector: string;
      if (key.startsWith('run:')) {
        expand.openMany([key]);
        selector = `[data-run-id="${CSS.escape(key.slice(4))}"]`;
      } else {
        for (const r of model.runList) {
          const chain = ancestorsOf(r.nodes, key);
          if (chain) {
            expand.openMany([`run:${r.meta.id}`, ...chain.slice(0, -1).map((k) => `${k}:group`)]);
            break;
          }
        }
        selector = `[data-node-key="${CSS.escape(key)}"]`;
      }
      // Wait for the expanded ancestors to render, then scroll + highlight.
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const el = document.querySelector<HTMLElement>(selector);
          if (!el) return;
          // Scroll only the transcript pane (scrollIntoView would also scroll the page shell).
          const sc = scroller.current;
          if (sc) {
            const top = el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - sc.clientHeight / 3;
            sc.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
          }
          el.classList.remove('flash');
          void el.offsetWidth;
          el.classList.add('flash');
          el.setAttribute('data-highlighted', 'true');
          setTimeout(() => {
            el.classList.remove('flash');
            el.removeAttribute('data-highlighted');
          }, 1700);
        }),
      );
    },
    [expand, model],
  );

  const outline = <Outline runs={runs} onJump={jump} />;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="z-20 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-200 bg-white px-4 py-2.5 dark:border-slate-800 dark:bg-slate-900">
        <div className="mr-auto flex items-center gap-2 lg:mr-0">
          <svg viewBox="0 0 32 32" className="h-6 w-6 text-teal-600" aria-hidden="true"><circle cx="14" cy="14" r="9" fill="none" stroke="currentColor" strokeWidth="4" /><path d="M21 21l7 7" stroke="currentColor" strokeWidth="4" strokeLinecap="round" /></svg>
          <h1 className="text-base font-bold tracking-tight text-slate-900 dark:text-white">Mads-Lens</h1>
        </div>
        {isReplay && <ReplayBadge />}
        <div className="order-last flex w-full min-w-0 flex-wrap items-center gap-2 text-xs text-slate-500 lg:order-none lg:w-auto lg:flex-1">
          {session ? (
            <>
              <span className="hidden sm:inline">session</span>
              <span className="truncate font-mono text-slate-700 dark:text-slate-300" data-testid="claude-session-id" title="Claude Code session_id">{session.claudeSessionId ?? '(not started yet)'}</span>
              {last && <RunStatusBadge status={last.meta.status} />}
              {conn !== 'open' && <span className="chip bg-slate-100 dark:bg-slate-800">{conn === 'connecting' ? 'connecting…' : 'stream disconnected'}</span>}
            </>
          ) : (
            <span>no session — start a run or a replay</span>
          )}
        </div>
        <label className="sr-only" htmlFor="history">Session history</label>
        <select
          id="history"
          className="input w-auto max-w-[14rem] py-1 text-xs"
          value={sessionId ?? ''}
          onFocus={refreshSessions}
          onChange={(e) => selectSession(e.target.value || null)}
        >
          <option value="">History…</option>
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.mode === 'replay' ? '[REPLAY] ' : ''}
              {new Date(s.createdAt).toLocaleString()} — {s.title.slice(0, 40)}
            </option>
          ))}
        </select>
        <button type="button" className="btn btn-ghost" onClick={() => selectSession(null)} data-testid="new-session">New session</button>
        <button type="button" className="btn btn-ghost lg:hidden" onClick={() => setOutlineOpen(true)} aria-label="Show outline"><IconList /> <span className="hidden sm:inline">Outline</span></button>
        <button type="button" className="btn btn-ghost px-2" onClick={() => setDark(!dark)} aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}>
          {dark ? <IconSun /> : <IconMoon />}
        </button>
      </header>

      {config?.apiKeyEnvDetected && (
        <div role="alert" className="border-b border-amber-300 bg-amber-50 px-4 py-1.5 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          ⚠ ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN is set in the server's environment. Mads-Lens strips it from the claude child process so your Claude Code login is used, but you should unset it.
        </div>
      )}
      {config?.dangerouslySkipPermissions && (
        <div role="alert" className="border-b border-rose-300 bg-rose-100 px-4 py-1.5 text-xs font-semibold text-rose-900 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-200">
          ⚠ --dangerously-skip-permissions is ON: the agent can run any command without approval. Use only on scratch directories.
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* Main column */}
        <main className="relative flex min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1">
            <div ref={scroller} onScroll={onScroll} className="h-full overflow-y-auto px-3 py-4 sm:px-6" data-testid="transcript">
              <div className="mx-auto max-w-4xl space-y-4">
                {!session && <Welcome />}
                {runs.map((r, i) => (
                  <RunCard key={r.meta.id} run={r} isLast={i === runs.length - 1} />
                ))}
              </div>
            </div>
            {!following && runs.length > 0 && (
              <button type="button" onClick={jumpToLatest} className="btn btn-primary absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full shadow-lg" data-testid="jump-latest">
                <IconDown /> Jump to latest
              </button>
            )}
          </div>
          <Composer
            config={config}
            session={session}
            hasRuns={runs.length > 0}
            activeRunId={active?.meta.id ?? null}
            onStarted={(s) => {
              setFollowing(true);
              if (s.id !== sessionId) selectSession(s.id);
              refreshSessions();
            }}
            onNewSession={() => selectSession(null)}
          />
        </main>

        {/* Outline: sticky side column on wide windows */}
        <aside className="hidden w-80 shrink-0 overflow-y-auto border-l border-slate-200 bg-white px-3 py-4 lg:block dark:border-slate-800 dark:bg-slate-900" aria-label="Outline">
          <h2 className="mb-2 px-1.5 text-xs font-bold uppercase tracking-wider text-slate-500">Outline</h2>
          {outline}
        </aside>
      </div>

      {/* Outline drawer on narrow windows */}
      {outlineOpen && (
        <div className="fixed inset-0 z-30 lg:hidden" role="dialog" aria-modal="true" aria-label="Outline">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setOutlineOpen(false)} />
          <div className="absolute inset-y-0 right-0 w-[min(22rem,90vw)] overflow-y-auto bg-white p-3 shadow-xl dark:bg-slate-900">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">Outline</h2>
              <button type="button" className="btn btn-ghost px-2" onClick={() => setOutlineOpen(false)} aria-label="Close outline"><IconX /></button>
            </div>
            {outline}
          </div>
        </div>
      )}
    </div>
  );
}

function Welcome() {
  return (
    <div className="card p-5 text-sm text-slate-600 dark:text-slate-300">
      <h2 className="mb-1 text-base font-semibold text-slate-900 dark:text-slate-100">Watch Claude Code work</h2>
      <p>Pick a working directory, describe a programming task, and press <kbd className="rounded border px-1 font-mono text-xs">Ctrl/⌘ + Enter</kbd>. Mads-Lens runs the real <code className="font-mono">claude -p … --output-format stream-json</code> there and streams every event here. Follow-up prompts resume the same Claude Code session.</p>
      <p className="mt-2">No model budget? Switch the composer to <b>Replay</b> to stream a saved <code className="font-mono">events.jsonl</code> instead — clearly labeled REPLAY, no model calls.</p>
    </div>
  );
}

function Composer(props: {
  config: ServerConfigView | null;
  session: SessionMeta | null;
  hasRuns: boolean;
  activeRunId: string | null;
  onStarted: (s: SessionMeta) => void;
  onNewSession: () => void;
}) {
  const { config, session, activeRunId } = props;
  const [tab, setTab] = useState<'live' | 'replay'>('live');
  const [cwd, setCwd] = useState('');
  const [cwdError, setCwdError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fixtures, setFixtures] = useState<{ name: string; runs: number; synthetic: boolean }[]>([]);
  const [fixture, setFixture] = useState('');
  const [speed, setSpeed] = useState('fast');

  const locked = !!session && session.mode === 'live' && props.hasRuns;
  const isReplaySession = session?.mode === 'replay';

  useEffect(() => {
    if (session?.mode === 'live') setCwd(session.cwd);
    else if (!session && config && !cwd) setCwd(config.recentDirs[0] ?? config.defaultCwd);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, config]);
  useEffect(() => {
    if (tab === 'replay' && !fixtures.length) api.fixtures().then((f) => { setFixtures(f); setFixture(f[0]?.name ?? ''); }).catch(() => {});
  }, [tab, fixtures.length]);

  const validate = async () => {
    if (!cwd.trim() || locked) return;
    const r = await api.validateCwd(cwd).catch(() => null);
    setCwdError(r && !r.ok ? r.error ?? 'invalid directory' : null);
  };

  const submit = async () => {
    if (busy || activeRunId || !prompt.trim() || isReplaySession) return;
    setBusy(true);
    setError(null);
    try {
      const { session: s } = await api.startRun({ sessionId: locked ? session!.id : session?.mode === 'live' ? session.id : null, cwd, prompt });
      setPrompt('');
      props.onStarted(s);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    if (!activeRunId) return;
    await api.cancel(activeRunId).catch((e) => setError((e as Error).message));
  };

  const startReplay = async () => {
    if (!fixture) return;
    setBusy(true);
    setError(null);
    try {
      const { session: s } = await api.replay(fixture, speed);
      props.onStarted(s);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-t border-slate-200 bg-white px-3 py-3 sm:px-6 dark:border-slate-800 dark:bg-slate-900" data-testid="composer">
      <div className="mx-auto max-w-4xl space-y-2">
        <div className="flex items-center gap-1 text-xs" role="tablist">
          {(['live', 'replay'] as const).map((t) => (
            <button key={t} role="tab" type="button" aria-selected={tab === t} onClick={() => setTab(t)} className={`rounded-md px-2.5 py-1 font-semibold ${tab === t ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'}`}>
              {t === 'live' ? 'Live run' : 'Replay'}
            </button>
          ))}
          {tab === 'live' && config && (
            <details className="ml-auto text-slate-500">
              <summary className="cursor-pointer select-none">{config.dangerouslySkipPermissions ? <span className="font-bold text-rose-700">ALL tools allowed (dangerous mode)</span> : `${config.allowedTools.length} allowed tools`}{config.model ? ` · model ${config.model}` : ''}</summary>
              <div className="mt-1 max-w-xl font-mono text-[11px]">{config.allowedTools.join('  ')}</div>
              <div className="mt-0.5 text-[11px]">Configure with MADS_ALLOWED_TOOLS or mads.config.json (see README).</div>
            </details>
          )}
        </div>

        {tab === 'live' ? (
          isReplaySession ? (
            <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
              This is a replay session (read-only). <button type="button" className="btn btn-ghost" onClick={props.onNewSession}>New session</button>
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
              className="space-y-2"
            >
              <div>
                <label htmlFor="cwd" className="mb-0.5 flex items-center gap-1 text-xs font-semibold text-slate-600 dark:text-slate-400">
                  Working directory {locked && <><IconLock cls="h-3 w-3" /> <span className="font-normal">locked to this session — changing it requires a</span> <button type="button" className="font-semibold text-teal-700 underline dark:text-teal-400" onClick={props.onNewSession}>new session</button></>}
                </label>
                <input id="cwd" className="input font-mono text-[13px]" value={cwd} onChange={(e) => { setCwd(e.target.value); setCwdError(null); }} onBlur={validate} disabled={locked} list="recent-dirs" placeholder="/path/to/scratch/project" aria-invalid={!!cwdError} aria-describedby="cwd-err" spellCheck={false} />
                <datalist id="recent-dirs">{config?.recentDirs.map((d) => <option key={d} value={d} />)}</datalist>
                {cwdError && <p id="cwd-err" className="mt-0.5 text-xs font-medium text-rose-700 dark:text-rose-300" data-testid="cwd-error">✕ {cwdError}</p>}
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="min-w-0 flex-1">
                  <label htmlFor="prompt" className="sr-only">Prompt</label>
                  <textarea
                    id="prompt"
                    className="input min-h-[4.5rem] resize-y"
                    rows={3}
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault();
                        void submit();
                      }
                    }}
                    placeholder={locked ? 'Follow-up prompt (resumes the same Claude Code session)…' : 'Describe a programming task…'}
                  />
                </div>
                {activeRunId ? (
                  <button type="button" className="btn btn-danger sm:w-28" onClick={stop} data-testid="stop">■ Stop</button>
                ) : (
                  <button type="submit" className="btn btn-primary sm:w-28" disabled={busy || !prompt.trim()} data-testid="run">
                    {busy ? 'Starting…' : locked ? 'Follow up' : 'Run'}
                  </button>
                )}
              </div>
              <p className="text-[11px] text-slate-500">{activeRunId ? 'A run is in progress — Stop terminates the claude process.' : `Ctrl/⌘ + Enter to ${locked ? 'send a follow-up (uses --resume)' : 'run'}`}</p>
            </form>
          )
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1">
              <label htmlFor="fixture" className="mb-0.5 block text-xs font-semibold text-slate-600 dark:text-slate-400">Saved events.jsonl (fixtures/)</label>
              <select id="fixture" className="input" value={fixture} onChange={(e) => setFixture(e.target.value)}>
                {fixtures.map((f) => (
                  <option key={f.name} value={f.name}>{f.name}{f.runs > 1 ? ` (${f.runs} runs)` : ''}{f.synthetic ? ' — synthetic' : ''}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="speed" className="mb-0.5 block text-xs font-semibold text-slate-600 dark:text-slate-400">Speed</label>
              <select id="speed" className="input" value={speed} onChange={(e) => setSpeed(e.target.value)}>
                <option value="realtime">recorded timing</option>
                <option value="fast">10× faster</option>
                <option value="instant">instant</option>
              </select>
            </div>
            <button type="button" className="btn btn-primary" onClick={startReplay} disabled={busy || !fixture || !!activeRunId} data-testid="start-replay">▶ Replay</button>
          </div>
        )}
        {error && <p role="alert" className="text-sm font-medium text-rose-700 dark:text-rose-300" data-testid="composer-error">✕ {error}</p>}
      </div>
    </div>
  );
}
