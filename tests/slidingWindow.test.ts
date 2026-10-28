import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/engine/simulation.js';
import {
  SelectiveRepeatReceiver,
  SelectiveRepeatSender,
} from '../src/engine/protocols/slidingWindow.js';
import { StopAndWaitReceiver, StopAndWaitSender } from '../src/engine/protocols/stopAndWait.js';
import type { LinkConfig } from '../src/engine/link.js';
import type { LogEntry } from '../src/engine/packet.js';
import { NOISY_LINK, expectReliableDelivery, linkConfig } from './helpers.js';

interface Params {
  seed: number;
  numPackets: number;
  windowSize: number;
  timeoutMs?: number;
  link?: Partial<LinkConfig>;
}

function runSR({ seed, numPackets, windowSize, timeoutMs = 600, link = {} }: Params) {
  const sim = new Simulation({ seed, linkConfig: linkConfig(link) });
  return sim.run(
    (ctx, onDone) => new SelectiveRepeatSender(ctx, { numPackets, windowSize, timeoutMs }, onDone),
    (ctx) => new SelectiveRepeatReceiver(ctx, windowSize),
  );
}

// Replays the log from the sender's point of view and returns the largest number of
// distinct DATA seqs that were ever sent but not yet acknowledged at the same moment.
function maxUnackedInFlight(log: readonly LogEntry[]): number {
  const unacked = new Set<number>();
  let max = 0;
  for (const e of log) {
    if (e.kind === 'send' && e.packet.kind === 'DATA') unacked.add(e.packet.seq);
    if (e.kind === 'ack-received') unacked.delete(e.packet.seq);
    max = Math.max(max, unacked.size);
  }
  return max;
}

describe('Selective Repeat — reliability', () => {
  it('delivers every packet in order, exactly once, over 100 seeds on a noisy link', () => {
    for (let seed = 1; seed <= 100; seed++) {
      for (const windowSize of [2, 5, 16]) {
        const { log } = runSR({ seed, numPackets: 20, windowSize, link: NOISY_LINK });
        expectReliableDelivery(log, 20);
      }
    }
  });

  it('buffers out-of-order arrivals and still delivers in order', () => {
    const { log } = runSR({
      seed: 4,
      numPackets: 16,
      windowSize: 8,
      link: { jitterMs: 30, reorderRate: 0.3 },
    });
    const arrivals = log.filter((e) => e.kind === 'data-received').map((e) => e.packet.seq);
    expect(arrivals).not.toEqual([...arrivals].sort((a, b) => a - b));
    expect(log.some((e) => e.kind === 'buffer')).toBe(true);
    expectReliableDelivery(log, 16);
  });

  it('re-ACKs duplicates instead of delivering them', () => {
    const { log } = runSR({ seed: 1, numPackets: 8, windowSize: 4, link: { duplicateRate: 1 } });
    const dupDrops = log.filter((e) => e.kind === 'duplicate-dropped');
    expect(dupDrops.length).toBeGreaterThan(0);
    // Each duplicate-dropped is immediately followed by an ACK for that seq.
    for (const d of dupDrops) {
      const i = log.indexOf(d);
      expect(log[i + 1]).toMatchObject({
        kind: 'send',
        packet: { kind: 'ACK', seq: d.packet.seq },
      });
    }
    expectReliableDelivery(log, 8);
  });
});

describe('Selective Repeat — window limit', () => {
  it('never has more than windowSize unacknowledged packets in flight', () => {
    for (let seed = 1; seed <= 100; seed++) {
      for (const windowSize of [1, 3, 8]) {
        const { log } = runSR({ seed, numPackets: 20, windowSize, link: NOISY_LINK });
        expect(maxUnackedInFlight(log)).toBeLessThanOrEqual(windowSize);
      }
    }
  });

  it('actually uses the whole window on a clean link', () => {
    const { log } = runSR({ seed: 1, numPackets: 20, windowSize: 8 });
    expect(maxUnackedInFlight(log)).toBe(8);
  });
});

describe('Selective Repeat — compared to Stop-and-Wait', () => {
  it('windowSize=1 delivers the same data in about the same time as Stop-and-Wait', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const link = { lossRate: 0.2, jitterMs: 40 };
      const sr = runSR({ seed, numPackets: 10, windowSize: 1, link });
      const sim = new Simulation({ seed, linkConfig: linkConfig(link) });
      const saw = sim.run(
        (ctx, onDone) => new StopAndWaitSender(ctx, 10, 600, onDone),
        (ctx) => new StopAndWaitReceiver(ctx),
      );
      const payloads = (log: LogEntry[]) =>
        log.filter((e) => e.kind === 'deliver').map((e) => e.packet.payload);
      expect(payloads(sr.log)).toEqual(payloads(saw.log));
      const ratio = sr.metrics.totalVirtualTimeMs / saw.metrics.totalVirtualTimeMs;
      expect(ratio).toBeGreaterThan(0.95);
      expect(ratio).toBeLessThan(1.05);
    }
  });

  it('a larger window finishes much faster on a high-delay, lossless link', () => {
    const link = { baseDelayMs: 500 };
    const slow = runSR({ seed: 1, numPackets: 16, windowSize: 1, timeoutMs: 2000, link });
    const fast = runSR({ seed: 1, numPackets: 16, windowSize: 8, timeoutMs: 2000, link });
    // 16 round trips vs. about 2 — expect at least a 4x speedup.
    expect(fast.metrics.totalVirtualTimeMs * 4).toBeLessThan(slow.metrics.totalVirtualTimeMs);
  });
});

describe('Selective Repeat — determinism', () => {
  it('same seed and settings give an identical event log', () => {
    const params = { seed: 99, numPackets: 16, windowSize: 6, link: NOISY_LINK };
    expect(runSR(params).log).toEqual(runSR(params).log);
  });
});
