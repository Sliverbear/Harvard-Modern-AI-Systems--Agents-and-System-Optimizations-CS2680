// Entry point: startup checks, bind to 127.0.0.1 only, kill children on shutdown.
import { execFileSync } from 'node:child_process';
import { apiKeyEnvDetected, loadConfig } from './config.ts';
import { childEnv, resolveClaudeBin } from './claudeProcess.ts';
import { RunManager } from './runManager.ts';
import { createApp } from './app.ts';

const cfg = loadConfig();

if (apiKeyEnvDetected()) {
  // Never print the value. The child never sees it (it is stripped), but warn loudly.
  console.warn(
    '\n[mads] WARNING: ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN is set in this shell.\n' +
      '       It would override your Claude Code login and bill that API account.\n' +
      '       Mads-Lens removes it from the claude child process, but you should unset it.\n',
  );
}

const bin = resolveClaudeBin(cfg.claudeBin);
try {
  const v = execFileSync(bin.command, [...bin.prefixArgs, '--version'], { env: childEnv(cfg), encoding: 'utf8', timeout: 20000, windowsHide: true }).trim();
  console.log(`[mads] claude: ${v}${bin.note ? ` (${bin.note})` : ''}`);
} catch (e) {
  console.warn(`[mads] WARNING: could not run "${cfg.claudeBin} --version": ${(e as Error).message}. Live runs will fail until this is fixed (see README). Replay mode still works.`);
}

const mgr = new RunManager(cfg);
const app = createApp(cfg, mgr);
const server = app.listen(cfg.port, cfg.host, () => {
  console.log(`[mads] Mads-Lens server on http://${cfg.host}:${cfg.port}`);
  console.log(`[mads] allowed tools: ${cfg.dangerouslySkipPermissions ? '(ALL — --dangerously-skip-permissions is ON)' : cfg.allowedTools.join(' ')}`);
  if (cfg.model) console.log(`[mads] model: ${cfg.model}`);
});

server.on('error', (e: NodeJS.ErrnoException) => {
  console.error(e.code === 'EADDRINUSE' ? `[mads] port ${cfg.port} is already in use — is Mads-Lens already running? Set MADS_PORT to use another port.` : `[mads] server error: ${e.message}`);
  mgr.shutdown();
  process.exit(1);
});

let closing = false;
function shutdown(sig: string) {
  if (closing) return;
  closing = true;
  console.log(`[mads] ${sig}: stopping child processes`);
  mgr.shutdown();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('exit', () => mgr.shutdown());
