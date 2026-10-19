import type { RunStatus } from './types.ts';

export interface OutcomeInput {
  cancelled: boolean;
  spawnError: string | null;
  exitCode: number | null;
  signal: string | null;
  lastResult: { subtype?: string; is_error?: boolean; result?: unknown; api_error_status?: unknown } | null;
  stderrTail: string | null;
}

export interface Outcome {
  status: Exclude<RunStatus, 'running'>;
  error: string | null;
}

/**
 * Decide a run's terminal state from the final result event AND the process exit.
 * A non-success result is a failure even when the exit code is 0; a missing result
 * event is always a failure (unless the user cancelled).
 */
export function decideOutcome(i: OutcomeInput): Outcome {
  const stderr = i.stderrTail?.trim() ? `\n\nstderr:\n${i.stderrTail.trim()}` : '';
  if (i.cancelled) return { status: 'cancelled', error: 'Cancelled by user (Stop button).' };
  if (i.spawnError) return { status: 'failed', error: `Could not start Claude Code: ${i.spawnError}${stderr}` };

  const how = i.signal ? `signal ${i.signal}` : `exit code ${i.exitCode ?? '—'}`;
  const r = i.lastResult;
  if (!r) {
    return { status: 'failed', error: `Claude Code ended (${how}) without a result event.${stderr}` };
  }
  const subtype = r.subtype ?? 'unknown';
  if (r.is_error || subtype !== 'success') {
    const detail = typeof r.result === 'string' && r.result.trim() ? `\n${r.result.trim()}` : '';
    const api = r.api_error_status ? ` (API status ${String(r.api_error_status)})` : '';
    return { status: 'failed', error: `Run failed: result "${subtype}"${api}, ${how}.${detail}${stderr}` };
  }
  if (i.signal || (i.exitCode !== null && i.exitCode !== 0)) {
    return { status: 'failed', error: `Claude Code reported success but the process ended with ${how}.${stderr}` };
  }
  return { status: 'finished', error: null };
}
