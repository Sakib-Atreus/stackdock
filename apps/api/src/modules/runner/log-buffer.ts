export interface LogLine {
  seq: number;
  ts: string;
  stream: 'stdout' | 'stderr' | 'system';
  text: string;
}

const MAX_LINE_CHARS = 4_000;

function clip(text: string): string {
  return text.length > MAX_LINE_CHARS
    ? `${text.slice(0, MAX_LINE_CHARS)}… [line truncated]`
    : text;
}

/** Fixed-size ring buffer of recent runtime log lines. */
export class RingLog {
  private lines: LogLine[] = [];
  private seq = 0;

  constructor(private readonly capacity = 1_000) {}

  push(stream: LogLine['stream'], text: string): LogLine {
    const line = {
      seq: ++this.seq,
      ts: new Date().toISOString(),
      stream,
      text: clip(text),
    };
    this.lines.push(line);
    if (this.lines.length > this.capacity) this.lines.shift();
    return line;
  }

  /** Lines with seq > after (0 = everything still buffered). */
  since(after = 0, limit = 500): LogLine[] {
    const out = this.lines.filter((l) => l.seq > after);
    return out.slice(-limit);
  }

  get lastSeq(): number {
    return this.seq;
  }
}

/**
 * Accumulates build output, keeping at most `maxChars` (the newest text
 * wins; a marker shows that the start was cut).
 */
export class BoundedText {
  private text = '';
  private truncated = false;

  constructor(private readonly maxChars = 512 * 1024) {}

  append(line: string): void {
    this.text += `${clip(line)}\n`;
    if (this.text.length > this.maxChars) {
      this.text = this.text.slice(this.text.length - this.maxChars);
      this.text = this.text.slice(this.text.indexOf('\n') + 1);
      this.truncated = true;
    }
  }

  toString(): string {
    return this.truncated
      ? `[… earlier output truncated …]\n${this.text}`
      : this.text;
  }
}
