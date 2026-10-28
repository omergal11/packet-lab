import { EventQueue } from './eventQueue.js';
import { LOSS_POINT, Link, type LinkConfig } from './link.js';
import { computeMetrics, type Metrics } from './metrics.js';
import type { LogEntry, LogKind, Packet, ProtocolLogKind } from './packet.js';
import { mulberry32 } from './prng.js';

export interface RunConfig {
  seed: number;
  numPackets: number;
  timeoutMs: number;
  linkConfig: LinkConfig;
}

export interface SimResult {
  log: LogEntry[];
  metrics: Metrics;
}

// The context given to each endpoint (sender or receiver).
// Protocols interact with the simulation only through this interface —
// they never touch the event queue or the clock directly.
export interface EndpointCtx {
  // The simulation logs the send itself, so protocols only say *why* they are sending.
  send(packet: Packet, reason?: SendReason): void;
  setTimer(ms: number, callback: () => void): TimerHandle;
  cancelTimer(handle: TimerHandle): void;
  now(): number;
  // Protocols may only log their own decisions; wire events are the simulation's job.
  log(kind: ProtocolLogKind, packet: Packet): void;
}

export type SendReason = 'send' | 'retransmit';

// Opaque cancel token. Setting `cancelled = true` prevents the callback from
// firing even if the event is already in the queue (lazy cancellation).
export interface TimerHandle {
  cancelled: boolean;
}

// Interfaces that protocols must implement so the Simulation can drive them
// without knowing which specific protocol is in use.
export interface SenderDef {
  start(): void;
  onAck(packet: Packet): void;
}

export interface ReceiverDef {
  onData(packet: Packet): void;
}

export type SenderFactory = (ctx: EndpointCtx, onDone: () => void) => SenderDef;
export type ReceiverFactory = (ctx: EndpointCtx) => ReceiverDef;

export class Simulation {
  constructor(private readonly config: RunConfig) {}

  run(senderFactory: SenderFactory, receiverFactory: ReceiverFactory): SimResult {
    const rng = mulberry32(this.config.seed);
    const queue = new EventQueue();
    const entries: LogEntry[] = [];
    let clock = 0;

    // Both links share the same RNG instance so all randomness flows from one seed.
    const forwardConfig = this.config.linkConfig;
    const reverseConfig = this.config.linkConfig;
    const forwardLink = new Link(forwardConfig, rng); // sender → receiver
    const reverseLink = new Link(reverseConfig, rng); // receiver → sender

    const addLog = (kind: LogKind, packet: Packet, wireId?: number): void => {
      entries.push(
        wireId === undefined
          ? { time: clock, kind, packet }
          : { time: clock, kind, packet, wireId },
      );
    };

    const schedule = (ms: number, callback: () => void): TimerHandle => {
      const handle: TimerHandle = { cancelled: false };
      // Wrap the callback so that cancelling the handle after the event is already
      // queued still prevents the callback from running.
      queue.push(clock + ms, () => {
        if (!handle.cancelled) callback();
      });
      return handle;
    };

    // Placeholders filled in right after the protocol objects are created.
    // This breaks the circular dependency: the context needs to call the receiver,
    // but the receiver is created using the context.
    let onReceiverData: (p: Packet) => void = () => undefined;
    let onSenderAck: (p: Packet) => void = () => undefined;

    let nextWireId = 0;

    // Puts one packet on a link and schedules what happens to each copy.
    // Shared by both directions so DATA and ACKs are logged in exactly the same way.
    const transmit = (
      link: Link,
      linkConfig: LinkConfig,
      packet: Packet,
      reason: SendReason,
      arrivalKind: 'data-received' | 'ack-received',
      onArrive: (p: Packet) => void,
    ): void => {
      const wireId = nextWireId++;
      addLog(reason, packet, wireId);

      const result = link.transmit(packet);
      if (result.dropped) {
        queue.push(clock + linkConfig.baseDelayMs * LOSS_POINT, () =>
          addLog('drop', packet, wireId),
        );
        return;
      }

      result.delays.forEach((delay, i) => {
        // The first copy is the one the endpoint sent; any extra copy was made by the link.
        const copyId = i === 0 ? wireId : nextWireId++;
        if (i > 0) addLog('link-duplicate', packet, copyId);
        queue.push(clock + delay, () => {
          addLog(arrivalKind, packet, copyId);
          onArrive(packet);
        });
      });
    };

    const senderCtx: EndpointCtx = {
      send(packet, reason = 'send') {
        transmit(forwardLink, forwardConfig, packet, reason, 'data-received', onReceiverData);
      },
      setTimer: schedule,
      cancelTimer: (h) => {
        h.cancelled = true;
      },
      now: () => clock,
      log: addLog,
    };

    const receiverCtx: EndpointCtx = {
      send(packet, reason = 'send') {
        transmit(reverseLink, reverseConfig, packet, reason, 'ack-received', onSenderAck);
      },
      setTimer: schedule,
      cancelTimer: (h) => {
        h.cancelled = true;
      },
      now: () => clock,
      log: addLog,
    };

    let done = false;
    const sender = senderFactory(senderCtx, () => {
      done = true;
    });
    const receiver = receiverFactory(receiverCtx);

    // Wire up the arrival callbacks now that both endpoints exist.
    onReceiverData = (p) => receiver.onData(p);
    onSenderAck = (p) => sender.onAck(p);

    sender.start();

    // Event loop: always process the earliest event, advance the virtual clock to it.
    while (queue.size > 0 && !done) {
      const event = queue.pop()!;
      clock = event.time;
      event.handler();
    }

    return { log: entries, metrics: computeMetrics(entries) };
  }
}
