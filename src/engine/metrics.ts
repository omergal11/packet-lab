import type { LogEntry } from './packet.js';

export interface Metrics {
  delivered: number; // unique packets that reached the application layer
  totalTransmissions: number; // initial sends + retransmissions
  efficiency: number; // delivered / totalTransmissions  (0 when nothing was sent)
  totalVirtualTimeMs: number; // virtual clock value at the final delivery
}

// Derive metrics purely from the event log so this function is easy to unit-test.
export function computeMetrics(log: readonly LogEntry[]): Metrics {
  let delivered = 0;
  let totalTransmissions = 0;
  let totalVirtualTimeMs = 0;

  for (const entry of log) {
    if (entry.kind === 'deliver') {
      delivered++;
      totalVirtualTimeMs = entry.time; // last delivery wins
    }
    if (entry.kind === 'send' || entry.kind === 'retransmit') {
      totalTransmissions++;
    }
  }

  return {
    delivered,
    totalTransmissions,
    efficiency: totalTransmissions === 0 ? 0 : delivered / totalTransmissions,
    totalVirtualTimeMs,
  };
}
