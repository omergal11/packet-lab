import { describe, expect, it } from 'vitest';
import { findBaseline, runProtocol, runSelectiveRepeat, score } from '../src/engine/scoring.js';
import { gridFor, levelBaseline } from '../src/levels/level.js';
import { level2 } from '../src/levels/level2.js';
import { level1 } from '../src/levels/level1.js';
import { expectReliableDelivery } from './helpers.js';

describe('score', () => {
  it('is goodput (packets per second) times efficiency', () => {
    const metrics = {
      delivered: 10,
      totalTransmissions: 20,
      efficiency: 0.5,
      totalVirtualTimeMs: 2000,
    };
    expect(score(metrics)).toBeCloseTo(5 * 0.5);
  });

  it('is 0 for an empty run', () => {
    expect(score({ delivered: 0, efficiency: 0, totalVirtualTimeMs: 0 })).toBe(0);
  });
});

describe('Level 1 baseline', () => {
  const grid = gridFor(level1);
  const baseline = findBaseline(level1.scenario, grid);

  it('grid covers exactly the slider ranges', () => {
    expect(grid.windowSizes).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
    expect(grid.timeoutsMs[0]).toBe(100);
    expect(grid.timeoutsMs.at(-1)).toBe(2000);
  });

  it('delivers every packet', () => {
    expectReliableDelivery(baseline.log, level1.scenario.numPackets);
  });

  it('is at least as good as every setting on the grid', () => {
    for (const windowSize of grid.windowSizes) {
      for (const timeoutMs of grid.timeoutsMs) {
        const run = runSelectiveRepeat(level1.scenario, { windowSize, timeoutMs });
        expect(run.score).toBeLessThanOrEqual(baseline.score);
      }
    }
  });

  it('beats the starting settings, so the level has something to teach', () => {
    const start = runSelectiveRepeat(level1.scenario, level1.initial);
    expect(baseline.score).toBeGreaterThan(start.score * 2);
  });

  it('is deterministic', () => {
    expect(findBaseline(level1.scenario, grid).settings).toEqual(baseline.settings);
  });
});

describe('runSelectiveRepeat — unfinished runs', () => {
  it('scores 0 when every packet is lost', () => {
    const scenario = {
      ...level1.scenario,
      linkConfig: { ...level1.scenario.linkConfig, lossRate: 1 },
    };
    const run = runSelectiveRepeat(scenario, { windowSize: 16, timeoutMs: 100 });
    expect(run.completed).toBe(false);
    expect(run.score).toBe(0);
  });
});

describe('runProtocol', () => {
  it('runs both protocols reliably on the same scenario', () => {
    for (const protocol of ['selective-repeat', 'go-back-n'] as const) {
      const run = runProtocol(protocol, level1.scenario, { windowSize: 8, timeoutMs: 600 });
      expect(run.protocol).toBe(protocol);
      expect(run.completed).toBe(true);
      expectReliableDelivery(run.log, level1.scenario.numPackets);
    }
  });

  it('Go-Back-N spends more transmissions than Selective Repeat on a lossy link', () => {
    let gbn = 0;
    let sr = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const scenario = { ...level1.scenario, seed };
      const settings = { windowSize: 8, timeoutMs: 600 };
      gbn += runProtocol('go-back-n', scenario, settings).metrics.totalTransmissions;
      sr += runProtocol('selective-repeat', scenario, settings).metrics.totalTransmissions;
    }
    expect(gbn).toBeGreaterThan(sr * 1.2);
  });
});

describe('Level 2', () => {
  it('Go-Back-N wastes far more transmissions than Selective Repeat at the starting settings', () => {
    const [gbn, sr] = level2.protocols.map((p) => runProtocol(p, level2.scenario, level2.initial));
    expect(gbn!.protocol).toBe('go-back-n');
    expect(gbn!.metrics.wastedArrivals).toBeGreaterThan(sr!.metrics.wastedArrivals * 3);
    expect(gbn!.metrics.totalTransmissions).toBeGreaterThan(sr!.metrics.totalTransmissions * 2);
  });

  it('the level baseline is the best run of any protocol on the grid', () => {
    const baseline = levelBaseline(level2);
    for (const p of level2.protocols) {
      expect(findBaseline(level2.scenario, gridFor(level2), p).score).toBeLessThanOrEqual(
        baseline.score,
      );
    }
  });

  it('a small window helps Go-Back-N but hurts Selective Repeat', () => {
    const at = (p: 'go-back-n' | 'selective-repeat', windowSize: number) =>
      runProtocol(p, level2.scenario, { windowSize, timeoutMs: 600 }).score;
    expect(at('go-back-n', 3)).toBeGreaterThan(at('go-back-n', 12));
    expect(at('selective-repeat', 3)).toBeLessThan(at('selective-repeat', 12));
  });
});
