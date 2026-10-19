# Assignment 1 — Writeup

<!--
TEMPLATE ONLY. The prose must be written by you; the course penalizes AI-generated writeups.
The HTML comments below only point to session moments / log files you may want to look at.
Delete the comments before submitting.
-->

## 1. What I built

_[One paragraph in your own words.]_

![Mads-Lens screenshot](demo/screenshot.png)

**Improvements beyond the required features:**

- _[…]_

<!--
Pointers:
- README.md §8 lists what was added beyond the seven features (replay speeds, background-subagent handling,
  history/reload, "show all events", wall clock, dark/phone layout, local-only hardening).
- logs/live/E-mid-run.png and E-finished.png are real screenshots taken during live test E.
-->

## 2. What I learned

### 2.1 How the agent works

_[Observation tied to a specific moment in a session: where it spent time, what it read, how it approached the task.]_

<!--
Possible moments to look at:
- logs/live/A.json → "tools": the order of calls in the multi-step fix (did it run the tests first? read
  files with Read or with cat/grep in Bash? how many pytest runs?).
- fixtures/real/multistep.jsonl vs fixtures/real/resumed-session/run-1.jsonl: two recordings of the same
  task; compare the approaches.
- Result usage in logs/live/*.json: cache_read vs. input tokens (most input is cached context).
-->

### 2.2 A pitfall

_[What went wrong, how you noticed, what to warn classmates about.]_

<!--
Candidates observed during development (verify in the logs before using any):
- PLAN.md "Nested-execution finding": a nested `claude -p` inherited CLAUDE* env vars and reported the
  parent's session_id.
- PLAN.md item 1: init.tools says "Task" but tool_use blocks say "Agent" (allow-list mismatch).
- PLAN.md item 3 / fixtures/real/subagent-async-two-results.jsonl: an async subagent produced two result
  events in one process; treating the first result as "run finished" would cut the run short.
- PLAN.md item 6: read-only Bash commands outside --allowedTools were still auto-approved.
-->

### 2.3 A lesson

_[What you would change in prompting, scoping or supervision.]_

<!--
Possible material: logs/live-tests.md (test A first failed only because the check assumed the agent would use
the Read tool; it used grep in Bash instead) — what does that say about specifying/verifying agent behavior?
-->

## 3. One thing I would change about Claude Code

_[One change to Claude Code itself (not the frontend) and what you observed that motivates it.]_

<!--
Possible starting points (your opinion needed): the Task/Agent naming mismatch; multiple result events per
process with async subagents; thinking blocks without content in stream-json; permission behavior in
headless mode.
-->
