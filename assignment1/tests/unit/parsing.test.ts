import { describe, expect, it } from 'vitest';
import { LineBuffer, parseLine } from '../../server/lineBuffer';
import { decideOutcome } from '../../shared/outcome';

describe('LineBuffer (incremental JSONL)', () => {
  it('joins a record split across chunks', () => {
    const b = new LineBuffer();
    expect(b.push('{"type":"sys')).toEqual([]);
    expect(b.push('tem","n":1}')).toEqual([]);
    expect(b.push('\n')).toEqual(['{"type":"system","n":1}']);
  });

  it('splits multiple records in one chunk and keeps the partial tail', () => {
    const b = new LineBuffer();
    expect(b.push('{"a":1}\n{"b":2}\n{"c":')).toEqual(['{"a":1}', '{"b":2}']);
    expect(b.push('3}\n')).toEqual(['{"c":3}']);
  });

  it('handles CRLF, blank lines and a final line without newline', () => {
    const b = new LineBuffer();
    expect(b.push('{"a":1}\r\n\n\n{"b":2}')).toEqual(['{"a":1}']);
    expect(b.end()).toEqual(['{"b":2}']);
  });

  it('does not corrupt a multi-byte UTF-8 character split across Buffer chunks', () => {
    const b = new LineBuffer();
    const bytes = Buffer.from('{"t":"héllo ✓"}\n', 'utf8');
    const cut = bytes.indexOf(0xe2) + 1; // inside the 3-byte ✓
    expect(b.push(bytes.subarray(0, cut))).toEqual([]);
    const out = b.push(bytes.subarray(cut));
    expect(JSON.parse(out[0]).t).toBe('héllo ✓');
  });

  it('flags malformed lines instead of throwing', () => {
    expect(parseLine('{"ok":true}').json).toEqual({ ok: true });
    const bad = parseLine('{"truncated":');
    expect(bad.json).toBeNull();
    expect(bad.parseError).toBeTruthy();
    expect(parseLine('[1,2]').json).toBeNull();
  });
});

describe('decideOutcome (run-level status)', () => {
  const base = { cancelled: false, spawnError: null, exitCode: 0, signal: null, lastResult: null, stderrTail: null };
  it('success result + exit 0 => finished', () => {
    expect(decideOutcome({ ...base, lastResult: { subtype: 'success', is_error: false } }).status).toBe('finished');
  });
  it('non-success result is failed even with exit code 0', () => {
    const o = decideOutcome({ ...base, lastResult: { subtype: 'error_max_turns', is_error: true } });
    expect(o.status).toBe('failed');
    expect(o.error).toContain('error_max_turns');
  });
  it('missing result event => failed with exit code and stderr', () => {
    const o = decideOutcome({ ...base, exitCode: 3, stderrTail: 'boom' });
    expect(o.status).toBe('failed');
    expect(o.error).toContain('without a result event');
    expect(o.error).toContain('exit code 3');
    expect(o.error).toContain('boom');
  });
  it('signal without result => failed mentioning the signal', () => {
    expect(decideOutcome({ ...base, exitCode: null, signal: 'SIGKILL' }).error).toContain('SIGKILL');
  });
  it('spawn error => failed', () => {
    expect(decideOutcome({ ...base, spawnError: 'spawn claude ENOENT' }).error).toContain('ENOENT');
  });
  it('cancel wins over everything', () => {
    expect(decideOutcome({ ...base, cancelled: true, exitCode: null, signal: 'SIGTERM' }).status).toBe('cancelled');
  });
  it('success result but non-zero exit => failed', () => {
    expect(decideOutcome({ ...base, exitCode: 1, lastResult: { subtype: 'success' } }).status).toBe('failed');
  });
});
