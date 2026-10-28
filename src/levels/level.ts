import type { Grid, Scenario, Settings } from '../engine/scoring.js';

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

function rangeValues({ min, max, step }: Range): number[] {
  const values: number[] = [];
  for (let v = min; v <= max; v += step) values.push(v);
  return values;
}
