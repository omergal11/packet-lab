interface Entry {
  readonly time: number;
  // Insertion counter used as a tie-breaker: earlier insertions win at equal timestamps.
  // This makes the simulation deterministic even when many events share the same time.
  readonly order: number;
  readonly handler: () => void;
}

// Min-heap priority queue ordered by (time, order).
// A heap gives O(log n) push and pop, which is fine for thousands of events per run.
export class EventQueue {
  private readonly heap: Entry[] = [];
  private counter = 0;

  get size(): number {
    return this.heap.length;
  }

  push(time: number, handler: () => void): void {
    const entry: Entry = { time, order: this.counter++, handler };
    this.heap.push(entry);
    this.bubbleUp(this.heap.length - 1);
  }

  pop(): Entry | undefined {
    if (this.heap.length === 0) return undefined;
    // The minimum is always at index 0.
    const top = this.heap[0] as Entry;
    // Move the last element to the root and restore the heap property.
    const last = this.heap.pop() as Entry;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.sinkDown(0);
    }
    return top;
  }

  // Returns true if entry `a` should come out of the queue before entry `b`.
  private before(a: Entry, b: Entry): boolean {
    return a.time < b.time || (a.time === b.time && a.order < b.order);
  }

  private bubbleUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      const curr = this.heap[i] as Entry;
      const par = this.heap[parent] as Entry;
      if (!this.before(curr, par)) break;
      this.heap[i] = par;
      this.heap[parent] = curr;
      i = parent;
    }
  }

  private sinkDown(i: number): void {
    const n = this.heap.length;
    for (;;) {
      let best = i;
      const l = 2 * i + 1;
      const r = 2 * i + 2;
      if (l < n && this.before(this.heap[l] as Entry, this.heap[best] as Entry)) best = l;
      if (r < n && this.before(this.heap[r] as Entry, this.heap[best] as Entry)) best = r;
      if (best === i) break;
      const tmp = this.heap[i] as Entry;
      this.heap[i] = this.heap[best] as Entry;
      this.heap[best] = tmp;
      i = best;
    }
  }
}
