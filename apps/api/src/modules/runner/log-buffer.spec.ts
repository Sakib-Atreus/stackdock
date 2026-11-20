import { BoundedText, RingLog } from './log-buffer.js';

describe('RingLog', () => {
  it('keeps only the newest lines and supports incremental reads', () => {
    const log = new RingLog(3);
    for (let i = 1; i <= 5; i++) log.push('stdout', `line ${i}`);
    expect(log.since(0).map((l) => l.text)).toEqual([
      'line 3',
      'line 4',
      'line 5',
    ]);
    expect(log.since(4).map((l) => l.text)).toEqual(['line 5']);
    expect(log.lastSeq).toBe(5);
  });

  it('clips very long lines', () => {
    const log = new RingLog();
    expect(log.push('stdout', 'x'.repeat(10_000)).text.length).toBeLessThan(
      4_100,
    );
  });
});

describe('BoundedText', () => {
  it('keeps the newest output and marks truncation', () => {
    const t = new BoundedText(30);
    for (let i = 0; i < 10; i++) t.append(`line number ${i}`);
    const s = t.toString();
    expect(s).toContain('line number 9');
    expect(s).not.toContain('line number 0');
    expect(s.startsWith('[… earlier output truncated …]')).toBe(true);
  });
});
