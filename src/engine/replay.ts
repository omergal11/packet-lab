import { LOSS_POINT } from './link.js';
import type { LogEntry, Packet } from './packet.js';

// Turns a finished run's event log into frames for animation.
// The simulation runs to completion first; this module only answers
// "what did the network look like at virtual time t?". Keeping it separate means
// the protocol code never knows it is being animated.

export type FlightCause = 'send' | 'retransmit' | 'link-duplicate';
export type FlightOutcome = 'arrived' | 'lost' | 'unfinished';

// One physical copy of a packet crossing one lane (DATA → or ← ACK).
export interface Flight {
  readonly wireId: number;
  readonly packet: Packet;
  readonly cause: FlightCause;
  readonly departTime: number;
  // When the copy arrived or was lost. For 'unfinished' copies (still on the wire when
  // the run ended) this is an estimate based on how long other copies took.
  readonly endTime: number;
  readonly outcome: FlightOutcome;
  // A DATA copy that arrived but was useless: the receiver already had it, or (Go-Back-N)
  // threw it away because it came after a gap. Level 2 highlights these.
  readonly wasted: boolean;
}

// The sender's view of each sequence number.
//   lost: the DATA or its ACK was lost, nothing is on the wire, waiting for a timeout.
//   discarded: the DATA arrived but the receiver threw it away (Go-Back-N after a gap).
export type SeqState = 'not-sent' | 'in-flight' | 'lost' | 'discarded' | 'acked';

export interface FlightView {
  readonly flight: Flight;
  readonly progress: number; // 0 at the sending node, 1 at the receiving node
  readonly lostForMs: number | null; // time since the copy was lost; null while travelling
}

export interface Frame {
  readonly time: number;
  readonly flights: FlightView[];
  readonly seqStates: SeqState[];
  readonly windowBase: number; // left edge of the sender's window (lowest unACKed seq)
  readonly delivered: number; // packets handed to the application so far
}

export interface TimelineOptions {
  numPackets: number;
  windowSize: number;
  lostLingerMs?: number; // how long a lost copy stays visible after it is lost
  // Go-Back-N ACKs are cumulative: ACK n also confirms every seq below n.
  cumulativeAcks?: boolean;
}

export class Timeline {
  readonly flights: Flight[];
  readonly endTime: number;
  private readonly eventTimes: number[];
  private readonly firstSendTime: (number | undefined)[];
  private readonly ackTime: (number | undefined)[];
  private readonly deliverTimes: number[];
  private readonly lostLingerMs: number;

  constructor(
    log: readonly LogEntry[],
    private readonly options: TimelineOptions,
  ) {
    this.lostLingerMs = options.lostLingerMs ?? 250;
    this.endTime = log.length > 0 ? log[log.length - 1]!.time : 0;
    this.eventTimes = [...new Set(log.map((e) => e.time))];
    this.flights = buildFlights(log);

    const n = options.numPackets;
    this.firstSendTime = new Array<number | undefined>(n).fill(undefined);
    this.ackTime = new Array<number | undefined>(n).fill(undefined);
    this.deliverTimes = [];
    for (const e of log) {
      const seq = e.packet.seq;
      if (e.kind === 'send' && e.packet.kind === 'DATA' && this.firstSendTime[seq] === undefined) {
        this.firstSendTime[seq] = e.time;
      }
      if (e.kind === 'ack-received' && this.ackTime[seq] === undefined) {
        this.ackTime[seq] = e.time;
      }
      if (e.kind === 'deliver') this.deliverTimes.push(e.time);
    }

    // With cumulative ACKs, seq s is acknowledged by the first ACK for s or anything above.
    if (options.cumulativeAcks) {
      for (let seq = n - 2; seq >= 0; seq--) {
        const own = this.ackTime[seq];
        const above = this.ackTime[seq + 1];
        if (above !== undefined && (own === undefined || above < own)) this.ackTime[seq] = above;
      }
    }
  }

  // The first event strictly after t, for the "step" control. Returns endTime at the end.
  nextEventTime(t: number): number {
    return this.eventTimes.find((time) => time > t) ?? this.endTime;
  }

  frameAt(t: number): Frame {
    const flights: FlightView[] = [];
    const seqOnWire = new Set<number>();
    let highestAckOnWire = -1;
    // For each seq, the copy (DATA or ACK) whose journey ended most recently.
    const lastEnded = new Map<number, Flight>();

    for (const flight of this.flights) {
      const { seq } = flight.packet;
      if (flight.outcome !== 'unfinished' && flight.endTime <= t) {
        const prev = lastEnded.get(seq);
        if (prev === undefined || flight.endTime >= prev.endTime) lastEnded.set(seq, flight);
      }
      const view = this.viewAt(flight, t);
      if (view === null) continue;
      flights.push(view);
      if (view.lostForMs !== null) continue;
      seqOnWire.add(seq);
      if (flight.packet.kind === 'ACK') highestAckOnWire = Math.max(highestAckOnWire, seq);
    }

    const seqStates: SeqState[] = [];
    let windowBase = this.options.numPackets;
    for (let seq = 0; seq < this.options.numPackets; seq++) {
      const sent = this.firstSendTime[seq];
      const acked = this.ackTime[seq];
      if (acked !== undefined && acked <= t) {
        seqStates.push('acked');
        continue;
      }
      windowBase = Math.min(windowBase, seq);
      const coveredByAck = this.options.cumulativeAcks === true && seq <= highestAckOnWire;
      if (sent === undefined || sent > t) seqStates.push('not-sent');
      else if (seqOnWire.has(seq) || coveredByAck) seqStates.push('in-flight');
      else if (lastEnded.get(seq)?.wasted) seqStates.push('discarded');
      else seqStates.push('lost');
    }

    const delivered = this.deliverTimes.filter((time) => time <= t).length;
    return { time: t, flights, seqStates, windowBase, delivered };
  }

  // Where one copy is drawn at time t, or null if it is not visible.
  private viewAt(flight: Flight, t: number): FlightView | null {
    const { departTime, endTime, outcome } = flight;
    if (t < departTime) return null;

    if (outcome === 'lost') {
      if (t >= endTime + this.lostLingerMs) return null;
      if (t >= endTime) return { flight, progress: LOSS_POINT, lostForMs: t - endTime };
      return { flight, progress: LOSS_POINT * fraction(departTime, endTime, t), lostForMs: null };
    }

    if (t >= endTime) return null;
    return { flight, progress: fraction(departTime, endTime, t), lostForMs: null };
  }
}

function fraction(start: number, end: number, t: number): number {
  return end > start ? (t - start) / (end - start) : 1;
}

// Pairs each departure (send/retransmit/link-duplicate) with its arrival or drop by wireId.
function buildFlights(log: readonly LogEntry[]): Flight[] {
  const open = new Map<number, { packet: Packet; cause: FlightCause; departTime: number }>();
  const flights: Flight[] = [];
  const durations: Record<Packet['kind'], number[]> = { DATA: [], ACK: [] };

  log.forEach((e, i) => {
    if (e.wireId === undefined) return;
    if (e.kind === 'send' || e.kind === 'retransmit' || e.kind === 'link-duplicate') {
      open.set(e.wireId, { packet: e.packet, cause: e.kind, departTime: e.time });
      return;
    }
    const start = open.get(e.wireId);
    if (start === undefined) return;
    open.delete(e.wireId);
    const outcome: FlightOutcome = e.kind === 'drop' ? 'lost' : 'arrived';
    if (outcome === 'arrived') durations[start.packet.kind].push(e.time - start.departTime);
    // The receiver's verdict is logged right after the arrival it reacts to.
    const verdict = e.kind === 'data-received' ? log[i + 1]?.kind : undefined;
    const wasted = verdict === 'duplicate-dropped' || verdict === 'out-of-order-dropped';
    flights.push({ wireId: e.wireId, ...start, endTime: e.time, outcome, wasted });
  });

  // Copies still on the wire when the run stopped: estimate their trip from the others,
  // so they keep moving instead of freezing or vanishing.
  for (const [wireId, start] of open) {
    const estimate = average(durations[start.packet.kind]);
    const endTime = start.departTime + estimate;
    flights.push({ wireId, ...start, endTime, outcome: 'unfinished', wasted: false });
  }

  return flights.sort((a, b) => a.departTime - b.departTime || a.wireId - b.wireId);
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}
