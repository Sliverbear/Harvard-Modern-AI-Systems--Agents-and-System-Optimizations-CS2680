# Demo checklist (2–3 minutes, live, all seven features)

## Before recording (not part of the video)

```bash
cd assignment1
npm run scratch:reset          # restores the deliberately failing test
npm run build && npm start     # http://127.0.0.1:5174
```

- Check that `claude --version` works and that you are logged in. **Do not** have `ANTHROPIC_API_KEY` set.
- Open http://127.0.0.1:5174 and click **New session**. Use a window at least 1024 px wide so the outline shows as a side column.
- Optional dry run without usage: Replay → `real/resumed-session` → instant.
- Copy the absolute path of `assignment1/scratch/work/inventory` (it is already the default working directory).

The scratch project is `scratch/demo-project`: a tiny `inventory` library with 5 pytest tests. `test_low_stock_includes_threshold` fails because `low_stock()` uses `<` where its docstring says "at or below".

## Script

| # | Time | Do | Type exactly | You should see (feature) |
|---|---|---|---|---|
| 1 | 0:00 | Say one sentence: "Mads-Lens drives the real `claude -p` CLI and streams its events." Point at the header (no session yet) and the composer. | — | Composer with the working directory and the allowed-tools summary. |
| 2 | 0:10 | Point the working directory at a path that doesn't exist, then press **Run**. | dir: `/tmp/does-not-exist` · prompt: `hello` | A run card turns **✕ Failed** immediately, with "Working directory does not exist: …", exit code — and no spinner. **(F1 invalid dir, F4 failed run)** |
| 3 | 0:20 | Click **New session**, set the dir back to `…/scratch/work/inventory`, and press **Ctrl+Enter**. | `The pytest suite has one failing test. Read the relevant code, find the bug, fix it with a minimal change, and rerun pytest to confirm all tests pass.` | The header shows **Running** with a spinner. Assistant text (Markdown) and tool calls (`Bash pytest…`, `Read`/`Grep …core.py`, `Edit …core.py`) appear one by one, **before** the run ends. Each tool shows a ⟳ *running* badge until its result arrives, then ✓. The outline on the right fills in live. **(F2, F4 tool status)** |
| 4 | 0:45 | While it runs, scroll up a little, then click **Jump to latest**. | — | Auto-scroll pauses when you scroll up and resumes after the click. **(F2)** |
| 5 | 0:55 | When it finishes, expand the first pytest result's **▸ N more lines**, then show less. Click a tool header to reveal the full input JSON. | — | Results are folded to 10 lines, expand into a bounded scroll box, and failed results are red. **(F3)** |
| 6 | 1:05 | Point at the metrics bar of the run. | — | **✓ Finished**, plus Cost ($), Duration, Turns, tokens and the session id. **(F6, F4 run status)** |
| 7 | 1:15 | Send a follow-up that only makes sense with context. | `Now update the README to document the bug you just fixed: which function, what was wrong, and how you fixed it.` | Run 1 folds. Run 2 is labeled **↻ resumed session …** with the same session id in the header, and the working directory shows 🔒 *locked*. Claude edits README.md and mentions `low_stock`, which the prompt did not name, so the context carried over. **(F5)** |
| 8 | 1:40 | Send a subagent prompt in the same session. | `Use a subagent (the Agent/Task tool) to survey this directory and report its structure in 3 short bullets. Do not survey it yourself.` | An `Agent` call with an indigo **Subagent · <type>** group nested under it. The subagent's own Bash/Read/Glob calls appear inside it. The group status goes *running → completed*. **(F7 tree)** |
| 9 | 2:05 | Collapse the subagent group, then click a nested call in the **outline**. | — | The collapsed group shows "· N events, M tools". Clicking the outline item re-expands the group, scrolls to the call and briefly highlights it. **(F7 collapse + outline)** |
| 10 | 2:20 | Show a failing tool: send a prompt that triggers a denied command. | `Use the Bash tool to run exactly: touch /tmp/mads_denied.txt — then report what happened. Do not try alternatives.` | The tool call ends **✕ error** with the permission-denial text, and a "Permission denied" note is shown. The run itself still finishes, because a denial is not a crash. **(F3 error result, F4)** |
| 11 | 2:35 | Optional if time allows: start a longer prompt and press **■ Stop**. | `Read every file in this directory one by one and summarize each in detail.` | The run turns **■ Cancelled**. |
| 12 | 2:45 | Optional: resize the window to phone width and open **Outline** (drawer). Toggle dark mode. | — | Responsive layout. |

## If something goes wrong while recording

- The agent may phrase or order things differently each time; the features shown stay the same.
- If the subagent prompt doesn't spawn a subagent, run it again with: `You MUST call the Agent tool to delegate this: survey this directory and report 3 bullets.`
- To restart cleanly: `npm run scratch:reset`, then **New session**.
- If you can't use live usage: Replay `real/resumed-session`, `real/subagent`, `real/failed-denied-tool` and `synthetic/edge-malformed-unknown-noresult` at "recorded timing". These runs are labeled REPLAY, and the assignment asks for live streaming in the video, so record the live version for submission.
