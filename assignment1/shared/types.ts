// Types shared by the server and the React client.
// Raw Claude Code stream-json events are kept as `unknown`-ish JSON; we only
// describe the fields we rely on. Unknown fields/types are preserved, never dropped.

export type RunStatus = 'running' | 'finished' | 'failed' | 'cancelled';
export type RunMode = 'live' | 'replay';

export interface RunMeta {
  id: string;
  sessionId: string; // Mads-Lens session id (groups runs)
  index: number; // 1-based position within the session
  mode: RunMode;
  prompt: string;
  cwd: string;
  resumeClaudeSessionId: string | null; // set when this run used --resume
  claudeSessionId: string | null; // learned from init/result events
  args: string[]; // CLI args as passed (for display)
  allowedTools: string[];
  dangerouslySkipPermissions: boolean;
  status: RunStatus;
  startedAt: string;
  endedAt: string | null;
  exitCode: number | null;
  signal: string | null;
  error: string | null; // human-readable failure reason
  stderrTail: string | null;
  resultSubtype: string | null;
  replaySource?: string | null; // fixture name for replay runs
  eventCount: number;
}

export interface SessionMeta {
  id: string;
  mode: RunMode;
  cwd: string; // locked per session (Claude Code stores sessions per project dir)
  claudeSessionId: string | null;
  runIds: string[];
  createdAt: string;
  title: string;
}

/** One line read from the CLI's stdout, as delivered to the browser. */
export interface StreamLine {
  seq: number; // 0-based line number within the run
  t: number; // ms since run start when the line was received
  line: string; // the raw line exactly as received
  json: any | null; // parsed JSON, or null if malformed
  parseError?: string;
}

/** Messages sent over the SSE channel of a session. */
export type ServerMessage =
  | { kind: 'hello'; session: SessionMeta; runs: RunMeta[] }
  | { kind: 'run'; run: RunMeta } // run created or its meta changed
  | { kind: 'line'; runId: string; data: StreamLine }
  | { kind: 'stderr'; runId: string; text: string }
  | { kind: 'session'; session: SessionMeta };

export interface DeleteSessionsResult {
  deleted: string[];
  skipped: { id: string; reason: string }[];
}

export interface ServerConfigView {
  claudeBin: string;
  model: string | null;
  allowedTools: string[];
  dangerouslySkipPermissions: boolean;
  apiKeyEnvDetected: boolean;
  defaultCwd: string;
  recentDirs: string[];
  platform: string;
}
