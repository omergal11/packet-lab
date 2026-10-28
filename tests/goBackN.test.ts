import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/engine/simulation.js';
import { GoBackNReceiver, GoBackNSender } from '../src/engine/protocols/goBackN.js';
import type { LinkConfig } from '../src/engine/link.js';
import type { LogEntry } from '../src/engine/packet.js';
import { NOISY_LINK, expectReliableDelivery, linkConfig } from './helpers.js';

function runGBN(
  seed: number,
  numPackets: number,
  windowSize: number,
  link: Partial<LinkConfig> = {},
  timeoutMs = 600,
) {
  return new Simulation({ seed, linkConfig: linkConfig(link) }).run(
    (ctx, onDone) => new GoBackNSender(ctx, { numPackets, windowSize, timeoutMs }, onDone),
    (ctx) => new GoBackNReceiver(ctx),
  );
}

// Most packets the sender ever had sent but not yet cumulatively acknowledged.
function maxUnackedInFlight(log: readonly LogEntry[]): number {
  let highestSent = -1;
  let highestAcked = -1;
  let max = 0;
  for (const e of log) {
    if (e.kind === 'send' && e.packet.kind === 'DATA')
      highestSent = Math.max(highestSent, e.packet.seq);
    if (e.kind === 'ack-received') highestAcked = Math.max(highestAcked, e.packet.seq);
    max = Math.max(max, highestSent - highestAcked);
  }
  return max;
}

describe('Go-Back-N — reliability', () => {
  it('delivers every packet in order, exactly once, over 100 seeds on a noisy link', () => {
    for (let seed = 1; seed <= 100; seed++) {
      for (const windowSize of [1, 4, 16]) {
        expectReliableDelivery(runGBN(seed, 20, windowSize, NOISY_LINK).log, 20);
      }
    }
  });

  it('never has more than windowSize unacknowledged packets in flight', () => {
    for (let seed = 1; seed <= 100; seed++) {
      for (const windowSize of [1, 3, 8]) {
        expect(
          maxUnackedInFlight(runGBN(seed, 20, windowSize, NOISY_LINK).log),
        ).toBeLessThanOrEqual(windowSize);
      }
    }
  });

  it('uses the whole window on a clean link', () => {
    expect(maxUnackedInFlight(runGBN(1, 20, 8).log)).toBe(8);
  });
});

describe('Go-Back-N — behaviour', () => {
  it('discards packets that arrive after a gap', () => {
    const { log } = runGBN(3, 16, 8, { lossRate: 0.2 });
    expect(log.some((e) => e.kind === 'out-of-order-dropped')).toBe(true);
    expect(log.some((e) => e.kind === 'buffer')).toBe(false); // GBN never buffers
  });

  it('a timeout resends every outstanding packet, oldest first', () => {
    const { log } = runGBN(3, 16, 8, { lossRate: 0.2 });
    const i = log.findIndex((e) => e.kind === 'timeout');
    expect(i).toBeGreaterThanOrEqual(0);
    const base = log[i]!.packet.seq;
    const resent: number[] = [];
    for (let j = i + 1; j < log.length && log[j]!.time === log[i]!.time; j++) {
      if (log[j]!.kind === 'retransmit') resent.push(log[j]!.packet.seq);
    }
    expect(resent[0]).toBe(base);
    expect(resent.length).toBeGreaterThan(1);
    expect(resent).toEqual([...resent].sort((a, b) => a - b));
  });

  it('ACKs are cumulative: the receiver never ACKs a lower seq than before', () => {
    // The receiver only ever ACKs its last in-order packet, so the ACKs it sends never decrease.
    const { log } = runGBN(8, 16, 6, NOISY_LINK);
    const ackSends = log
      .filter((e) => e.kind === 'send' && e.packet.kind === 'ACK')
      .map((e) => e.packet.seq);
    for (let i = 1; i < ackSends.length; i++)
      expect(ackSends[i]).toBeGreaterThanOrEqual(ackSends[i - 1]!);
  });

  it('same seed and settings give an identical event log', () => {
    expect(runGBN(99, 16, 6, NOISY_LINK).log).toEqual(runGBN(99, 16, 6, NOISY_LINK).log);
  });
});
