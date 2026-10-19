# Mads-Lens — architecture plan & acceptance checklist

## Environment findings (milestone 1)

| Check | Result |
|---|---|
| `node --version` | v22 (cloud dev container); target: user's Windows machine with Node ≥ 20 |
| `claude --version` | `2.1.303 (Claude Code)` |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` | not set (checked without printing values) |
| trivial headless run | `claude -p "Reply with just the word OK" --output-format stream-json --verbose` → `result/success` |

**Nested-execution finding.** The first test run was spawned from inside a Claude Code session and inherited its
`CLAUDE*` environment variables; the child reported the *parent's* `session_id` (it attached to the running
session). With every `CLAUDE*` variable removed from the child env (`CLAUDECODE`, `CLAUDE_CODE_*`, …) the child
got a fresh session id and behaved normally. Mads-Lens therefore strips `ANTHROPIC_API_KEY`,
`ANTHROPIC_AUTH_TOKEN` and all `CLAUDE*` variables (except `CLAUDE_CONFIG_DIR`) from the child environment.

## Real stream vs. the expected event model

Recorded with 2.1.303 (`fixtures/real/`). Differences from the assignment's list:

1. **Subagent tool name.** `system/init.tools` lists `Task`, but the `tool_use` blocks are named **`Agent`**.
   Both are in the default allow-list; subagents are detected only via `parent_tool_use_id`.
2. **Async subagents.** The `Agent` call returns a `tool_result` immediately ("Async agent launched…"); the
   subagent's events (with `parent_tool_use_id`) keep arriving afterwards, and `system/task_started`,
   `task_progress`, `task_notification` events (carrying `tool_use_id`) report its lifecycle.
3. **More than one `result` event per process.** When a background subagent finishes after the main turn
   ended, the CLI emits `result`, then a new `system/init`, more assistant events, and a second `result`.
   The run is therefore only over when the **process exits**; metrics use the last `result`.
4. Each content block usually arrives as its own `assistant` event (same `message.id`).
5. Extra event types: `rate_limit_event`, `system/status`, `system/thinking_tokens`,
   `system/background_tasks_changed`, `system/permission_denied`, `system/task_*`. They are preserved,
   counted and hidden by default ("show all events" reveals them). Truly unknown types are always shown as raw rows.
6. Permission denials arrive as `tool_result` with `is_error: true` (plus `system/permission_denied`)
   and as `result.permission_denials`. In this environment Claude Code auto-allows read-only shell commands
   inside the working directory even if they are not in `--allowedTools`; writes outside it are denied.
7. `--max-turns 1` exhausted → `result/error_max_turns`, `is_error: true`, exit code 1.

## Architecture

```
browser ──POST /api/runs──▶ app.ts ──▶ runManager.startRun ──▶ claudeProcess.spawnClaude (argv array, stdin ignored)
   ▲                                          │ stdout chunks
   │ SSE /api/sessions/:id/stream             ▼
   └──────── ServerMessage ◀── emit ◀── ingest(line): runStore.appendLine (raw, first) → parseLine → meta updates
                                              ▲
            POST /api/replay ─▶ startReplay ──┘ (same ingest path, timers instead of a process)
client: SessionModel.apply(msg) → trajectory.applyLine (normalize + tool/subagent tracking) → React
```

| Concern | Module |
|---|---|
| CLI process execution | `server/claudeProcess.ts` |
| Raw ingestion + persistence | `server/lineBuffer.ts`, `server/runStore.ts` |
| Event normalization | `shared/trajectory.ts` (`applyLine`) |
| Tool-call / subagent tracking | `shared/trajectory.ts` (`tools` map, `parent_tool_use_id` nesting, outline) |
| Run outcome | `shared/outcome.ts` |
| Run + session management, replay | `server/runManager.ts` |
| API + SSE | `server/app.ts`, `server/index.ts` |
| Presentation | `client/src/**` |

## Acceptance checklist

- [ ] F1 submit: real subprocess in chosen dir; second run works; invalid dir → visible error
- [ ] F2 live trajectory: updates before completion, correct order, Markdown
- [ ] F3 tool results: paired by id, folded long output, error styling, persisted after reload
- [ ] F4 status: tool pending/success/error/no-result; run running/finished/failed/cancelled; no infinite spinner
- [ ] F5 resume: `--resume <session_id>`, cwd lock, context carried, "resumed session" label, New session
- [ ] F6 metrics: cost, duration, turns, session id; "—" when missing
- [ ] F7 tree + outline: nesting by parent id, collapsible groups with summary, side outline, click-to-scroll
- [ ] Replay mode, fixtures (real + synthetic), automated tests, live tests A–E, docs, session archive
