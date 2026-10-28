import { describe, expect, it } from 'vitest';
import { Link, REORDER_EXTRA_DELAYS } from '../src/engine/link.js';
import { mulberry32 } from '../src/engine/prng.js';
import type { Packet } from '../src/engine/packet.js';

const pkt: Packet = { kind: 'DATA', seq: 0, payload: 'hello' };

describe('Link', () => {
  it('lossRate=0 never drops', () => {
    const link = new Link(
      { lossRate: 0, baseDelayMs: 100, jitterMs: 0, duplicateRate: 0, reorderRate: 0 },
      mulberry32(1),
    );
    for (let i = 0; i < 100; i++) {
      expect(link.transmit(pkt).dropped).toBe(false);
    }
  });

  it('lossRate=1 always drops', () => {
    const link = new Link(
      { lossRate: 1, baseDelayMs: 100, jitterMs: 0, duplicateRate: 0, reorderRate: 0 },
      mulberry32(1),
    );
    for (let i = 0; i < 50; i++) {
      expect(link.transmit(pkt).dropped).toBe(true);
    }
  });

  it('same PRNG state gives identical results', () => {
    const config = {
      lossRate: 0.3,
      baseDelayMs: 100,
      jitterMs: 50,
      duplicateRate: 0.1,
      reorderRate: 0.05,
    };
    const l1 = new Link(config, mulberry32(99));
    const l2 = new Link(config, mulberry32(99));
    for (let i = 0; i < 30; i++) {
      expect(l1.transmit(pkt)).toEqual(l2.transmit(pkt));
    }
  });

  it('no loss and no duplication → exactly one copy', () => {
    const link = new Link(
      { lossRate: 0, baseDelayMs: 100, jitterMs: 0, duplicateRate: 0, reorderRate: 0 },
      mulberry32(1),
    );
    const result = link.transmit(pkt);
    expect(result.dropped).toBe(false);
    expect(result.delays).toHaveLength(1);
    // With jitter=0 and reorderRate=0 the delay is exactly baseDelayMs
    expect(result.delays[0]).toBeCloseTo(100);
  });

  it('duplicateRate=1 always produces two copies', () => {
    const link = new Link(
      { lossRate: 0, baseDelayMs: 100, jitterMs: 0, duplicateRate: 1, reorderRate: 0 },
      mulberry32(1),
    );
    for (let i = 0; i < 20; i++) {
      const result = link.transmit(pkt);
      expect(result.dropped).toBe(false);
      expect(result.delays).toHaveLength(2);
    }
  });

  it('delay is at least baseDelayMs when jitter=0 and reorderRate=0', () => {
    const link = new Link(
      { lossRate: 0, baseDelayMs: 200, jitterMs: 0, duplicateRate: 0, reorderRate: 0 },
      mulberry32(5),
    );
    for (let i = 0; i < 20; i++) {
      const { delays } = link.transmit(pkt);
      expect(delays[0]).toBeGreaterThanOrEqual(200);
    }
  });
});

describe('Link — statistics', () => {
  it('observed drop rate matches lossRate over 10,000 packets', () => {
    const link = new Link(
      { lossRate: 0.3, baseDelayMs: 100, jitterMs: 50, duplicateRate: 0.1, reorderRate: 0.1 },
      mulberry32(12345),
    );
    const N = 10_000;
    let drops = 0;
    for (let i = 0; i < N; i++) if (link.transmit(pkt).dropped) drops++;
    expect(drops / N).toBeGreaterThan(0.27);
    expect(drops / N).toBeLessThan(0.33);
  });
});

describe('Link — reordering', () => {
  // Sends `n` packets 10 ms apart and returns their seqs in arrival order.
  function arrivalOrder(reorderRate: number, n = 50): number[] {
    const link = new Link(
      { lossRate: 0, baseDelayMs: 100, jitterMs: 5, duplicateRate: 0, reorderRate },
      mulberry32(3),
    );
    const arrivals: { seq: number; at: number }[] = [];
    for (let seq = 0; seq < n; seq++) {
      const { delays } = link.transmit({ kind: 'DATA', seq });
      arrivals.push({ seq, at: seq * 10 + delays[0]! });
    }
    return arrivals.sort((a, b) => a.at - b.at).map((a) => a.seq);
  }

  it('reorderRate=1 holds every copy back by REORDER_EXTRA_DELAYS base delays', () => {
    const link = new Link(
      { lossRate: 0, baseDelayMs: 100, jitterMs: 0, duplicateRate: 0, reorderRate: 1 },
      mulberry32(1),
    );
    expect(link.transmit(pkt).delays[0]).toBeCloseTo(100 * (1 + REORDER_EXTRA_DELAYS));
  });

  it('with reorderRate=0 and jitter smaller than the send gap, order is preserved', () => {
    const order = arrivalOrder(0);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('with reorderRate > 0, packets arrive out of order', () => {
    const order = arrivalOrder(0.2);
    expect(order).not.toEqual([...order].sort((a, b) => a - b));
  });
});
