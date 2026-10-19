# Verification summary

Environment: Linux dev container · Node 22 · Claude Code 2.1.303 · model `haiku` for every live test (to save usage) · Chromium 1194 (Playwright 1.56).
Not verified on Windows (see "Not verified" below).

| Feature | Implemented | Tested (how) | Result | Evidence |
|---|---|---|---|---|
| F1 Submit a prompt (cwd validation, multiline, Ctrl/⌘+Enter, Run↔Stop, second run) | yes | Live test A (real CLI in the scratch dir); Playwright "submit…" (Ctrl+Enter, second run, invalid dir); live test D (invalid dir) | PASS | `logs/live-tests.md` A, D · `logs/playwright.log` test 4 |
| F2 Live trajectory (all blocks in order, Markdown, tool name + summary + JSON input, main/subagent attribution, follow-tail + jump) | yes | Live test E (Playwright on a real run: tool rows in the DOM while the run was still `running`, then more rows); unit "every content block… in order"; Playwright edge-case test (Markdown bold + code block) | PASS | `logs/live/E.json`, `logs/live/E-mid-run.png`, `tests/unit/trajectory.test.ts` |
| F3 Tool results (pairing by id, string/array/image/other, fold at 10 lines + "▸ K more lines", error styling, persist after reload) | yes | Unit pairing + content-type tests; Playwright folding (110 more lines → expand), error badge, reload persistence; live A ("every tool_use got a tool_result") | PASS | `tests/unit/trajectory.test.ts`, `logs/playwright.log` tests 2–3, `logs/live/A.json` |
| F4 Execution status (tool: pending/success/error/no-result; run: running/finished/failed/cancelled; clear failure messages) | yes | Unit `decideOutcome` (7 cases) + process tests (missing result, non-zero exit, spawn ENOENT, invalid cwd, SIGTERM→SIGKILL cancel); live D (denied tool → `is_error`), live S (Stop on a real run → cancelled, exit 143); Playwright edge case (no result → failed, pending → "no result") | PASS | `tests/unit/parsing.test.ts`, `tests/unit/process.test.ts`, `logs/live-tests.md` D, S |
| F5 Session resume (`--resume <id>`, cwd lock, multi-run transcript, earlier runs folded, "resumed session" label, New session) | yes | Live test B: same `session_id` in init + result, README updated with the fixed function's name, which the follow-up prompt never mentioned; unit (resume args, cwd lock 409, duplicate submit 409); Playwright (resumed label, earlier run folded, cwd input disabled) | PASS | `logs/live/B.json`, `tests/unit/process.test.ts`, `logs/playwright.log` tests 3–4 |
| F6 Metrics (cost USD, duration, turns, session id; usage when present; "—" if missing) | yes | Unit metrics from real fixtures + missing-field test; Playwright metrics bar matches the fixture's final `total_cost_usd`; live A checks the result fields are present | PASS | `tests/unit/trajectory.test.ts`, `logs/playwright.log` |
| F7 Subagent tree + outline (nesting by `parent_tool_use_id`, multi-level + parallel, collapsible with summary, flat runs, sticky side outline / drawer, click → expand + scroll + highlight, status in outline) | yes | Live test C: raw stream has events with non-null `parent_tool_use_id` referencing an `Agent` call, nested tool calls; unit (parallel + nested synthetic, placeholder parent, name-independent detection, flat run, two real recordings); Playwright (collapse shows "5 events, 3 tools", outline click re-expands + highlights + in viewport; phone-width drawer) | PASS | `logs/live/C.json`, `tests/unit/trajectory.test.ts`, `logs/playwright.log` tests 1, 5 |
| Replay mode (same ingest + SSE path, recorded timing / 10× / instant, REPLAY label, no model calls) | yes | Unit replay tests (line count equals file; no-result synthetic → failed); Playwright replays of real + synthetic fixtures | PASS | `tests/unit/process.test.ts`, `logs/playwright.log` |
| Incremental JSONL parsing (split chunks, many per chunk, malformed, UTF-8 split) | yes | Unit `LineBuffer` tests; process tests stream real recordings through the test-double CLI in 1–2000-byte chunks and compare the saved `events.jsonl` byte-for-byte | PASS | `tests/unit/parsing.test.ts`, `tests/unit/process.test.ts` |
| API key / env safety | yes | Unit: child env drops `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `CLAUDECODE`, `CLAUDE_CODE_*`; process test checks the child did not receive the key | PASS | `tests/unit/process.test.ts` |

## Test runs (final)

- `npm test` → 42/42 passed (`logs/vitest.log`)
- `npm run test:e2e` → 5/5 passed (`logs/playwright.log`, `logs/playwright-results.json`)
- `npm run test:live` → A, B, C, D, E, S all PASS (`logs/live-tests.md`, `logs/live/*.json`, `logs/live-tests.console.log`)
- Approximate model usage for all live testing and recording (haiku, plus two tiny default-model probes): well under US$0.50 (sum of `total_cost_usd` of the app's runs: about $0.09).

## Not verified

- **Running on Windows**: the user's target. There was no Windows machine available. The npm `.cmd` shim resolution is unit-tested with a simulated `win32` PATH only. The first live run on Windows should be watched: if `claude` is not found, set `MADS_CLAUDE_BIN`.
- **Claude Code versions other than 2.1.303**: event shapes may differ. Unknown events are shown as raw rows, never dropped.
- **Default (non-haiku) model**: live tests used `MADS_MODEL=haiku`. The CLI flags and the event stream are the same.
