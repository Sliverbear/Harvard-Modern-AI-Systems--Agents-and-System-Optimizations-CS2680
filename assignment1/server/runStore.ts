// Raw event ingestion persistence. Layout:
//   data/sessions/<sessionId>.json
//   data/runs/<runId>/meta.json      prompt, cwd, timestamps, exit code, status…
//   data/runs/<runId>/events.jsonl   every stdout line exactly as received (appended BEFORE normalizing)
//   data/runs/<runId>/timing.jsonl   {"seq":n,"t":ms} receive time of each line (for realistic replay)
//   data/runs/<runId>/stderr.log
import fs from 'node:fs';
import path from 'node:path';
import type { RunMeta, SessionMeta, StreamLine } from '../shared/types.ts';
import { parseLine } from './lineBuffer.ts';

export class RunStore {
  constructor(readonly dataDir: string) {
    fs.mkdirSync(path.join(dataDir, 'runs'), { recursive: true });
    fs.mkdirSync(path.join(dataDir, 'sessions'), { recursive: true });
  }

  runDir(runId: string): string {
    return path.join(this.dataDir, 'runs', safeId(runId));
  }

  createRun(meta: RunMeta): void {
    const dir = this.runDir(meta.id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'events.jsonl'), '');
    fs.writeFileSync(path.join(dir, 'timing.jsonl'), '');
    fs.writeFileSync(path.join(dir, 'stderr.log'), '');
    this.saveRunMeta(meta);
  }

  saveRunMeta(meta: RunMeta): void {
    atomicWrite(path.join(this.runDir(meta.id), 'meta.json'), JSON.stringify(meta, null, 2));
  }

  appendLine(runId: string, seq: number, t: number, line: string): void {
    const dir = this.runDir(runId);
    fs.appendFileSync(path.join(dir, 'events.jsonl'), line + '\n');
    fs.appendFileSync(path.join(dir, 'timing.jsonl'), JSON.stringify({ seq, t }) + '\n');
  }

  appendStderr(runId: string, text: string): void {
    fs.appendFileSync(path.join(this.runDir(runId), 'stderr.log'), text);
  }

  readRunMeta(runId: string): RunMeta | null {
    try {
      return JSON.parse(fs.readFileSync(path.join(this.runDir(runId), 'meta.json'), 'utf8'));
    } catch {
      return null;
    }
  }

  readLines(runId: string): StreamLine[] {
    const dir = this.runDir(runId);
    return readJsonlWithTiming(path.join(dir, 'events.jsonl'), path.join(dir, 'timing.jsonl'));
  }

  readStderr(runId: string): string {
    try {
      return fs.readFileSync(path.join(this.runDir(runId), 'stderr.log'), 'utf8');
    } catch {
      return '';
    }
  }

  saveSession(s: SessionMeta): void {
    atomicWrite(path.join(this.dataDir, 'sessions', `${safeId(s.id)}.json`), JSON.stringify(s, null, 2));
  }

  readSession(id: string): SessionMeta | null {
    try {
      return JSON.parse(fs.readFileSync(path.join(this.dataDir, 'sessions', `${safeId(id)}.json`), 'utf8'));
    } catch {
      return null;
    }
  }

  listSessions(): SessionMeta[] {
    const dir = path.join(this.dataDir, 'sessions');
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => this.readSession(f.slice(0, -5)))
      .filter((s): s is SessionMeta => s !== null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** Remove a session's own record (its runs' data is deleted separately via deleteRun). */
  deleteSession(id: string): void {
    try {
      fs.unlinkSync(path.join(this.dataDir, 'sessions', `${safeId(id)}.json`));
    } catch {
      /* already gone */
    }
  }

  /** Remove a run's whole directory (meta.json, events.jsonl, timing.jsonl, stderr.log). */
  deleteRun(runId: string): void {
    try {
      fs.rmSync(this.runDir(runId), { recursive: true, force: true });
    } catch {
      /* already gone */
    }
  }
}

/**
 * Read a JSONL file into StreamLines. Receive times come from timing.jsonl when present,
 * else from each event's recorded ISO `timestamp` (relative to the first one), else a fixed interval.
 */
export function readJsonlWithTiming(eventsPath: string, timingPath?: string, fallbackIntervalMs = 0): StreamLine[] {
  let text = '';
  try {
    text = fs.readFileSync(eventsPath, 'utf8');
  } catch {
    return [];
  }
  const times = new Map<number, number>();
  if (timingPath && fs.existsSync(timingPath)) {
    for (const l of fs.readFileSync(timingPath, 'utf8').split('\n')) {
      if (!l.trim()) continue;
      try {
        const { seq, t } = JSON.parse(l);
        if (typeof seq === 'number' && typeof t === 'number') times.set(seq, t);
      } catch {
        /* ignore bad timing rows */
      }
    }
  }
  const raw = text.split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.trim());
  let firstAbs: number | null = null;
  let prev = 0;
  return raw.map((line, seq) => {
    const p = parseLine(line);
    let t: number | undefined = times.get(seq);
    if (t === undefined && p.json && typeof p.json.timestamp === 'string') {
      const abs = Date.parse(p.json.timestamp);
      if (Number.isFinite(abs)) {
        firstAbs ??= abs;
        t = abs - firstAbs;
      }
    }
    if (t === undefined) t = seq === 0 ? 0 : prev + fallbackIntervalMs;
    if (t < prev) t = prev; // keep monotonic
    prev = t;
    return { seq, t, line, json: p.json, ...(p.parseError ? { parseError: p.parseError } : {}) };
  });
}

function safeId(id: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`invalid id: ${id}`);
  return id;
}

function atomicWrite(file: string, content: string): void {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}
