import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/engine/simulation.js';
import { StopAndWaitReceiver, StopAndWaitSender } from '../src/engine/protocols/stopAndWait.js';
import type { LinkConfig } from '../src/engine/link.js';
import { NOISY_LINK, expectReliableDelivery, linkConfig } from './helpers.js';

function run(seed: number, numPackets: number, link: Partial<LinkConfig>, timeoutMs = 600) {
  const sim = new Simulation({ seed, numPackets, timeoutMs, linkConfig: linkConfig(link) });
  return sim.run(
    (ctx, onDone) => new StopAndWaitSender(ctx, numPackets, timeoutMs, onDone),
    (ctx) => new StopAndWaitReceiver(ctx),
  );
}

describe('Stop-and-Wait — reliability over many seeds', () => {
  it('delivers every packet in order, exactly once, under 30% loss', () => {
    for (let seed = 1; seed <= 100; seed++) {
      expectReliableDelivery(run(seed, 10, { lossRate: 0.3, jitterMs: 50 }).log, 10);
    }
  });

  it('never delivers a duplicate, even with loss, duplication and reordering together', () => {
    for (let seed = 1; seed <= 100; seed++) {
      expectReliableDelivery(run(seed, 10, NOISY_LINK).log, 10);
    }
  });

  it('a short timeout causes spurious retransmissions but still delivers exactly once', () => {
    // Timeout below the round-trip time: the sender retransmits packets that were not lost.
    const { log } = run(1, 8, { jitterMs: 50 }, 150);
    expect(log.some((e) => e.kind === 'retransmit')).toBe(true);
    expectReliableDelivery(log, 8);
  });
});

describe('Stop-and-Wait — determinism', () => {
  it('same seed gives an identical log with every impairment enabled', () => {
    expect(run(42, 10, NOISY_LINK).log).toEqual(run(42, 10, NOISY_LINK).log);
  });
});
