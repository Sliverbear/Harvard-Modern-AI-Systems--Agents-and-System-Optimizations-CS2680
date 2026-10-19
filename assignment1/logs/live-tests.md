# Live integration tests (real Claude Code CLI)

Date: 2026-10-19T03:56:05.132Z  
Server: http://127.0.0.1:5174 · model: haiku  
Allowed tools: `Read Edit Write Glob Grep Bash(pytest:*) Bash(python:*) Bash(python3:*) Bash(ls:*) Task Agent`

| Test | Result |
|---|---|
| A multi-step task (read → diagnose → fix → rerun tests) | PASS |
| B resume (follow-up depends on A) | PASS |
| C subagent | PASS |
| D failures (invalid directory + denied tool) | PASS |
| E live streaming (events in DOM before the result event) | PASS |
| S stop (cancel a live run) | PASS |

## A multi-step task (read → diagnose → fix → rerun tests) — PASS
- ✓ run finished — finished
- ✓ read the code (Read/Grep tool or cat/grep/sed in Bash) — grep -n "low_stock" -A8 inventory/*.py && grep -n "def make" -A10 tests/test_core.py
- ✓ edited a file — <SCRATCH>/inventory/inventory/core.py
- ✓ ran pytest at least twice (diagnose + confirm) or once after the edit — 2 pytest call(s)
- ✓ every tool_use got a tool_result — 4 calls
- ✓ suite passes afterwards (checked independently) — 5 passed in 0.01s
- ✓ result metrics present — {"cost":0.00259329,"turns":5}

## B resume (follow-up depends on A) — PASS
- ✓ run finished — finished
- ✓ command used --resume <A session id> — -p --resume 02206a9f-3689-4f13-a355-abd67322fffb
- ✓ same session_id in init and result — 02206a9f-3689-4f13-a355-abd67322fffb / 02206a9f-3689-4f13-a355-abd67322fffb
- ✓ README changed
- ✓ README mentions the fixed function (context carried over, not given in the prompt) — ## Bug fix: `Inventory.low_stock` | `low_stock` in `inventory/core.py` used a strict `<` comparison, so items whose quantity was exactly equal to the threshold were left out, even though the docstring says "at or below." I changed the comparison to `<=`, so items at the threshold are now included, a

## C subagent — PASS
- ✓ run finished — finished
- ✓ raw stream has events with non-null parent_tool_use_id — 5 events
- ✓ those events reference a tool_use in the same stream — Agent(toolu_01Q2GZrfEY9Vu5R6zqHZ4TuX)
- ✓ subagent made its own tool calls — 2 nested calls

## D failures (invalid directory + denied tool) — PASS
- ✓ invalid dir run ends failed (no hang) — failed
- ✓ error message names the bad path — Could not start Claude Code: Working directory does not exist: /tmp/mads-lens-no-such-dir-1792382154009
- ✓ no claude events for the invalid dir
- ✓ denied tool comes back as tool_result is_error=true — touch in '/tmp/mads_lens_denied_probe.txt' needs approval. The path is outside the working directories for this session ('~/repo/
- ✓ file was not created
- ✓ run itself still completes (denial is not a crash) — finished

## E live streaming (events in DOM before the result event) — PASS
- ✓ a tool call was in the DOM while the run status was still "running" — first tool at 1901 ms, 1 tool row(s), run still running: true
- ✓ run finished later than the first tool row appeared — finished at 4328 ms
- ✓ more tool rows appeared after the first (incremental updates) — 1 → 3

## S stop (cancel a live run) — PASS
- ✓ run ends as cancelled — cancelled
- ✓ process terminated by a signal or exit — signal=null exit=143
- ✓ no result event recorded after cancel (run did not complete) — 1 lines before stop
