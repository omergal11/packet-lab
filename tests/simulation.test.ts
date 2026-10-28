import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/engine/simulation.js';
import { StopAndWaitReceiver, StopAndWaitSender } from '../src/engine/protocols/stopAndWait.js';
import type { LinkConfig } from '../src/engine/link.js';

// Convenience wrapper so tests stay readable
function runSAW(
  seed: number,
  numPackets: number,
  linkCfg: Partial<LinkConfig> = {},
  timeoutMs = 600,
) {
  const linkConfig: LinkConfig = {
    lossRate: 0,
    baseDelayMs: 100,
    jitterMs: 0,
    duplicateRate: 0,
    reorderRate: 0,
    ...linkCfg,
  };
  const sim = new Simulation({ seed, numPackets, timeoutMs, linkConfig });
  return sim.run(
    (ctx, onDone) => new StopAndWaitSender(ctx, numPackets, timeoutMs, onDone),
    (ctx) => new StopAndWaitReceiver(ctx),
  );
}

describe('Simulation — determinism', () => {
  it('same seed produces an identical event log', () => {
    const r1 = runSAW(42, 5, { lossRate: 0.2 });
    const r2 = runSAW(42, 5, { lossRate: 0.2 });
    expect(r1.log).toEqual(r2.log);
  });

  it('different seeds produce different logs when lossRate > 0', () => {
    const r1 = runSAW(1, 5, { lossRate: 0.3 });
    const r2 = runSAW(2, 5, { lossRate: 0.3 });
    expect(r1.log).not.toEqual(r2.log);
  });
});

describe('Simulation — reliability with lossRate=0', () => {
  it('delivers all packets', () => {
    const { log } = runSAW(1, 6);
    const deliveries = log.filter((e) => e.kind === 'deliver');
    expect(deliveries).toHaveLength(6);
  });

  it('delivers packets in order', () => {
    const { log } = runSAW(1, 6);
    const seqs = log.filter((e) => e.kind === 'deliver').map((e) => e.packet.seq);
    expect(seqs).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('delivers each packet exactly once', () => {
    const { log } = runSAW(1, 6);
    const seqs = log.filter((e) => e.kind === 'deliver').map((e) => e.packet.seq);
    expect(new Set(seqs).size).toBe(6);
  });

  it('produces no retransmissions', () => {
    const { log } = runSAW(1, 4);
    expect(log.filter((e) => e.kind === 'retransmit')).toHaveLength(0);
  });
});

describe('Simulation — reliability with lossRate=0.3', () => {
  it('still delivers all packets in order, exactly once', () => {
    const { log } = runSAW(7, 5, { lossRate: 0.3 });
    const deliveries = log.filter((e) => e.kind === 'deliver');
    expect(deliveries).toHaveLength(5);
    expect(deliveries.map((e) => e.packet.seq)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('Simulation — duplicate handling', () => {
  it('duplicated packets are never delivered twice', () => {
    // duplicateRate=1 forces every packet to be duplicated
    const { log } = runSAW(1, 4, { duplicateRate: 1 });
    const deliveries = log.filter((e) => e.kind === 'deliver');
    expect(deliveries).toHaveLength(4);
    expect(deliveries.map((e) => e.packet.seq)).toEqual([0, 1, 2, 3]);
  });

  it('duplicate-dropped events appear when duplicates arrive', () => {
    const { log } = runSAW(1, 4, { duplicateRate: 1 });
    expect(log.filter((e) => e.kind === 'duplicate-dropped').length).toBeGreaterThan(0);
  });
});

describe('Simulation — event ordering', () => {
  it('log entries are in non-decreasing virtual time order', () => {
    const { log } = runSAW(42, 6, { lossRate: 0.15, jitterMs: 30 });
    for (let i = 1; i < log.length; i++) {
      expect(log[i]!.time).toBeGreaterThanOrEqual(log[i - 1]!.time);
    }
  });
});

describe('Simulation — metrics', () => {
  it('efficiency is 1.0 with no loss and no duplication', () => {
    const { metrics } = runSAW(1, 4);
    expect(metrics.efficiency).toBeCloseTo(1.0);
  });

  it('efficiency drops below 1.0 when retransmissions occur', () => {
    const { metrics } = runSAW(3, 6, { lossRate: 0.4 });
    expect(metrics.efficiency).toBeLessThan(1.0);
  });

  it('totalVirtualTimeMs > 0 after a run', () => {
    const { metrics } = runSAW(1, 3);
    expect(metrics.totalVirtualTimeMs).toBeGreaterThan(0);
  });
});
