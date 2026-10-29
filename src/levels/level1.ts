import type { Level } from './level.js';

export const level1: Level = {
  id: 1,
  name: 'Level 1 — Fill the pipe',
  goal: 'Deliver 16 packets over a slow, lossy link. Tune the window and timeout to match the baseline.',
  intro:
    'A packet takes about 200 ms to cross this link, and its ACK takes as long to come back. ' +
    'With a window of 1 the sender sends one packet and then sits idle for the whole round ' +
    'trip — that is Stop-and-Wait. A bigger window lets it keep several packets on the wire at ' +
    'once. The timeout decides how long the sender waits before resending: too short and it ' +
    'resends packets that were only slow, too long and every real loss costs extra time. ' +
    'Try raising the window first, then bring the timeout down until retransmissions start to be wasted.',
  protocols: ['selective-repeat'],
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
