import type { LogEntry } from './packet.js';

export interface Metrics {
  delivered: number; // unique packets that reached the application layer
  totalTransmissions: number; // DATA sends + retransmissions (link duplicates are not counted)
  efficiency: number; // delivered / totalTransmissions  (0 when nothing was sent)
  // When the run ended: the sender has an ACK for every packet. We measure to here, not
  // to the last delivery, because until the last ACK arrives the sender cannot know the
  // transfer is done — and slow ACK recovery (a bad timeout) should cost time.
  totalVirtualTimeMs: number;
}

// Derive metrics purely from the event log so this function is easy to unit-test.
export function computeMetrics(log: readonly LogEntry[]): Metrics {
  let delivered = 0;
  let totalTransmissions = 0;

  for (const entry of log) {
    if (entry.kind === 'deliver') {
      delivered++;
    }
    // Only count what the sender chose to put on the wire. ACKs are the receiver's cost,
    // and link duplicates are the network's doing, so neither should hurt the score.
    const senderTransmission = entry.kind === 'send' || entry.kind === 'retransmit';
    if (senderTransmission && entry.packet.kind === 'DATA') {
      totalTransmissions++;
    }
  }

  const totalVirtualTimeMs = log.length > 0 ? log[log.length - 1]!.time : 0;

  return {
    delivered,
    totalTransmissions,
    efficiency: totalTransmissions === 0 ? 0 : delivered / totalTransmissions,
    totalVirtualTimeMs,
  };
}
