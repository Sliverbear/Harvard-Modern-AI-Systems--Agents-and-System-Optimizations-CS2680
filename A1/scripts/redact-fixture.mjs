// Redact private absolute paths / identifiers from a recorded events.jsonl before committing it.
// usage: node scripts/redact-fixture.mjs <in.jsonl> <out.jsonl> [--map /abs/path=<PLACEHOLDER> ...]
// Applied rules (also listed in logs/REDACTIONS.md):
//   1. explicit --map prefixes (e.g. the scratch dir -> <SCRATCH>)
//   2. Claude Code project/tmp dirs (~/.claude/projects/<encoded>, /tmp/claude-*/<encoded>) -> <CLAUDE_DIR>
//   3. home directories (/home/<u>, /Users/<u>, /root, C:\Users\<u>) -> ~
//   4. e-mail addresses -> <EMAIL>; token-looking strings (sk-…, ghp_…, AKIA…) -> <REDACTED_TOKEN>
// It works on the raw text and verifies every line that was JSON is still JSON.
import fs from 'node:fs';

export function redactText(text, maps = []) {
  let out = text;
  for (const [from, to] of maps) out = out.split(from).join(to);
  out = out
    .replace(/(?:\/root|\/home\/[A-Za-z0-9._-]+)\/\.claude\/projects\/[A-Za-z0-9._-]+/g, '<CLAUDE_DIR>')
    .replace(/\/tmp\/claude-[0-9]+\/[A-Za-z0-9._-]+/g, '<CLAUDE_TMP>')
    .replace(/\/tmp\/cc-socks\/[0-9]+\.sock/g, '<SOCKET>')
    .replace(/\/home\/[A-Za-z0-9._-]+/g, '~')
    .replace(/\/Users\/[A-Za-z0-9._-]+/g, '~')
    .replace(/(?<![A-Za-z0-9_])\/root(?=\/|"|\s)/g, '~')
    .replace(/[A-Za-z]:(?:\\\\|\\)Users(?:\\\\|\\)[A-Za-z0-9._-]+/g, '~')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<EMAIL>')
    .replace(/sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{36}|AKIA[0-9A-Z]{16}/g, '<REDACTED_TOKEN>');
  return out;
}

if (process.argv[1] && process.argv[1].endsWith('redact-fixture.mjs')) {
  const [, , inp, outp, ...rest] = process.argv;
  const maps = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--map') {
      const [a, b] = rest[++i].split('=');
      maps.push([a, b]);
    }
  }
  maps.sort((a, b) => b[0].length - a[0].length);
  const src = fs.readFileSync(inp, 'utf8');
  const red = redactText(src, maps);
  const a = src.split('\n');
  const b = red.split('\n');
  a.forEach((l, i) => {
    let wasJson = true;
    try { JSON.parse(l); } catch { wasJson = false; }
    if (wasJson && l.trim()) JSON.parse(b[i]); // throws if redaction broke JSON
  });
  fs.writeFileSync(outp, red);
  console.log(`redacted ${inp} -> ${outp}`);
}
