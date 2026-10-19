# Mads-Lens

Mads-Lens is a local web app for watching Claude Code work. You type a programming task and pick a working directory. The server runs the real headless CLI there:

```
claude -p "<prompt>" --output-format stream-json --verbose --allowedTools …
```

It then streams every event to the browser as it happens. You can see tool calls with their inputs and results, the status of each tool and run, cost, duration and turn count, and the subagent tree with an outline beside it. Follow-up prompts continue the same Claude Code session with `--resume <session_id>`.

This is an observability frontend for an existing agent. It contains no agent loop and no agent framework, and it does not use the Agent SDK.

![screenshot placeholder](demo/screenshot.png)

---

## 1. Prerequisites

| Requirement | Notes |
|---|---|
| **Node.js ≥ 20** | Tested with Node 22. Check with `node --version`. |
| **Claude Code CLI, logged in** | Run `claude` once in a terminal and complete the browser login. Check with `claude --version`. Claude Code needs a paid plan (Pro/Max/Team/Enterprise); the free plan cannot use it. |
| **Python 3 + pytest** (demo only) | Needed by the demo scratch project: `python -m pip install pytest`. |

> ⚠️ **Do not export `ANTHROPIC_API_KEY`** (or `ANTHROPIC_AUTH_TOKEN`). An exported key overrides your Claude Code login and silently bills that API account instead.
> At startup Mads-Lens warns you if either variable is set, and it never prints the value. It also always removes both variables from the environment of the `claude` child process.

## 2. Install

```bash
cd assignment1
npm install
npm run scratch:reset      # creates scratch/work/inventory (the demo target, with one failing test)
```

## 3. Start

**Normal use** (one process, http://127.0.0.1:5174):

```bash
npm run build
npm start
```

**Development** (Vite hot reload at http://127.0.0.1:5173; the API runs on 5174):

```bash
npm run dev
```

The server binds to **127.0.0.1 only**. It also rejects requests whose `Host` header is not a loopback name, and it rejects cross-origin POSTs.

### Windows

The commands are the same in PowerShell. Mads-Lens never uses a shell to start `claude`:

- If `claude.exe` is on `PATH` (the native installer), Mads-Lens runs it directly.
- If only the npm shim `claude.cmd` exists, Mads-Lens runs `node <npm-global>/node_modules/@anthropic-ai/claude-code/cli.js` instead.
- If neither is found, set the full path yourself:

  ```powershell
  $env:MADS_CLAUDE_BIN = "C:\Users\<you>\.local\bin\claude.exe"
  npm start
  ```

## 4. Using it

1. **Live run.** Set the working directory (the default is `scratch/work/inventory`), type a prompt and press **Run** or `Ctrl/⌘+Enter`. Events stream in as they arrive. **Stop** terminates the process: SIGTERM first, then SIGKILL after 3 s.
2. **Follow-up.** After a run ends, type another prompt. It resumes the same Claude Code session. Because Claude Code stores sessions per project directory, the directory is locked for the session. Use **New session** to change directory or to start fresh.
3. **Replay.** Switch the composer to **Replay**, pick a saved `events.jsonl` from `fixtures/`, choose a speed (recorded timing / 10× / instant) and press **▶ Replay**. Replayed runs are labeled **REPLAY** everywhere and make no model calls.
4. **History.** Every run is saved under `data/`. Use the **History…** menu or reload the page (the URL keeps `#s=<session>`) to bring back earlier sessions, including all tool results.

### Configuration

All settings live in [`server/config.ts`](server/config.ts). You can override them with environment variables or an optional `mads.config.json` in this folder.

| Env var | Default | Meaning |
|---|---|---|
| `MADS_ALLOWED_TOOLS` | `Read,Edit,Write,Glob,Grep,Bash(pytest:*),Bash(python:*),Bash(python3:*),Bash(ls:*),Task,Agent` | Comma-separated `--allowedTools` list, shown in the UI. Headless mode refuses any tool that is not allowed. |
| `MADS_DANGEROUS_SKIP_PERMISSIONS` | `0` | `1` passes `--dangerously-skip-permissions` instead of the allow-list. **Off by default.** When on, a red banner is shown. Use it only on scratch directories. |
| `MADS_MODEL` | *(empty → Claude Code default)* | For example `haiku` to save usage while experimenting. |
| `MADS_CLAUDE_BIN` | `claude` | Path to the CLI. |
| `MADS_PORT` | `5174` | Server port. |
| `MADS_DEFAULT_CWD` | `scratch/work/inventory` | Prefilled working directory. |
| `MADS_DATA_DIR` | `data` | Where runs are stored. |

Example `mads.config.json`:

```json
{ "allowedTools": ["Read", "Edit", "Bash(pytest:*)", "Agent", "Task"], "model": "haiku" }
```

**Subagent tool name.** Claude Code 2.1.x lists the subagent tool as `Task` in `system/init.tools`, but its `tool_use` blocks are named `Agent`. The default allow-list includes both. Mads-Lens detects subagents only through `parent_tool_use_id`, never through the tool name.

### Scratch directory

`scratch/demo-project/` is the pristine demo project: a tiny inventory library with five pytest tests, one of which fails on purpose. `npm run scratch:reset` copies it to `scratch/work/inventory/` (git-ignored). The agent edits that copy, so run the reset again to bring back the failing test. You can also point Mads-Lens at any other directory, but keep it a scratch copy.

## 5. Tests

```bash
npm test               # Vitest: 42 unit/integration tests (parser, normalization, tree, metrics, process handling)
npm run test:e2e       # Playwright: 5 browser tests (replay + a test-double CLI; no model usage)
npm run test:live      # live tests A–E + S against the REAL CLI (uses a small amount of usage)
```

- The process-handling tests and the Playwright "submit" test use `tests/fake-claude/fake-claude.mjs`. It is a **test double** that replays a recorded stream in odd-sized chunks, exits without a result, hangs, and so on, so that spawn, kill and exit handling can be tested deterministically. It is used only by tests, never in live mode.
- `npm run test:live` needs the server running (`npm start`). Its output goes to `logs/live-tests.md` and `logs/live/*.json`. Add `--export-fixtures` to re-record `fixtures/real/` (paths are redacted automatically).
- Playwright uses its bundled Chromium. To use another one, set `PW_CHROMIUM=/path/to/chrome`. If Chromium is missing, run `npx playwright install chromium` once.

## 6. Data layout

```
data/sessions/<id>.json            session: locked cwd, Claude Code session_id, run ids
data/runs/<run>/events.jsonl       every stdout line exactly as received (written before parsing)
data/runs/<run>/timing.jsonl       receive time of each line (used for realistic replay)
data/runs/<run>/meta.json          prompt, cwd, args, timestamps, exit code/signal, status, error
data/runs/<run>/stderr.log
fixtures/real/                     recorded from the real CLI (redacted)
fixtures/synthetic/                hand-written edge cases (marked "synthetic": true in *.meta.json)
```

## 7. Architecture

See [PLAN.md](PLAN.md) for the module map and for the differences found between the real stream and the documented event model. In short:

- `server/claudeProcess.ts`: builds the argument array, resolves the binary, spawns with stdin ignored, and kills (SIGTERM → SIGKILL).
- `server/lineBuffer.ts`: incremental JSONL splitting (records split across chunks, several records per chunk, split UTF-8 characters).
- `server/runStore.ts`: persistence (each raw line is appended before it is parsed).
- `server/runManager.ts`: sessions, runs, the cwd lock, one active run per session, terminal state, and replay. Replay uses the same ingest path as live runs.
- `server/app.ts`: REST + Server-Sent Events.
- `shared/trajectory.ts`: normalization and tool/subagent tracking, shared by the client and the tests.
- `shared/outcome.ts`: run status from the result event and the process exit.
- `client/`: React + TypeScript + Vite + Tailwind.

## 8. Improvements beyond the seven required features

- Replay at recorded timing, 10× speed or instantly, with multi-run session fixtures.
- Background-subagent awareness. Claude Code 2.1.x runs subagents asynchronously, so a run can emit **two** result events. Mads-Lens keeps the run open until the process exits, shows the subagent's live status (`task_*` events), and lists every result event.
- Session history and reload persistence (`#s=<id>` in the URL).
- A "show all events" toggle. Low-level system events are preserved but hidden by default, and unknown event types are always shown as raw rows.
- Wall-clock time next to the CLI-reported duration, plus token and cache usage when present.
- Dark mode, a phone-width layout with an outline drawer, and keyboard-accessible controls. Status is always shown with an icon and a word, never by color alone.
- Local-only hardening: binds to loopback, checks the Host header and the Origin, strips API keys from the child environment, and never uses a shell.

## 9. Known limitations

- **Single user, local only.** There is no auth, and nothing is meant to be deployed.
- **One active run per session.** Several sessions can run in parallel, each with its own process.
- **Replay vs. live.** Replay sessions are read-only. You cannot "resume" a recorded session live, because the recorded session id belongs to another machine.
- **Permissions.** In headless mode a tool outside the allow-list is denied, and the denial is shown as a failed tool. Claude Code itself may auto-approve read-only shell commands inside the working directory even when they are not in `--allowedTools`. This is Claude Code's behavior, not Mads-Lens's.
- **Windows** has not been tested on a real Windows machine; the development and test environment was Linux. The `.cmd`-shim resolution is unit-tested with a simulated `win32` PATH. On Windows, Stop goes straight to forced termination, because Node maps SIGTERM to `TerminateProcess`.
- **Thinking blocks** usually arrive without text in `stream-json`, so they show as "thinking (content not included in stream)".
- **The tool-result preview** shows the first 10 lines; the rest expands into a bounded scroll box.

## 10. Nested execution note

If you start Mads-Lens from **inside** a Claude Code session (for example, Claude Code running `npm start`), the child `claude -p` inherits variables such as `CLAUDECODE` and `CLAUDE_CODE_*`. During development this made the child report the **parent's** `session_id`. Mads-Lens therefore removes every `CLAUDE*` variable except `CLAUDE_CONFIG_DIR` from the child environment. With that change, nested runs got their own session ids and behaved normally.

## 11. Session files

The Claude Code session files from building this project are archived in `sessions/`. See `sessions/README.md` for what is included, how it was produced and what was redacted. On your own machine they live in `~/.claude/projects/<cwd with every non-alphanumeric character replaced by "-">/*.jsonl`. To archive them:

```bash
cd ~/.claude/projects
tar -czf <repo>/assignment1/sessions/a1-sessions.tar.gz ./-<your-encoded-project-path>
# scan before committing:
grep -rlE 'sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{36}|AKIA[0-9A-Z]{16}|BEGIN [A-Z ]*PRIVATE KEY' ./-<your-encoded-project-path>
```

On Windows PowerShell: `Compress-Archive -Path "$env:USERPROFILE\.claude\projects\<folder>" -DestinationPath assignment1\sessions\a1-sessions.zip`.
