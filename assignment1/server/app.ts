// HTTP API + Server-Sent Events.
import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import type { ServerConfigView, ServerMessage } from '../shared/types.ts';
import { apiKeyEnvDetected, ROOT, type Config } from './config.ts';
import { validateCwd } from './claudeProcess.ts';
import { HttpError, RunManager } from './runManager.ts';

export function createApp(cfg: Config, mgr: RunManager) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  // Local-only app: reject requests whose Host is not loopback (DNS-rebinding guard),
  // and cross-origin state-changing requests.
  app.use((req, res, next) => {
    const host = (req.headers.host ?? '').replace(/:\d+$/, '');
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) return res.status(403).json({ error: 'Forbidden host' });
    const origin = req.headers.origin;
    if (req.method !== 'GET' && origin && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) {
      return res.status(403).json({ error: 'Forbidden origin' });
    }
    next();
  });

  const wrap = (fn: (req: Request, res: Response) => unknown) => (req: Request, res: Response, next: NextFunction) => {
    try {
      const out = fn(req, res);
      if (out !== undefined && !res.headersSent) res.json(out);
    } catch (e) {
      next(e);
    }
  };

  app.get('/api/config', wrap((): ServerConfigView => ({
    claudeBin: cfg.claudeBin,
    model: cfg.model,
    allowedTools: cfg.allowedTools,
    dangerouslySkipPermissions: cfg.dangerouslySkipPermissions,
    apiKeyEnvDetected: apiKeyEnvDetected(),
    defaultCwd: cfg.defaultCwd,
    recentDirs: mgr.getRecentDirs(),
    platform: process.platform,
  })));

  app.post('/api/validate-cwd', wrap((req) => validateCwd(req.body?.cwd)));

  app.get('/api/sessions', wrap(() => mgr.listSessions()));
  app.get('/api/sessions/:id', wrap((req) => ({ session: mgr.getSession(req.params.id), runs: mgr.getRuns(req.params.id) })));

  app.get('/api/sessions/:id/stream', (req, res, next) => {
    try {
      mgr.getSession(req.params.id);
    } catch (e) {
      return next(e);
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();
    const send = (msg: ServerMessage) => res.write(`data: ${JSON.stringify(msg)}\n\n`);
    const unsubscribe = mgr.subscribe(req.params.id, send);
    const ping = setInterval(() => res.write(': ping\n\n'), 15000);
    req.on('close', () => {
      clearInterval(ping);
      unsubscribe();
    });
  });

  app.post('/api/runs', wrap((req, res) => {
    const { sessionId, cwd, prompt } = req.body ?? {};
    const out = mgr.startRun({ sessionId: sessionId ?? null, cwd, prompt });
    res.status(201);
    return out;
  }));
  app.post('/api/runs/:id/cancel', wrap((req) => mgr.cancel(req.params.id)));
  app.get('/api/runs/:id/events', wrap((req) => mgr.getLines(req.params.id)));

  app.get('/api/fixtures', wrap(() => mgr.listFixtures()));
  app.post('/api/replay', wrap((req, res) => {
    const speed = ['realtime', 'fast', 'instant'].includes(req.body?.speed) ? req.body.speed : 'fast';
    const session = mgr.startReplay(String(req.body?.fixture ?? ''), speed);
    res.status(201);
    return { session };
  }));

  // Production: serve the built client.
  const dist = path.join(ROOT, 'client', 'dist');
  if (fs.existsSync(dist)) {
    app.use(express.static(dist));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    void _next;
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 500) console.error('[mads] error', err);
    res.status(status).json({ error: err instanceof Error ? err.message : String(err) });
  });
  return app;
}
