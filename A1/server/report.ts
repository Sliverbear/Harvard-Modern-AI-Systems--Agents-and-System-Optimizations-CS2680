// Writeup-style report of one run, written by Claude Code itself.
// The run export goes in on stdin (argv is too small on Windows); Claude gets no tools,
// no MCP servers and no saved session, so the call is plain text in, Markdown out.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Config } from './config.ts';
import { childEnv, resolveClaudeBin, terminate } from './claudeProcess.ts';

export type ReportLang = 'zh' | 'en';

const LANG_NAME: Record<ReportLang, string> = { zh: 'Traditional Chinese (繁體中文); keep code, commands, file names and tool names as-is', en: 'English' };

/** README parts that describe the frontend: the intro and §8 (improvements beyond the seven features). */
export function frontendContext(readme: string): string {
  const intro = readme.split(/\n## 1\./)[0] ?? '';
  const improvements = readme.match(/\n## 8\.[\s\S]*?(?=\n## \d+\.|$)/)?.[0] ?? '';
  return `${intro.trim()}\n${improvements.trim()}`.trim();
}

export function buildReportPrompt(runMarkdown: string, frontend: string, lang: ReportLang): string {
  return `You are writing a short technical writeup about ONE Claude Code run that was observed in Mads-Lens, a local web frontend that runs the headless Claude Code CLI and shows its event stream. Write in first person, as the person who ran it. Write in ${LANG_NAME[lang]}.

Use exactly this structure (Markdown, no preamble, no closing remarks):

# <short title naming the task of this run>

## 1. What I built
One paragraph on what the Mads-Lens frontend does, based on the frontend description below. Then this line exactly:
![Mads-Lens screenshot](demo/screenshot.png)
Then "Improvements beyond the seven required features" as a bullet list, based on the frontend description.

## 2. What I learned
### 2.1 How the agent works
Where it spent more time than expected, what it read that a person might not have read, or how it approached the task differently than a person would.
### 2.2 A pitfall
What went wrong or was surprising, how it shows up in the data, and what to warn a classmate about.
### 2.3 A lesson
What to do differently next time when using an agent (prompting, scoping, supervising), and what in this run teaches that.

## 3. One thing I would change about Claude Code
One change to Claude Code itself (not to the frontend), and what in this run motivates it.

Rules:
- Every observation in section 2 and 3 must be tied to a specific moment in the run: cite the tool call number, the command or file, the time ("at 4.2 s"), or the numbers (cost, tokens, cache, turns).
- Only claim what the run data shows. Never invent events. If the run went smoothly and nothing went wrong, say so and use the most surprising or risky thing you can actually see (for example a permission that was auto-approved, a claim the agent did not verify, noisy tool output, cost dominated by cached context).
- Claude Code also puts context into its system prompt that never appears in the event stream (git status and recent commits, CLAUDE.md, memory, environment details). When the agent states something no tool call in this run shows, say it was not verified by a tool call in this run; do not call it invented or hallucinated.
- Brief and concrete; do not pad.

<frontend_description>
${frontend}
</frontend_description>

<run_data>
${runMarkdown}
</run_data>`;
}

export interface ReportResult {
  text: string;
  costUsd: number | null;
  model: string | null;
}

/** Run `claude -p` once with the prompt on stdin and return the final text. */
export function generateReport(cfg: Config, prompt: string, timeoutMs = 5 * 60_000): Promise<ReportResult> {
  const bin = resolveClaudeBin(cfg.claudeBin);
  const args = ['-p', '--output-format', 'json', '--tools', '', '--strict-mcp-config', '--no-session-persistence'];
  if (cfg.model) args.push('--model', cfg.model);
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'mads-report-'));
  return new Promise((resolve, reject) => {
    const child = spawn(bin.command, [...bin.prefixArgs, ...args], { cwd, stdio: ['pipe', 'pipe', 'pipe'], env: childEnv(cfg), shell: false, windowsHide: true });
    let out = '';
    let err = '';
    const timer = setTimeout(() => terminate(child, cfg.killTimeoutMs), timeoutMs);
    child.stdout.on('data', (b: Buffer) => (out += b.toString('utf8')));
    child.stderr.on('data', (b: Buffer) => (err = (err + b.toString('utf8')).slice(-4000)));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(new Error(`Could not start Claude Code: ${e.message}`));
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      fs.rmSync(cwd, { recursive: true, force: true });
      let r: any = null;
      try {
        r = JSON.parse(out.trim().split('\n').pop() ?? '');
      } catch {
        /* reported below */
      }
      if (!r || r.is_error || typeof r.result !== 'string' || !r.result.trim()) {
        const why = r?.result || err.trim() || out.trim().slice(-500) || `exit code ${code}, signal ${signal}`;
        return reject(new Error(`Report generation failed: ${why}`));
      }
      const model = r.modelUsage && typeof r.modelUsage === 'object' ? Object.keys(r.modelUsage)[0] ?? null : null;
      resolve({ text: r.result.trim(), costUsd: typeof r.total_cost_usd === 'number' ? r.total_cost_usd : null, model });
    });
    child.stdin.end(prompt, 'utf8');
  });
}
