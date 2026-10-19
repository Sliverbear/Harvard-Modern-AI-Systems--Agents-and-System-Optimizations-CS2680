#!/usr/bin/env node
// TEST DOUBLE ONLY — used by Vitest to exercise process handling (chunking, exits, signals,
// cancel) without spending model usage. Never used in live mode. Behaviour via env:
//   FAKE_SCENARIO = fixture | noresult | hang | stderr-exit | version
//   FAKE_FIXTURE  = path of a .jsonl to emit (split into odd-sized chunks)
//   FAKE_ARGV_OUT = file to write the received argv + cwd + selected env into (JSON)
import fs from 'node:fs';

const argv = process.argv.slice(2);
if (argv.includes('--version')) {
  console.log('0.0.0-fake (Claude Code test double)');
  process.exit(0);
}
if (process.env.FAKE_ARGV_OUT) {
  fs.writeFileSync(process.env.FAKE_ARGV_OUT, JSON.stringify({
    argv,
    cwd: process.cwd(),
    hasApiKey: 'ANTHROPIC_API_KEY' in process.env,
    hasClaudeCode: 'CLAUDECODE' in process.env,
  }));
}
const scenario = process.env.FAKE_SCENARIO ?? 'fixture';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function emitChunked(text) {
  // Deliberately split records across chunks and merge several records per chunk.
  const sizes = [7, 300, 1, 64, 2000, 13];
  let i = 0, k = 0;
  while (i < text.length) {
    const n = sizes[k++ % sizes.length];
    process.stdout.write(text.slice(i, i + n));
    i += n;
    await sleep(2);
  }
}

if (scenario === 'fixture') {
  await emitChunked(fs.readFileSync(process.env.FAKE_FIXTURE, 'utf8'));
  process.exit(Number(process.env.FAKE_EXIT ?? 0));
} else if (scenario === 'noresult') {
  await emitChunked('{"type":"system","subtype":"init","session_id":"fake-1"}\n{"type":"assistant","message":{"content":[{"type":"text","text":"working"}]},"parent_tool_use_id":null}\n');
  process.stderr.write('fatal: something broke\n');
  process.exit(3);
} else if (scenario === 'hang') {
  process.stdout.write('{"type":"system","subtype":"init","session_id":"fake-hang"}\n');
  if (process.env.FAKE_IGNORE_TERM) process.on('SIGTERM', () => {});
  setInterval(() => {}, 1000);
} else if (scenario === 'stderr-exit') {
  process.stderr.write('Error: Invalid API key · Please run /login\n');
  process.exit(1);
}
