import { describe, expect, it } from 'vitest';
import { hashInts } from '../src/engine/prng.js';
import { Simulation } from '../src/engine/simulation.js';
import { runSelectiveRepeat } from '../src/engine/scoring.js';
import { StopAndWaitReceiver, StopAndWaitSender } from '../src/engine/protocols/stopAndWait.js';
import type { LogEntry } from '../src/engine/packet.js';
import { level1 } from '../src/levels/level1.js';
import { NOISY_LINK, linkConfig } from './helpers.js';

// Reads each DATA transmission's fate out of a log, keyed by "seq:attempt".
// A fate is "lost", or the arrival delay of each copy (more than one if the link duplicated it).
function dataFates(log: readonly LogEntry[]): Map<string, string> {
  const attempts = new Map<number, number>();
  const keyOf = new Map<number, string>(); // wireId → "seq:attempt"
  const sentAt = new Map<number, number>();
  const fates = new Map<string, string[]>();

  log.forEach((e, i) => {
    if (e.packet.kind !== 'DATA' || e.wireId === undefined) return;
    if (e.kind === 'send' || e.kind === 'retransmit') {
      const attempt = attempts.get(e.packet.seq) ?? 0;
      attempts.set(e.packet.seq, attempt + 1);
      const key = `${e.packet.seq}:${attempt}`;
      keyOf.set(e.wireId, key);
      sentAt.set(e.wireId, e.time);
      fates.set(key, []);
      // A link duplicate is logged right after the send it copies.
      const next = log[i + 1];
      if (next?.kind === 'link-duplicate') {
        keyOf.set(next.wireId!, key);
        sentAt.set(next.wireId!, e.time);
      }
    } else if (e.kind === 'drop' || e.kind === 'data-received') {
      const key = keyOf.get(e.wireId);
      if (key === undefined) return;
      const outcome = e.kind === 'drop' ? 'lost' : (e.time - sentAt.get(e.wireId)!).toFixed(6);
      fates.get(key)!.push(outcome);
    }
  });
  return new Map([...fates].map(([k, v]) => [k, [...v].sort().join(',')]));
}

function expectSameFates(a: Map<string, string>, b: Map<string, string>): number {
  let shared = 0;
  for (const [key, fate] of a) {
    if (!b.has(key) || fate === '' || b.get(key) === '') continue; // still in flight at the end
    expect(b.get(key), `fate of ${key}`).toBe(fate);
    shared++;
  }
  return shared;
}

describe('hashInts', () => {
  it('is deterministic and order sensitive', () => {
    expect(hashInts(1, 2, 3)).toBe(hashInts(1, 2, 3));
    expect(hashInts(1, 2, 3)).not.toBe(hashInts(3, 2, 1));
    expect(hashInts(7, 0, 5, 0)).not.toBe(hashInts(7, 0, 5, 1));
  });
});

describe('Per-transmission randomness — the same conditions for every setting', () => {
  it('each (seq, attempt) has the same fate for every window size', () => {
    const scenario = { ...level1.scenario, linkConfig: linkConfig(NOISY_LINK) };
    const reference = dataFates(
      runSelectiveRepeat(scenario, { windowSize: 1, timeoutMs: 600 }).log,
    );
    for (const windowSize of [2, 5, 8, 16]) {
      const fates = dataFates(runSelectiveRepeat(scenario, { windowSize, timeoutMs: 600 }).log);
      // Every packet's first attempt at least is shared, so the comparison is never empty.
      expect(expectSameFates(reference, fates)).toBeGreaterThanOrEqual(16);
    }
  });

  it('each (seq, attempt) has the same fate under a different protocol', () => {
    const link = linkConfig(NOISY_LINK);
    const sr = runSelectiveRepeat(
      { seed: 5, numPackets: 10, linkConfig: link },
      { windowSize: 6, timeoutMs: 600 },
    );
    const saw = new Simulation({ seed: 5, linkConfig: link }).run(
      (ctx, onDone) => new StopAndWaitSender(ctx, 10, 600, onDone),
      (ctx) => new StopAndWaitReceiver(ctx),
    );
    expect(expectSameFates(dataFates(sr.log), dataFates(saw.log))).toBeGreaterThanOrEqual(10);
  });

  it('with a timeout longer than any round trip, every window size needs the same sends', () => {
    // No spurious retransmissions, so the only retransmissions are for real losses —
    // and those are now identical for every window size.
    const sends = level1.scenario.numPackets;
    const counts = new Set<number>();
    for (let windowSize = 1; windowSize <= 16; windowSize++) {
      const run = runSelectiveRepeat(level1.scenario, { windowSize, timeoutMs: 2000 });
      counts.add(run.metrics.totalTransmissions);
    }
    expect(counts.size).toBe(1);
    expect([...counts][0]).toBeGreaterThan(sends); // the level really does lose packets
  });
});

describe('Per-transmission randomness — baselines', () => {
  it('a bigger window never scores worse at the same timeout (no luck left to exploit)', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const scenario = { ...level1.scenario, seed };
      let previous = 0;
      for (let windowSize = 1; windowSize <= 16; windowSize++) {
        const run = runSelectiveRepeat(scenario, { windowSize, timeoutMs: 600 });
        expect(run.score).toBeGreaterThanOrEqual(previous - 1e-9);
        previous = run.score;
      }
    }
  });
});
