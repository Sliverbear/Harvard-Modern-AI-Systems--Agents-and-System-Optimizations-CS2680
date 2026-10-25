import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../server/config';
import { buildReportPrompt, frontendContext, generateReport } from '../../server/report';

const README = '# Mads-Lens\n\nIntro text.\n\n## 1. Prerequisites\n\nnode\n\n## 8. Improvements beyond the seven required features\n\n- Replay\n\n## 9. Known limitations\n\n- none\n';

describe('report prompt', () => {
  it('takes the intro and section 8 of the README as the frontend description', () => {
    const ctx = frontendContext(README);
    expect(ctx).toContain('Intro text.');
    expect(ctx).toContain('- Replay');
    expect(ctx).not.toContain('Prerequisites');
    expect(ctx).not.toContain('Known limitations');
  });

  it('asks for the writeup sections in the chosen language, with the run data inside', () => {
    const p = buildReportPrompt('RUN-DATA', 'FRONTEND', 'zh');
    for (const s of ['## 1. What I built', '### 2.1 How the agent works', '### 2.2 A pitfall', '### 2.3 A lesson', '## 3. One thing I would change about Claude Code']) expect(p).toContain(s);
    expect(p).toContain('Traditional Chinese');
    expect(p).toContain('<run_data>\nRUN-DATA\n</run_data>');
    expect(buildReportPrompt('x', 'y', 'en')).toContain('Write in English.');
  });
});

describe('generateReport', () => {
  // A stand-in for `claude -p --output-format json`: echoes its argv and stdin size back as the result.
  function fakeBin(body: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mads-report-test-'));
    const f = path.join(dir, 'fake.mjs');
    fs.writeFileSync(f, body);
    return f;
  }

  it('sends the prompt on stdin with all tools disabled and returns the result text', async () => {
    const bin = fakeBin(`let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.stringify({type:'result',is_error:false,total_cost_usd:0.01,modelUsage:{'m-1':{}},result:JSON.stringify({argv:process.argv.slice(2),stdin:s})})));`);
    const r = await generateReport({ ...loadConfig({}), claudeBin: bin, model: null }, 'hello 世界');
    const echo = JSON.parse(r.text);
    expect(echo.stdin).toBe('hello 世界');
    expect(echo.argv).toEqual(['-p', '--output-format', 'json', '--tools', '', '--strict-mcp-config', '--no-session-persistence']);
    expect(r.costUsd).toBe(0.01);
    expect(r.model).toBe('m-1');
  });

  it('rejects with the CLI message when the result is an error', async () => {
    const bin = fakeBin(`process.stdin.resume().on('end',()=>{console.log(JSON.stringify({type:'result',is_error:true,result:'Not logged in'}));process.exit(1)});`);
    await expect(generateReport({ ...loadConfig({}), claudeBin: bin }, 'x')).rejects.toThrow('Not logged in');
  });
});
