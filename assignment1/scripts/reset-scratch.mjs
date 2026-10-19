// Copy the pristine demo project (scratch/demo-project) to scratch/work/inventory,
// which is the directory the agent edits. Re-run any time to restore the failing test.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'scratch', 'demo-project');
const dst = path.join(root, 'scratch', 'work', 'inventory');
fs.rmSync(dst, { recursive: true, force: true });
fs.mkdirSync(path.dirname(dst), { recursive: true });
fs.cpSync(src, dst, { recursive: true, filter: (p) => !/(__pycache__|\.pytest_cache)/.test(p) });
console.log(`scratch reset: ${dst}`);
