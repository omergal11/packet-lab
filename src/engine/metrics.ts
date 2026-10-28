import type { LogEntry } from './packet.js';

export interface Metrics {
  delivered: number; // unique packets that reached the application layer
  totalTransmissions: number; // DATA sends + retransmissions (link duplicates are not counted)
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
    // Only count what the sender chose to put on the wire. ACKs are the receiver's cost,
    // and link duplicates are the network's doing, so neither should hurt the score.
    const senderTransmission = entry.kind === 'send' || entry.kind === 'retransmit';
    if (senderTransmission && entry.packet.kind === 'DATA') {
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
