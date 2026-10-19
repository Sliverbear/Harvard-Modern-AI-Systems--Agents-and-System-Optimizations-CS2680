// All configurable knobs live here (env vars override mads.config.json, which overrides defaults).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Default allow-list for headless runs against a scratch directory.
 * "Task" is the subagent tool name advertised in system/init `tools` by Claude Code 2.1.x,
 * while the tool_use blocks it emits are named "Agent" — so both are listed.
 */
export const DEFAULT_ALLOWED_TOOLS = [
  'Read',
  'Edit',
  'Write',
  'Glob',
  'Grep',
  'Bash(pytest:*)',
  'Bash(python:*)',
  'Bash(python3:*)',
  'Bash(ls:*)',
  'Task',
  'Agent',
];

export interface Config {
  port: number;
  host: '127.0.0.1';
  claudeBin: string;
  model: string | null;
  allowedTools: string[];
  dangerouslySkipPermissions: boolean;
  dataDir: string;
  fixturesDir: string;
  defaultCwd: string;
  killTimeoutMs: number;
  /** Env var names removed from the child's environment (exact names). */
  stripEnv: string[];
  /** Env var prefixes removed from the child's environment. */
  stripEnvPrefixes: string[];
  /** Env names kept even if they match a stripped prefix. */
  keepEnv: string[];
}

function readFileConfig(): Partial<Record<string, unknown>> {
  const p = path.join(ROOT, 'mads.config.json');
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    console.warn(`[mads] ignoring invalid mads.config.json: ${(e as Error).message}`);
    return {};
  }
}

function list(v: unknown): string[] | null {
  if (Array.isArray(v)) return v.map(String).filter(Boolean);
  if (typeof v === 'string' && v.trim()) return v.split(',').map((s) => s.trim()).filter(Boolean);
  return null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const f = readFileConfig();
  const truthy = (v: unknown) => v === true || v === '1' || v === 'true';
  return {
    port: Number(env.MADS_PORT ?? f.port ?? 5174),
    host: '127.0.0.1',
    claudeBin: String(env.MADS_CLAUDE_BIN ?? f.claudeBin ?? 'claude'),
    model: (env.MADS_MODEL ?? (f.model as string | undefined) ?? '') || null,
    allowedTools: list(env.MADS_ALLOWED_TOOLS) ?? list(f.allowedTools) ?? DEFAULT_ALLOWED_TOOLS,
    dangerouslySkipPermissions: truthy(env.MADS_DANGEROUS_SKIP_PERMISSIONS ?? f.dangerouslySkipPermissions),
    dataDir: path.resolve(ROOT, String(env.MADS_DATA_DIR ?? f.dataDir ?? 'data')),
    fixturesDir: path.resolve(ROOT, 'fixtures'),
    defaultCwd: path.resolve(ROOT, String(env.MADS_DEFAULT_CWD ?? f.defaultCwd ?? 'scratch/work/inventory')),
    killTimeoutMs: Number(env.MADS_KILL_TIMEOUT_MS ?? 3000),
    stripEnv: ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDECODE'],
    // Variables inherited from a parent Claude Code session (e.g. when Mads-Lens is itself
    // started from inside Claude Code) can make the child join the parent's session.
    stripEnvPrefixes: ['CLAUDE'],
    keepEnv: ['CLAUDE_CONFIG_DIR'],
  };
}

export function apiKeyEnvDetected(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN);
}
