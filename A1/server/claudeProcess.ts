// CLI process execution: argument construction, binary resolution, spawning and killing.
// Never uses a shell; user input only ever travels as a separate argv element.
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { Config } from './config.ts';

export interface BuildArgsInput {
  prompt: string;
  resumeSessionId: string | null;
  allowedTools: string[];
  model: string | null;
  dangerouslySkipPermissions: boolean;
}

export function buildArgs(i: BuildArgsInput): string[] {
  const args = ['-p'];
  if (i.resumeSessionId) args.push('--resume', i.resumeSessionId);
  // A prompt starting with "-" would be parsed as a CLI flag; a leading space is harmless to the model.
  const prompt = i.prompt.startsWith('-') ? ` ${i.prompt}` : i.prompt;
  args.push(prompt, '--output-format', 'stream-json', '--verbose');
  if (i.model) args.push('--model', i.model);
  if (i.dangerouslySkipPermissions) args.push('--dangerously-skip-permissions');
  else if (i.allowedTools.length) args.push('--allowedTools', ...i.allowedTools);
  return args;
}

/** Environment for the child: drop API keys (they silently override the login) and parent-session vars. */
export function childEnv(cfg: Pick<Config, 'stripEnv' | 'stripEnvPrefixes' | 'keepEnv'>, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(base)) {
    const upper = k.toUpperCase();
    if (cfg.keepEnv.includes(upper)) env[k] = v;
    else if (cfg.stripEnv.includes(upper)) continue;
    else if (cfg.stripEnvPrefixes.some((p) => upper.startsWith(p))) continue;
    else env[k] = v;
  }
  return env;
}

export interface ResolvedBin {
  command: string;
  prefixArgs: string[];
  note: string | null;
}

/**
 * Resolve how to execute the Claude Code binary without a shell.
 * On Windows, npm installs a `claude.cmd` shim that spawn() cannot run without a shell;
 * in that case we run the package's cli.js with the current Node executable instead.
 */
export function resolveClaudeBin(bin: string, platform = process.platform, env = process.env): ResolvedBin {
  if (platform !== 'win32') return { command: bin, prefixArgs: [], note: null };
  if (/\.(exe|com)$/i.test(bin) && (path.isAbsolute(bin) ? fs.existsSync(bin) : true)) return { command: bin, prefixArgs: [], note: null };
  if (/\.(js|mjs|cjs)$/i.test(bin)) return { command: process.execPath, prefixArgs: [bin], note: 'running cli.js with node' };
  const dirs = (env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean);
  const candidates = path.isAbsolute(bin) ? [path.dirname(bin)] : dirs;
  const base = path.isAbsolute(bin) ? path.basename(bin).replace(/\.(cmd|bat|ps1)$/i, '') : bin;
  for (const d of candidates) {
    const exe = path.join(d, `${base}.exe`);
    if (fs.existsSync(exe)) return { command: exe, prefixArgs: [], note: null };
    const cmd = path.join(d, `${base}.cmd`);
    if (fs.existsSync(cmd)) {
      const cli = path.join(d, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
      if (fs.existsSync(cli)) return { command: process.execPath, prefixArgs: [cli], note: `using ${cli} (npm shim ${cmd})` };
    }
  }
  return { command: bin, prefixArgs: [], note: `could not locate ${bin}.exe on PATH; set MADS_CLAUDE_BIN to its full path` };
}

/** Validate a working directory before spawning: exists, is a directory, readable. */
export function validateCwd(dir: unknown): { ok: true; path: string } | { ok: false; error: string } {
  if (typeof dir !== 'string' || !dir.trim()) return { ok: false, error: 'Working directory is required.' };
  const p = path.resolve(dir.trim());
  let st: fs.Stats;
  try {
    st = fs.statSync(p);
  } catch {
    return { ok: false, error: `Working directory does not exist: ${p}` };
  }
  if (!st.isDirectory()) return { ok: false, error: `Not a directory: ${p}` };
  try {
    fs.accessSync(p, fs.constants.R_OK | fs.constants.X_OK);
  } catch {
    return { ok: false, error: `Working directory is not readable: ${p}` };
  }
  return { ok: true, path: p };
}

export interface SpawnHandlers {
  onStdout(chunk: Buffer): void;
  onStderr(chunk: Buffer): void;
  onError(err: Error): void;
  onClose(code: number | null, signal: NodeJS.Signals | null): void;
}

export function spawnClaude(cfg: Config, cwd: string, args: string[], h: SpawnHandlers): ChildProcess {
  const bin = resolveClaudeBin(cfg.claudeBin);
  const child = spawn(bin.command, [...bin.prefixArgs, ...args], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'], // stdin ignored: `claude -p` may otherwise wait on it
    env: childEnv(cfg),
    shell: false,
    windowsHide: true,
  });
  child.stdout!.on('data', h.onStdout);
  child.stderr!.on('data', h.onStderr);
  child.on('error', h.onError);
  child.on('close', h.onClose);
  return child;
}

/** SIGTERM, then SIGKILL after a timeout if the process is still alive. */
export function terminate(child: ChildProcess, timeoutMs: number): void {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  const timer = setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }, timeoutMs);
  timer.unref();
  child.once('close', () => clearTimeout(timer));
}
