import { describe, expect, it } from 'vitest';
import { EventQueue } from '../src/engine/eventQueue.js';

function drain(q: EventQueue): void {
  while (q.size > 0) q.pop()!.handler();
}

describe('EventQueue', () => {
  it('returns undefined when empty', () => {
    expect(new EventQueue().pop()).toBeUndefined();
  });

  it('reports correct size', () => {
    const q = new EventQueue();
    expect(q.size).toBe(0);
    q.push(1, () => undefined);
    expect(q.size).toBe(1);
    q.pop();
    expect(q.size).toBe(0);
  });

  it('returns events in ascending time order', () => {
    const q = new EventQueue();
    const out: number[] = [];
    q.push(30, () => out.push(30));
    q.push(10, () => out.push(10));
    q.push(20, () => out.push(20));
    drain(q);
    expect(out).toEqual([10, 20, 30]);
  });

  it('preserves insertion order (FIFO) for equal timestamps', () => {
    const q = new EventQueue();
    const out: string[] = [];
    q.push(5, () => out.push('first'));
    q.push(5, () => out.push('second'));
    q.push(5, () => out.push('third'));
    drain(q);
    expect(out).toEqual(['first', 'second', 'third']);
  });

  it('handles a mix of timestamps and ties', () => {
    const q = new EventQueue();
    const out: string[] = [];
    q.push(10, () => out.push('a'));
    q.push(5, () => out.push('b'));
    q.push(10, () => out.push('c')); // same time as 'a', inserted after
    q.push(1, () => out.push('d'));
    drain(q);
    expect(out).toEqual(['d', 'b', 'a', 'c']);
  });

  it('handles a large number of events', () => {
    const q = new EventQueue();
    const N = 500;
    // Push in reverse order
    for (let i = N - 1; i >= 0; i--) q.push(i, () => undefined);
    const times: number[] = [];
    while (q.size > 0) times.push(q.pop()!.time);
    // Every adjacent pair must be non-decreasing
    for (let i = 1; i < times.length; i++) {
      expect(times[i]).toBeGreaterThanOrEqual(times[i - 1]!);
    }
  });
});
