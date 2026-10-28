import { describe, expect, it } from 'vitest';
import { computeMetrics } from '../src/engine/metrics.js';
import type { LogEntry, LogKind, Packet } from '../src/engine/packet.js';

// Tiny builders so each test log reads like a story.
const data = (seq: number): Packet => ({ kind: 'DATA', seq });
const ack = (seq: number): Packet => ({ kind: 'ACK', seq });
const at = (time: number, kind: LogKind, packet: Packet, wireId?: number): LogEntry =>
  wireId === undefined ? { time, kind, packet } : { time, kind, packet, wireId };

describe('computeMetrics', () => {
  it('returns zeros for an empty log', () => {
    expect(computeMetrics([])).toEqual({
      delivered: 0,
      totalTransmissions: 0,
      efficiency: 0,
      totalVirtualTimeMs: 0,
    });
  });

  it('one clean round trip: efficiency 1, time = when the ACK arrives', () => {
    const log = [
      at(0, 'send', data(0), 0),
      at(100, 'data-received', data(0), 0),
      at(100, 'deliver', data(0)),
      at(100, 'send', ack(0), 1),
      at(200, 'ack-received', ack(0), 1),
    ];
    expect(computeMetrics(log)).toEqual({
      delivered: 1,
      totalTransmissions: 1,
      efficiency: 1,
      totalVirtualTimeMs: 200,
    });
  });

  it('a retransmission after a loss halves efficiency', () => {
    const log = [
      at(0, 'send', data(0), 0),
      at(50, 'drop', data(0), 0),
      at(500, 'timeout', data(0)),
      at(500, 'retransmit', data(0), 1),
      at(600, 'data-received', data(0), 1),
      at(600, 'deliver', data(0)),
      at(600, 'send', ack(0), 2),
      at(700, 'ack-received', ack(0), 2),
    ];
    const m = computeMetrics(log);
    expect(m.totalTransmissions).toBe(2);
    expect(m.efficiency).toBe(0.5);
    expect(m.totalVirtualTimeMs).toBe(700);
  });

  it('ACK sends and link duplicates do not count as sender transmissions', () => {
    const log = [
      at(0, 'send', data(0), 0),
      at(0, 'link-duplicate', data(0), 1),
      at(100, 'data-received', data(0), 0),
      at(100, 'deliver', data(0)),
      at(100, 'send', ack(0), 2),
      at(110, 'data-received', data(0), 1),
      at(110, 'duplicate-dropped', data(0)),
      at(110, 'send', ack(0), 3),
      at(200, 'ack-received', ack(0), 2),
    ];
    const m = computeMetrics(log);
    expect(m.delivered).toBe(1);
    expect(m.totalTransmissions).toBe(1);
    expect(m.efficiency).toBe(1);
  });

  it('total time is the last entry, even if it is not a delivery', () => {
    const log = [
      at(0, 'send', data(0), 0),
      at(100, 'deliver', data(0)),
      at(150, 'drop', ack(0), 1),
      at(600, 'timeout', data(0)),
    ];
    expect(computeMetrics(log).totalVirtualTimeMs).toBe(600);
  });
});
