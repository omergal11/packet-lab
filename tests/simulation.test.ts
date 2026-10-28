import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/engine/simulation.js';
import { StopAndWaitReceiver, StopAndWaitSender } from '../src/engine/protocols/stopAndWait.js';
import type { LinkConfig } from '../src/engine/link.js';
import type { LogEntry } from '../src/engine/packet.js';

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

describe('Simulation — event log format', () => {
  const noisy = { lossRate: 0.3, duplicateRate: 0.3, jitterMs: 40 };

  it('every wire event carries a wire id; protocol events do not', () => {
    const wireKinds = [
      'send',
      'retransmit',
      'link-duplicate',
      'drop',
      'data-received',
      'ack-received',
    ];
    const { log } = runSAW(5, 8, noisy);
    for (const e of log) {
      expect(e.wireId !== undefined).toBe(wireKinds.includes(e.kind));
    }
  });

  it('send and drop entries cover both DATA and ACK packets', () => {
    const { log } = runSAW(5, 8, noisy);
    const kindsFor = (k: string) =>
      new Set(log.filter((e) => e.kind === k).map((e) => e.packet.kind));
    expect(kindsFor('send')).toEqual(new Set(['DATA', 'ACK']));
    expect(kindsFor('drop')).toEqual(new Set(['DATA', 'ACK']));
    expect(kindsFor('deliver')).toEqual(new Set(['DATA']));
  });

  it('logs ack-received for every ACK copy that reaches the sender', () => {
    const { log } = runSAW(1, 4);
    const acks = log.filter((e) => e.kind === 'ack-received');
    expect(acks.map((e) => e.packet.seq)).toEqual([0, 1, 2, 3]);
    expect(acks.every((e) => e.packet.kind === 'ACK')).toBe(true);
  });

  it('every copy on the wire ends exactly once: received or dropped', () => {
    const { log } = runSAW(9, 8, noisy, 2000); // long timeout: run ends after copies settle
    const started = log.filter((e) => ['send', 'retransmit', 'link-duplicate'].includes(e.kind));
    const ended = log.filter((e) => ['drop', 'data-received', 'ack-received'].includes(e.kind));
    const endedIds = ended.map((e) => e.wireId);
    expect(new Set(endedIds).size).toBe(endedIds.length); // no copy ends twice
    for (const id of endedIds) expect(started.some((s) => s.wireId === id)).toBe(true);
  });
});

describe('Simulation — link duplicates vs retransmissions', () => {
  it('link-made copies are logged as link-duplicate, never as retransmit', () => {
    // No loss and a long timeout: any second copy can only come from the link.
    const { log, metrics } = runSAW(1, 4, { duplicateRate: 1 }, 5000);
    expect(log.filter((e) => e.kind === 'retransmit')).toHaveLength(0);
    // Every DATA and every ACK was duplicated by the link.
    const dataDups = log.filter((e) => e.kind === 'link-duplicate' && e.packet.kind === 'DATA');
    expect(dataDups).toHaveLength(4);
    // Link duplicates are not the sender's fault, so they do not reduce efficiency.
    expect(metrics.efficiency).toBeCloseTo(1.0);
  });

  it('a timeout is always followed by a retransmit of the same seq', () => {
    const { log } = runSAW(3, 6, { lossRate: 0.4 });
    log.forEach((e, i) => {
      if (e.kind !== 'timeout') return;
      const next = log[i + 1]!;
      expect(next.kind).toBe('retransmit');
      expect(next.packet.seq).toBe(e.packet.seq);
    });
  });
});

describe('Simulation — forward and reverse links', () => {
  // Drop rate seen inside a full run, per direction. Counts sender and receiver
  // transmissions of one packet kind and how many of them the link dropped.
  function dropRate(log: LogEntry[], kind: 'DATA' | 'ACK') {
    const ofKind = log.filter((e) => e.packet.kind === kind);
    const sent = ofKind.filter((e) => e.kind === 'send' || e.kind === 'retransmit').length;
    const dropped = ofKind.filter((e) => e.kind === 'drop').length;
    return { sent, rate: dropped / sent };
  }

  it('both directions drop about lossRate of their packets over a long run', () => {
    const { log } = runSAW(42, 15_000, { lossRate: 0.3, jitterMs: 50 });
    for (const kind of ['DATA', 'ACK'] as const) {
      const { sent, rate } = dropRate(log, kind);
      expect(sent).toBeGreaterThanOrEqual(10_000);
      expect(rate).toBeGreaterThan(0.27);
      expect(rate).toBeLessThan(0.33);
    }
  });

  it('reverseLinkConfig configures the ACK direction separately', () => {
    const linkConfig = {
      lossRate: 0,
      baseDelayMs: 100,
      jitterMs: 0,
      duplicateRate: 0,
      reorderRate: 0,
    };
    const sim = new Simulation({
      seed: 1,
      numPackets: 200,
      timeoutMs: 600,
      linkConfig,
      reverseLinkConfig: { ...linkConfig, lossRate: 0.5 },
    });
    const { log } = sim.run(
      (ctx, onDone) => new StopAndWaitSender(ctx, 200, 600, onDone),
      (ctx) => new StopAndWaitReceiver(ctx),
    );
    expect(dropRate(log, 'DATA').rate).toBe(0);
    expect(dropRate(log, 'ACK').rate).toBeGreaterThan(0.3);
  });
});

describe('Simulation — total time', () => {
  it('runs until the last ACK reaches the sender, not just the last delivery', () => {
    const { log, metrics } = runSAW(1, 3); // 100 ms each way, no jitter
    const lastDeliver = log.filter((e) => e.kind === 'deliver').at(-1)!;
    expect(lastDeliver.time).toBeCloseTo(500);
    expect(metrics.totalVirtualTimeMs).toBeCloseTo(600);
    expect(log.at(-1)!.kind).toBe('ack-received');
  });
});
