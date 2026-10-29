import type { Level } from './level.js';

export const level2: Level = {
  id: 2,
  name: 'Level 2 — Go-Back-N vs Selective Repeat',
  goal: 'Run both protocols on the same messy link with the same settings, and see why one wastes so much.',
  intro:
    'Both protocols keep a window of packets in flight, but they recover from a loss differently. ' +
    'Go-Back-N keeps the receiver simple: it only accepts the next packet in order and throws ' +
    'away everything after a gap, so on a timeout the sender resends the whole window. ' +
    'Selective Repeat buffers out-of-order packets and resends only the one that was lost. ' +
    'This link also reorders some packets, which Go-Back-N treats like a loss. ' +
    'Start with a window of 8, then try small windows: which protocol gets better, and which gets worse?',
  protocols: ['go-back-n', 'selective-repeat'],
  scenario: {
    seed: 2,
    numPackets: 16,
    linkConfig: {
      lossRate: 0.1,
      baseDelayMs: 150,
      jitterMs: 60,
      duplicateRate: 0.05,
      reorderRate: 0.1,
    },
  },
  windowSize: { min: 1, max: 16, step: 1 },
  timeoutMs: { min: 100, max: 2000, step: 50 },
  initial: { windowSize: 8, timeoutMs: 600 },
};
