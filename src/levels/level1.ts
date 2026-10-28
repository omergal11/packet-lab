import type { Level } from './level.js';

export const level1: Level = {
  id: 1,
  name: 'Level 1 — Fill the pipe',
  goal: 'Deliver 16 packets over a slow, lossy link. Tune the window and timeout to match the baseline.',
  scenario: {
    seed: 12,
    numPackets: 16,
    linkConfig: {
      lossRate: 0.1,
      baseDelayMs: 200,
      jitterMs: 80,
      duplicateRate: 0,
      reorderRate: 0,
    },
  },
  windowSize: { min: 1, max: 16, step: 1 },
  timeoutMs: { min: 100, max: 2000, step: 50 },
  // Start as Stop-and-Wait with a cautious timeout, so the first run shows the problem.
  initial: { windowSize: 1, timeoutMs: 1500 },
};
