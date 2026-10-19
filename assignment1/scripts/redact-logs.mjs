// Redact private absolute paths / identifiers in logs/ (run before committing).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { redactText } from './redact-fixture.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const maps = [[path.join(ROOT, 'scratch', 'work', 'inventory'), '<SCRATCH>/inventory'], [ROOT, '<ASSIGNMENT1>']];
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
for (const f of walk(path.join(ROOT, 'logs'))) {
  if (!/\.(json|md|log|txt|jsonl)$/.test(f)) continue;
  const src = fs.readFileSync(f, 'utf8');
  const out = redactText(src.replace(/\x1b\[[0-9;]*m/g, ''), maps);
  if (out !== src) fs.writeFileSync(f, out);
}
console.log('logs redacted');
