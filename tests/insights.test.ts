import { describe, expect, it } from 'vitest';
import { explain, lossLine } from '../src/engine/insights.js';
import { findBaseline, runProtocol, runSelectiveRepeat } from '../src/engine/scoring.js';
import { gridFor } from '../src/levels/level.js';
import { level1 } from '../src/levels/level1.js';
import { linkConfig } from './helpers.js';

const n = level1.scenario.numPackets;
const sr = (windowSize: number, timeoutMs: number) =>
  runSelectiveRepeat(level1.scenario, { windowSize, timeoutMs });

describe('insights — single protocol', () => {
  const baseline = findBaseline(level1.scenario, gridFor(level1));

  it('gives three short lines: losses, a diagnosis, and the baseline comparison', () => {
    const lines = explain([sr(8, 600)], n, baseline);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/lost on the way, which caused \d+ timeouts?\./);
    expect(lines[2]).toMatch(/of the baseline/);
  });

  it('says so when nothing was lost', () => {
    const clean = { ...level1.scenario, linkConfig: linkConfig({ baseDelayMs: 200 }) };
    const run = runSelectiveRepeat(clean, { windowSize: 16, timeoutMs: 1000 });
    expect(lossLine(run)).toBe('No packets were lost on this run.');
  });

  it('blames the window when it was full most of the time', () => {
    expect(explain([sr(1, 600)], n, null)[1]).toMatch(/window was full \d+% of the time/);
  });

  it('blames the timeout when it fires before the round trip completes', () => {
    expect(explain([sr(16, 150)], n, null)[1]).toMatch(/still on the way/);
  });

  it('calls a very long timeout too cautious', () => {
    expect(explain([sr(16, 2000)], n, null)[1]).toMatch(/shorter timeout recovers/);
  });

  it('recognises a run that matches the baseline', () => {
    expect(explain([baseline], n, baseline)[2]).toMatch(/You matched the best setting/);
  });

  it('explains a weak score by the bigger of its two causes', () => {
    // Window 1 is far slower than the baseline but just as efficient.
    expect(explain([sr(1, 600)], n, baseline)[2]).toMatch(/took \d+\.\d× as long/);
    // A tiny timeout floods the link: efficiency is the main problem.
    expect(explain([sr(16, 100)], n, baseline)[2]).toMatch(/transmissions were useful/);
  });
});

describe('insights — unfinished runs', () => {
  it('reports clearly that the run did not finish', () => {
    const dead = { ...level1.scenario, linkConfig: linkConfig({ lossRate: 1 }) };
    const lines = explain([runSelectiveRepeat(dead, { windowSize: 4, timeoutMs: 500 })], n, null);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/did not finish/);
    expect(lines[0]).toMatch(/only 0 of 16 packets/);
  });
});

describe('insights — comparing protocols', () => {
  it('compares send counts and explains Go-Back-N waste', () => {
    const settings = { windowSize: 8, timeoutMs: 600 };
    const runs = [
      runProtocol('go-back-n', level1.scenario, settings),
      runProtocol('selective-repeat', level1.scenario, settings),
    ];
    const lines = explain(runs, n, null);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/Go-Back-N sent \d+, Selective Repeat sent \d+/);
    expect(lines[1]).toMatch(/^Go-Back-N: .*thrown away/);
    expect(lines[2]).toMatch(/^Selective Repeat: /);
  });
});
