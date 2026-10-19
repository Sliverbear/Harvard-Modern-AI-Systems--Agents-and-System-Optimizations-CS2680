# What was redacted before committing

The same rules were applied to every committed fixture and log, using `scripts/redact-fixture.mjs` and `scripts/redact-logs.mjs`. Fixtures were checked afterwards to make sure every JSON line still parses.

| Pattern | Replaced with | Where |
|---|---|---|
| Absolute path of the scratch working copy (e.g. `/home/…/assignment1/scratch/work/inventory`, `/home/…/live/proj`) | `<SCRATCH>/inventory` | fixtures/real, logs |
| Absolute path of the `assignment1` folder | `<ASSIGNMENT1>` | fixtures/real, logs |
| `~/.claude/projects/<encoded path>` | `<CLAUDE_DIR>` | fixtures (memory path in system prompts) |
| `/tmp/claude-<uid>/<encoded path>` (task output files) | `<CLAUDE_TMP>` | fixtures |
| `/tmp/cc-socks/<n>.sock` | `<SOCKET>` | fixtures |
| Home directories (`/home/<user>`, `/Users/<user>`, `/root`, `C:\Users\<user>`) | `~` | everywhere |
| E-mail addresses | `<EMAIL>` | everywhere (session archive included) |
| Token-shaped strings (`sk-…`, `ghp_…`, `AKIA…`) | `<REDACTED_TOKEN>` | everywhere; none were found |

Not redacted on purpose: Claude Code `session_id`s and `toolu_…` ids, which are needed for resume and pairing; tool and model names; and the tool lists in `system/init` events.

Secret scan, after redaction:

```
grep -rlE 'sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{36}|AKIA[0-9A-Z]{16}|BEGIN [A-Z ]*PRIVATE KEY' fixtures logs sessions
```

It found no matches. See `sessions/README.md` for the session-archive specifics.
