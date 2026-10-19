# Claude Code session archive

`a1-sessions.tar.gz` holds the Claude Code session folders from `~/.claude/projects/` of the machine where Mads-Lens was built and tested. It was archived from inside `projects/`, following the course's export instructions.

| Folder (encoded cwd) | What it contains |
|---|---|
| `-home-claude/` | **The main build session**: the Claude Code session that read the spec, wrote all of the code, ran the tests and wrote the docs. It includes its `tool-results/` sub-folder when present. |
| `-home-claude-scratchtest/` | The first `claude -p` probes, including the nested run that wrongly attached to the parent session (see PLAN.md "Nested-execution finding"). |
| `-home-claude-live-proj/`, `-home-claude-live-fail/` | Headless runs recorded directly with the CLI while exploring the event stream; they became the first fixtures. |
| `-home-claude-repo-assignment1-scratch-work-inventory/` | Headless sessions started **by Mads-Lens** during the live tests A–E and S, and while developing. |

## How it was produced

1. The folders listed above were copied from `~/.claude/projects/`.
2. E-mail addresses were replaced with `<EMAIL>` in every text file.
3. The token scan (`sk-…`, `ghp_…`, `AKIA…`, `BEGIN … PRIVATE KEY`) returned no matches.
4. The archive was made with `tar -czf a1-sessions.tar.gz ./-home-claude ./-home-claude-scratchtest …`, run from inside the copied `projects/` folder.

There was no `memory/` folder. The archive was made near the end of the build session, so the last few steps (final sync to the course repo) are not in it.

If you continue working on this assignment with Claude Code on your own machine, also archive those sessions. See README.md §11 for the commands, including the Windows variant.
