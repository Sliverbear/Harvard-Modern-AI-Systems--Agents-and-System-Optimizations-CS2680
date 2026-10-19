// Run and session management. Live runs and replays share the same ingestion path:
//   raw line -> append to events.jsonl -> parse -> update run meta -> broadcast over SSE.
import type { ChildProcess } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { RunMeta, ServerMessage, SessionMeta, StreamLine } from '../shared/types.ts';
import { decideOutcome } from '../shared/outcome.ts';
import type { Config } from './config.ts';
import { buildArgs, spawnClaude, terminate, validateCwd } from './claudeProcess.ts';
import { LineBuffer, parseLine } from './lineBuffer.ts';
import { RunStore, readJsonlWithTiming } from './runStore.ts';

type Listener = (msg: ServerMessage) => void;

interface ActiveRun {
  meta: RunMeta;
  child: ChildProcess | null;
  buffer: LineBuffer;
  startMs: number;
  seq: number;
  lastResult: any | null;
  stderr: string;
  spawnError: string | null;
  cancelled: boolean;
  timers: NodeJS.Timeout[];
  finished: boolean;
}

export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const STDERR_TAIL = 4000;
const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;

export class RunManager {
  readonly store: RunStore;
  private sessions = new Map<string, SessionMeta>();
  private active = new Map<string, ActiveRun>(); // runId -> active run
  private listeners = new Map<string, Set<Listener>>(); // sessionId -> listeners
  private recentDirs: string[] = [];

  constructor(readonly cfg: Config) {
    this.store = new RunStore(cfg.dataDir);
    for (const s of this.store.listSessions()) this.sessions.set(s.id, s);
    // Runs left "running" by a crashed/killed server can never finish: close them out.
    for (const s of this.sessions.values()) {
      for (const runId of s.runIds) {
        const m = this.store.readRunMeta(runId);
        if (m && m.status === 'running') {
          m.status = 'failed';
          m.endedAt = new Date().toISOString();
          m.error = 'Server stopped while this run was in progress.';
          this.store.saveRunMeta(m);
        }
      }
      if (s.mode === 'live' && !this.recentDirs.includes(s.cwd)) this.recentDirs.push(s.cwd);
    }
    this.recentDirs = this.recentDirs.slice(0, 8);
  }

  getRecentDirs(): string[] {
    return this.recentDirs;
  }

  listSessions(): SessionMeta[] {
    return [...this.sessions.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getSession(id: string): SessionMeta {
    const s = this.sessions.get(id);
    if (!s) throw new HttpError(404, `Unknown session ${id}`);
    return s;
  }

  getRuns(sessionId: string): RunMeta[] {
    const s = this.getSession(sessionId);
    return s.runIds.map((id) => this.active.get(id)?.meta ?? this.store.readRunMeta(id)).filter((m): m is RunMeta => !!m);
  }

  getLines(runId: string): StreamLine[] {
    return this.store.readLines(runId);
  }

  // ---------- subscriptions ----------
  subscribe(sessionId: string, fn: Listener): () => void {
    const s = this.getSession(sessionId);
    const runs = this.getRuns(sessionId);
    fn({ kind: 'hello', session: s, runs });
    for (const r of runs) {
      for (const l of this.store.readLines(r.id)) fn({ kind: 'line', runId: r.id, data: l });
      const err = this.store.readStderr(r.id);
      if (err) fn({ kind: 'stderr', runId: r.id, text: err });
    }
    let set = this.listeners.get(sessionId);
    if (!set) this.listeners.set(sessionId, (set = new Set()));
    set.add(fn);
    return () => set!.delete(fn);
  }

  private emit(sessionId: string, msg: ServerMessage) {
    for (const fn of this.listeners.get(sessionId) ?? []) {
      try {
        fn(msg);
      } catch {
        /* a broken listener must not break ingestion */
      }
    }
  }

  // ---------- sessions ----------
  private createSession(mode: SessionMeta['mode'], cwd: string, title: string): SessionMeta {
    const s: SessionMeta = { id: newId(mode === 'live' ? 's' : 'replay'), mode, cwd, claudeSessionId: null, runIds: [], createdAt: new Date().toISOString(), title };
    this.sessions.set(s.id, s);
    this.store.saveSession(s);
    return s;
  }

  private sessionHasActiveRun(s: SessionMeta): boolean {
    return s.runIds.some((id) => this.active.has(id));
  }

  // ---------- live runs ----------
  startRun(input: { sessionId?: string | null; cwd: string; prompt: string }): { session: SessionMeta; run: RunMeta } {
    const prompt = typeof input.prompt === 'string' ? input.prompt : '';
    if (!prompt.trim()) throw new HttpError(400, 'Prompt is required.');

    let session: SessionMeta | null = input.sessionId ? this.getSession(input.sessionId) : null;
    if (session && session.mode !== 'live') throw new HttpError(400, 'Replay sessions cannot be continued with live runs. Start a new session.');

    const v = validateCwd(input.cwd);
    if (session) {
      // Claude Code stores sessions per project directory: resuming from another cwd would not find it.
      const requested = v.ok ? v.path : path.resolve(String(input.cwd ?? ''));
      if (requested !== session.cwd) {
        throw new HttpError(409, `This session is locked to ${session.cwd}. Start a new session to use a different directory.`);
      }
      if (this.sessionHasActiveRun(session)) throw new HttpError(409, 'A run is already in progress in this session.');
    }

    // Invalid directory: we still record a (failed) run so the transcript shows the error.
    const cwd = v.ok ? v.path : path.resolve(String(input.cwd ?? '') || '.');
    if (!session) session = this.createSession('live', cwd, prompt.slice(0, 80));
    const resume = session.claudeSessionId;
    const args = buildArgs({
      prompt,
      resumeSessionId: resume,
      allowedTools: this.cfg.allowedTools,
      model: this.cfg.model,
      dangerouslySkipPermissions: this.cfg.dangerouslySkipPermissions,
    });
    const meta: RunMeta = {
      id: newId('run'),
      sessionId: session.id,
      index: session.runIds.length + 1,
      mode: 'live',
      prompt,
      cwd,
      resumeClaudeSessionId: resume,
      claudeSessionId: resume,
      args,
      allowedTools: this.cfg.dangerouslySkipPermissions ? [] : this.cfg.allowedTools,
      dangerouslySkipPermissions: this.cfg.dangerouslySkipPermissions,
      status: 'running',
      startedAt: new Date().toISOString(),
      endedAt: null,
      exitCode: null,
      signal: null,
      error: null,
      stderrTail: null,
      resultSubtype: null,
      eventCount: 0,
    };
    session.runIds.push(meta.id);
    this.store.saveSession(session);
    this.store.createRun(meta);
    const ar = this.newActive(meta);
    this.emit(session.id, { kind: 'session', session });
    this.emit(session.id, { kind: 'run', run: meta });

    if (!v.ok) {
      ar.spawnError = v.error;
      this.finish(ar, null, null);
      return { session, run: ar.meta };
    }
    if (!this.recentDirs.includes(cwd)) this.recentDirs.unshift(cwd);
    this.recentDirs = this.recentDirs.slice(0, 8);

    try {
      ar.child = spawnClaude(this.cfg, cwd, args, {
        onStdout: (chunk) => {
          for (const line of ar.buffer.push(chunk)) this.ingest(ar, line);
        },
        onStderr: (chunk) => this.ingestStderr(ar, chunk.toString('utf8')),
        onError: (err) => {
          // e.g. ENOENT when the binary (or cwd) is missing. 'close' may or may not follow.
          ar.spawnError = `${err.message}${(err as NodeJS.ErrnoException).code === 'ENOENT' ? ` — is "${this.cfg.claudeBin}" installed and on PATH?` : ''}`;
          setTimeout(() => this.finish(ar, null, null), 50);
        },
        onClose: (code, signal) => {
          for (const line of ar.buffer.end()) this.ingest(ar, line);
          this.finish(ar, code, signal);
        },
      });
    } catch (e) {
      ar.spawnError = (e as Error).message;
      this.finish(ar, null, null);
    }
    return { session, run: ar.meta };
  }

  private newActive(meta: RunMeta): ActiveRun {
    const ar: ActiveRun = { meta, child: null, buffer: new LineBuffer(), startMs: Date.now(), seq: 0, lastResult: null, stderr: '', spawnError: null, cancelled: false, timers: [], finished: false };
    this.active.set(meta.id, ar);
    return ar;
  }

  /** The single ingestion path for live and replay lines. */
  private ingest(ar: ActiveRun, line: string, tOverride?: number) {
    if (ar.finished) return;
    const seq = ar.seq++;
    const t = tOverride ?? Date.now() - ar.startMs;
    this.store.appendLine(ar.meta.id, seq, t, line); // persist raw first
    const p = parseLine(line);
    const data: StreamLine = { seq, t, line, json: p.json, ...(p.parseError ? { parseError: p.parseError } : {}) };
    ar.meta.eventCount = seq + 1;
    const ev = p.json;
    let metaChanged = false;
    if (ev && typeof ev.session_id === 'string' && (ev.type === 'system' && ev.subtype === 'init' || ev.type === 'result')) {
      if (ar.meta.claudeSessionId !== ev.session_id) {
        ar.meta.claudeSessionId = ev.session_id;
        metaChanged = true;
      }
      const s = this.sessions.get(ar.meta.sessionId);
      if (s && s.claudeSessionId !== ev.session_id) {
        s.claudeSessionId = ev.session_id;
        this.store.saveSession(s);
        this.emit(s.id, { kind: 'session', session: s });
      }
    }
    if (ev && ev.type === 'result') {
      ar.lastResult = ev;
      ar.meta.resultSubtype = typeof ev.subtype === 'string' ? ev.subtype : null;
      metaChanged = true;
    }
    this.emit(ar.meta.sessionId, { kind: 'line', runId: ar.meta.id, data });
    if (metaChanged) {
      this.store.saveRunMeta(ar.meta);
      this.emit(ar.meta.sessionId, { kind: 'run', run: { ...ar.meta } });
    }
  }

  private ingestStderr(ar: ActiveRun, text: string) {
    ar.stderr = (ar.stderr + text).slice(-STDERR_TAIL);
    this.store.appendStderr(ar.meta.id, text);
    this.emit(ar.meta.sessionId, { kind: 'stderr', runId: ar.meta.id, text });
  }

  private finish(ar: ActiveRun, code: number | null, signal: NodeJS.Signals | null) {
    if (ar.finished) return;
    ar.finished = true;
    ar.timers.forEach(clearTimeout);
    const outcome = decideOutcome({
      cancelled: ar.cancelled,
      spawnError: ar.spawnError,
      exitCode: code,
      signal,
      lastResult: ar.lastResult,
      stderrTail: ar.stderr || null,
    });
    Object.assign(ar.meta, {
      status: outcome.status,
      error: outcome.error,
      exitCode: code,
      signal: signal ?? null,
      endedAt: new Date().toISOString(),
      stderrTail: ar.stderr || null,
    });
    this.store.saveRunMeta(ar.meta);
    this.active.delete(ar.meta.id);
    this.emit(ar.meta.sessionId, { kind: 'run', run: { ...ar.meta } });
  }

  cancel(runId: string): RunMeta {
    const ar = this.active.get(runId);
    if (!ar) throw new HttpError(409, 'Run is not active.');
    ar.cancelled = true;
    if (ar.child) terminate(ar.child, this.cfg.killTimeoutMs);
    else this.finish(ar, null, null); // replay: stop timers
    return ar.meta;
  }

  // ---------- replay ----------
  listFixtures(): { name: string; runs: number; synthetic: boolean }[] {
    const out: { name: string; runs: number; synthetic: boolean }[] = [];
    for (const group of ['real', 'synthetic']) {
      const dir = path.join(this.cfg.fixturesDir, group);
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir).sort()) {
        const p = path.join(dir, f);
        if (f.endsWith('.jsonl')) out.push({ name: `${group}/${f}`, runs: 1, synthetic: group === 'synthetic' });
        else if (fs.statSync(p).isDirectory()) {
          const n = fs.readdirSync(p).filter((x) => x.endsWith('.jsonl')).length;
          if (n) out.push({ name: `${group}/${f}`, runs: n, synthetic: group === 'synthetic' });
        }
      }
    }
    return out;
  }

  private fixtureFiles(name: string): string[] {
    if (!/^(real|synthetic)\/[A-Za-z0-9._-]+$/.test(name) || name.includes('..')) throw new HttpError(400, 'Invalid fixture name.');
    const p = path.join(this.cfg.fixturesDir, name);
    if (!fs.existsSync(p)) throw new HttpError(404, `Fixture not found: ${name}`);
    if (fs.statSync(p).isDirectory()) {
      return fs.readdirSync(p).filter((f) => f.endsWith('.jsonl')).sort().map((f) => path.join(p, f));
    }
    return [p];
  }

  /**
   * Stream saved events through the same ingestion + SSE path as live runs. No model calls.
   * speed: 'realtime' uses recorded timing (capped per gap), 'fast' = 10x, 'instant' = no delay.
   */
  startReplay(fixture: string, speed: 'realtime' | 'fast' | 'instant' = 'fast'): SessionMeta {
    const files = this.fixtureFiles(fixture);
    const session = this.createSession('replay', '(replay)', `REPLAY ${fixture}`);
    const runs = files.map((f) => {
      const metaPath = f.replace(/\.jsonl$/, '.meta.json');
      let recorded: any = {};
      try {
        recorded = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      } catch {
        /* optional */
      }
      const lines = readJsonlWithTiming(f, f.replace(/\.jsonl$/, '.timing.jsonl'), 250);
      return { file: f, recorded, lines };
    });

    const playRun = (i: number) => {
      if (i >= runs.length) return;
      const r = runs[i];
      const meta: RunMeta = {
        id: newId('run'),
        sessionId: session.id,
        index: i + 1,
        mode: 'replay',
        prompt: String(r.recorded.prompt ?? `(replay of ${path.basename(r.file)})`),
        cwd: String(r.recorded.cwd ?? '(recorded)'),
        resumeClaudeSessionId: r.recorded.resumeClaudeSessionId ?? null,
        claudeSessionId: null,
        args: Array.isArray(r.recorded.args) ? r.recorded.args : [],
        allowedTools: Array.isArray(r.recorded.allowedTools) ? r.recorded.allowedTools : [],
        dangerouslySkipPermissions: false,
        status: 'running',
        startedAt: new Date().toISOString(),
        endedAt: null,
        exitCode: null,
        signal: null,
        error: null,
        stderrTail: null,
        resultSubtype: null,
        replaySource: path.relative(this.cfg.fixturesDir, r.file).replace(/\\/g, '/'),
        eventCount: 0,
      };
      session.runIds.push(meta.id);
      this.store.saveSession(session);
      this.store.createRun(meta);
      const ar = this.newActive(meta);
      this.emit(session.id, { kind: 'run', run: meta });

      const factor = speed === 'instant' ? 0 : speed === 'fast' ? 0.1 : 1;
      let delay = 0;
      let prevT = 0;
      r.lines.forEach((l) => {
        const gap = Math.min(Math.max(l.t - prevT, 0), speed === 'realtime' ? 4000 : 30000);
        prevT = l.t;
        delay += speed === 'instant' ? 0 : Math.max(gap * factor, 15);
        ar.timers.push(setTimeout(() => this.ingest(ar, l.line), delay));
      });
      ar.timers.push(
        setTimeout(() => {
          const exitCode = typeof r.recorded.exitCode === 'number' ? r.recorded.exitCode : ar.lastResult ? (ar.lastResult.is_error ? 1 : 0) : null;
          if (r.recorded.stderr) this.ingestStderr(ar, String(r.recorded.stderr));
          ar.timers = [];
          if (r.recorded.spawnError) ar.spawnError = String(r.recorded.spawnError);
          this.finish(ar, exitCode, r.recorded.signal ?? null);
          playRun(i + 1);
        }, delay + 30),
      );
    };
    // Start after a tick so the client can subscribe first; subscribe() also replays stored lines.
    setTimeout(() => playRun(0), 300);
    return session;
  }

  shutdown(): void {
    for (const ar of this.active.values()) {
      ar.cancelled = true;
      ar.timers.forEach(clearTimeout);
      if (ar.child && ar.child.exitCode === null) ar.child.kill('SIGKILL');
    }
  }
}
