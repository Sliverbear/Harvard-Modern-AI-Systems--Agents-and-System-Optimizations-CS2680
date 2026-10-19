// Client-side state for one Mads-Lens session, built only from ServerMessages.
import type { RunMeta, ServerMessage, SessionMeta } from './types.ts';
import { applyLine, applyMeta, createRun, type RunModel } from './trajectory.ts';

export class SessionModel {
  session: SessionMeta | null = null;
  runs = new Map<string, RunModel>();
  order: string[] = [];
  version = 0;

  private upsertRun(meta: RunMeta): RunModel {
    let run = this.runs.get(meta.id);
    if (!run) {
      run = createRun(meta);
      this.runs.set(meta.id, run);
      this.order.push(meta.id);
      this.order.sort((a, b) => (this.runs.get(a)!.meta.index - this.runs.get(b)!.meta.index));
    }
    applyMeta(run, meta);
    return run;
  }

  apply(msg: ServerMessage): void {
    switch (msg.kind) {
      case 'hello':
        this.session = msg.session;
        this.runs.clear();
        this.order = [];
        for (const r of msg.runs) this.upsertRun(r);
        break;
      case 'session':
        this.session = msg.session;
        break;
      case 'run':
        this.upsertRun(msg.run);
        break;
      case 'line': {
        const run = this.runs.get(msg.runId);
        if (run && msg.data.seq >= run.lineCount) applyLine(run, msg.data);
        break;
      }
      case 'stderr': {
        const run = this.runs.get(msg.runId);
        if (run) run.stderr += msg.text;
        break;
      }
    }
    this.version++;
  }

  get activeRun(): RunModel | null {
    for (const id of this.order) {
      const r = this.runs.get(id)!;
      if (r.meta.status === 'running') return r;
    }
    return null;
  }

  get runList(): RunModel[] {
    return this.order.map((id) => this.runs.get(id)!);
  }
}
