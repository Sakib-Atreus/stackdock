/** Runs jobs strictly one after another (D-04: one build at a time). */
export class SerialQueue {
  private tail: Promise<void> = Promise.resolve();
  private pending = 0;

  push(job: () => Promise<void>): void {
    this.pending += 1;
    this.tail = this.tail
      .then(job)
      .catch(() => undefined)
      .finally(() => {
        this.pending -= 1;
      });
  }

  get size(): number {
    return this.pending;
  }

  /** Resolves when everything queued so far has finished. */
  idle(): Promise<void> {
    return this.tail;
  }
}
