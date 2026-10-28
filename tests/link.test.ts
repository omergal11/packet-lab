import { describe, expect, it } from 'vitest';
import { Link } from '../src/engine/link.js';
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
