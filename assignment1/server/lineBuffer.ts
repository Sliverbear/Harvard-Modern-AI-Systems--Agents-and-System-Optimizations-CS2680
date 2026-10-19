// Incremental JSONL splitter: handles records split across chunks and many records per chunk.
import { StringDecoder } from 'node:string_decoder';

export class LineBuffer {
  private buf = '';
  private decoder = new StringDecoder('utf8'); // never splits a multi-byte UTF-8 char

  /** Feed a chunk; returns the complete lines it finished (without the newline). */
  push(chunk: Buffer | string): string[] {
    this.buf += typeof chunk === 'string' ? chunk : this.decoder.write(chunk);
    const out: string[] = [];
    let nl: number;
    while ((nl = this.buf.indexOf('\n')) !== -1) {
      let line = this.buf.slice(0, nl);
      this.buf = this.buf.slice(nl + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (line.trim()) out.push(line);
    }
    return out;
  }

  /** Flush whatever is left at end of stream (a final line without trailing newline). */
  end(): string[] {
    this.buf += this.decoder.end();
    const rest = this.buf;
    this.buf = '';
    return rest.trim() ? [rest.replace(/\r$/, '')] : [];
  }
}

export function parseLine(line: string): { json: any | null; parseError?: string } {
  try {
    const json = JSON.parse(line);
    if (json === null || typeof json !== 'object' || Array.isArray(json)) {
      return { json: null, parseError: 'line is valid JSON but not an object' };
    }
    return { json };
  } catch (e) {
    return { json: null, parseError: (e as Error).message };
  }
}
