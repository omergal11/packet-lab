import { expect } from 'vitest';
import type { LinkConfig } from '../src/engine/link.js';
import type { LogEntry } from '../src/engine/packet.js';

// A perfect link, with any field overridable. Tests start clean and add only the
// impairments they care about.
export function linkConfig(overrides: Partial<LinkConfig> = {}): LinkConfig {
  return {
    lossRate: 0,
    baseDelayMs: 100,
    jitterMs: 0,
    duplicateRate: 0,
    reorderRate: 0,
    ...overrides,
  };
}

// Every impairment switched on at once — the hardest setting for a protocol.
export const NOISY_LINK: Partial<LinkConfig> = {
  lossRate: 0.3,
  jitterMs: 80,
  duplicateRate: 0.2,
  reorderRate: 0.2,
};

// The core reliability guarantee: the application sees 0..n-1, in order, exactly once.
export function expectReliableDelivery(log: readonly LogEntry[], numPackets: number): void {
  const delivered = log.filter((e) => e.kind === 'deliver').map((e) => e.packet.seq);
  expect(delivered).toEqual(Array.from({ length: numPackets }, (_, i) => i));
}
