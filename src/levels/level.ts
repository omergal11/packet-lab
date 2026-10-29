import type { ProtocolId } from '../engine/protocols/registry.js';
import {
  findBaseline,
  type Grid,
  type Scenario,
  type ScoredRun,
  type Settings,
} from '../engine/scoring.js';

interface Range {
  min: number;
  max: number;
  step: number;
}

// A level is plain data: the scenario to simulate, what the player may change,
// and where the sliders start.
export interface Level {
  id: number;
  name: string;
  goal: string;
  intro: string; // one paragraph: the concept, and what to try
  // Protocols run side by side on the same scenario with the same settings.
  protocols: ProtocolId[];
  scenario: Scenario;
  windowSize: Range;
  timeoutMs: Range;
  initial: Settings;
}

// The baseline searches exactly the settings the player can choose,
// so "beat the baseline" is always a fair challenge.
export function gridFor(level: Level): Grid {
  return { windowSizes: rangeValues(level.windowSize), timeoutsMs: rangeValues(level.timeoutMs) };
}

// The best run any protocol in the level achieves on the grid.
export function levelBaseline(level: Level): ScoredRun {
  const grid = gridFor(level);
  const bests = level.protocols.map((p) => findBaseline(level.scenario, grid, p));
  return bests.reduce((best, run) => (run.score > best.score ? run : best));
}

function rangeValues({ min, max, step }: Range): number[] {
  const values: number[] = [];
  for (let v = min; v <= max; v += step) values.push(v);
  return values;
}
