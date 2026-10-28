import type { LinkConfig } from './link.js';
import type { Metrics } from './metrics.js';
import { SelectiveRepeatReceiver, SelectiveRepeatSender } from './protocols/slidingWindow.js';
import { Simulation, type SimResult } from './simulation.js';

// The fixed part of a challenge: same network, same seed, same amount of data.
export interface Scenario {
  seed: number;
  numPackets: number;
  linkConfig: LinkConfig;
}

// The part the player controls.
export interface Settings {
  windowSize: number;
  timeoutMs: number;
}

export interface ScoredRun extends SimResult {
  settings: Settings;
  score: number;
}

export function runSelectiveRepeat(scenario: Scenario, settings: Settings): ScoredRun {
  const { numPackets } = scenario;
  const { windowSize, timeoutMs } = settings;
  const sim = new Simulation({ seed: scenario.seed, linkConfig: scenario.linkConfig });
  const result = sim.run(
    (ctx, onDone) => new SelectiveRepeatSender(ctx, { numPackets, windowSize, timeoutMs }, onDone),
    (ctx) => new SelectiveRepeatReceiver(ctx, windowSize),
  );
  // A run that hit the safety stop delivered nothing useful in the end: score 0.
  return { ...result, settings, score: result.completed ? score(result.metrics) : 0 };
}

// One number to rank runs: useful packets per virtual second, scaled by efficiency.
// Speed alone would reward flooding the link with retransmissions, and efficiency
// alone would reward a huge timeout, so the score multiplies the two.
export function score(metrics: Metrics): number {
  if (metrics.totalVirtualTimeMs === 0) return 0;
  const goodput = metrics.delivered / (metrics.totalVirtualTimeMs / 1000);
  return goodput * metrics.efficiency;
}

export interface Grid {
  windowSizes: number[];
  timeoutsMs: number[];
}

// The baseline is the best score any setting on the grid achieves for this exact
// scenario. Computing it (instead of hardcoding a number) keeps it correct when the
// level's seed or link changes.
export function findBaseline(scenario: Scenario, grid: Grid): ScoredRun {
  let best: ScoredRun | null = null;
  for (const windowSize of grid.windowSizes) {
    for (const timeoutMs of grid.timeoutsMs) {
      const run = runSelectiveRepeat(scenario, { windowSize, timeoutMs });
      // Strictly greater: on a tie the first (smaller) setting wins, so the result is stable.
      if (best === null || run.score > best.score) best = run;
    }
  }
  if (best === null) throw new Error('findBaseline: the grid is empty');
  return best;
}
