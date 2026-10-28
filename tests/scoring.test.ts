import { describe, expect, it } from 'vitest';
import { findBaseline, runSelectiveRepeat, score } from '../src/engine/scoring.js';
import { gridFor } from '../src/levels/level.js';
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
    expect(
      score({ delivered: 0, totalTransmissions: 0, efficiency: 0, totalVirtualTimeMs: 0 }),
    ).toBe(0);
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
