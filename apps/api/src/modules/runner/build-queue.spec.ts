import { SerialQueue } from './build-queue.js';

describe('SerialQueue', () => {
  it('runs jobs one at a time in order, even if one fails', async () => {
    const q = new SerialQueue();
    const events: string[] = [];
    let running = 0;
    const job =
      (name: string, fail = false) =>
      async () => {
        running += 1;
        expect(running).toBe(1);
        events.push(`start ${name}`);
        await new Promise((r) => setTimeout(r, 10));
        events.push(`end ${name}`);
        running -= 1;
        if (fail) throw new Error('boom');
      };
    q.push(job('a'));
    q.push(job('b', true));
    q.push(job('c'));
    expect(q.size).toBe(3);
    await q.idle();
    expect(events).toEqual([
      'start a',
      'end a',
      'start b',
      'end b',
      'start c',
      'end c',
    ]);
    expect(q.size).toBe(0);
  });
});
