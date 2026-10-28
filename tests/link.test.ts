import { describe, expect, it } from 'vitest';
import { Link, REORDER_EXTRA_DELAYS, type LinkConfig } from '../src/engine/link.js';
import { mulberry32 } from '../src/engine/prng.js';

// Feeds one sequential random stream into a Link, transmission after transmission.
// Fine for testing the Link's own behaviour; the Simulation uses per-packet streams.
function sequentialLink(config: LinkConfig, rng: () => number) {
  const link = new Link(config);
  return { transmit: () => link.transmit(rng) };
}

describe('Link', () => {
  it('lossRate=0 never drops', () => {
    const link = sequentialLink(
      { lossRate: 0, baseDelayMs: 100, jitterMs: 0, duplicateRate: 0, reorderRate: 0 },
      mulberry32(1),
    );
    for (let i = 0; i < 100; i++) {
      expect(link.transmit().dropped).toBe(false);
    }
  });

  it('lossRate=1 always drops', () => {
    const link = sequentialLink(
      { lossRate: 1, baseDelayMs: 100, jitterMs: 0, duplicateRate: 0, reorderRate: 0 },
      mulberry32(1),
    );
    for (let i = 0; i < 50; i++) {
      expect(link.transmit().dropped).toBe(true);
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
    const l1 = sequentialLink(config, mulberry32(99));
    const l2 = sequentialLink(config, mulberry32(99));
    for (let i = 0; i < 30; i++) {
      expect(l1.transmit()).toEqual(l2.transmit());
    }
  });

  it('no loss and no duplication → exactly one copy', () => {
    const link = sequentialLink(
      { lossRate: 0, baseDelayMs: 100, jitterMs: 0, duplicateRate: 0, reorderRate: 0 },
      mulberry32(1),
    );
    const result = link.transmit();
    expect(result.dropped).toBe(false);
    expect(result.delays).toHaveLength(1);
    // With jitter=0 and reorderRate=0 the delay is exactly baseDelayMs
    expect(result.delays[0]).toBeCloseTo(100);
  });

  it('duplicateRate=1 always produces two copies', () => {
    const link = sequentialLink(
      { lossRate: 0, baseDelayMs: 100, jitterMs: 0, duplicateRate: 1, reorderRate: 0 },
      mulberry32(1),
    );
    for (let i = 0; i < 20; i++) {
      const result = link.transmit();
      expect(result.dropped).toBe(false);
      expect(result.delays).toHaveLength(2);
    }
  });

  it('delay is at least baseDelayMs when jitter=0 and reorderRate=0', () => {
    const link = sequentialLink(
      { lossRate: 0, baseDelayMs: 200, jitterMs: 0, duplicateRate: 0, reorderRate: 0 },
      mulberry32(5),
    );
    for (let i = 0; i < 20; i++) {
      const { delays } = link.transmit();
      expect(delays[0]).toBeGreaterThanOrEqual(200);
    }
  });
});

describe('Link — statistics', () => {
  it('observed drop rate matches lossRate over 10,000 packets', () => {
    const link = sequentialLink(
      { lossRate: 0.3, baseDelayMs: 100, jitterMs: 50, duplicateRate: 0.1, reorderRate: 0.1 },
      mulberry32(12345),
    );
    const N = 10_000;
    let drops = 0;
    for (let i = 0; i < N; i++) if (link.transmit().dropped) drops++;
    expect(drops / N).toBeGreaterThan(0.27);
    expect(drops / N).toBeLessThan(0.33);
  });
});

describe('Link — reordering', () => {
  // Sends `n` packets 10 ms apart and returns their seqs in arrival order.
  function arrivalOrder(reorderRate: number, n = 50): number[] {
    const link = sequentialLink(
      { lossRate: 0, baseDelayMs: 100, jitterMs: 5, duplicateRate: 0, reorderRate },
      mulberry32(3),
    );
    const arrivals: { seq: number; at: number }[] = [];
    for (let seq = 0; seq < n; seq++) {
      const { delays } = link.transmit();
      arrivals.push({ seq, at: seq * 10 + delays[0]! });
    }
    return arrivals.sort((a, b) => a.at - b.at).map((a) => a.seq);
  }

  it('reorderRate=1 holds every copy back by REORDER_EXTRA_DELAYS base delays', () => {
    const link = sequentialLink(
      { lossRate: 0, baseDelayMs: 100, jitterMs: 0, duplicateRate: 0, reorderRate: 1 },
      mulberry32(1),
    );
    expect(link.transmit().delays[0]).toBeCloseTo(100 * (1 + REORDER_EXTRA_DELAYS));
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
