import { EventQueue } from './eventQueue.js';
import { Link, type LinkConfig } from './link.js';
import { computeMetrics, type Metrics } from './metrics.js';
import type { LogEntry, LogKind, Packet } from './packet.js';
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
  send(packet: Packet): void;
  setTimer(ms: number, callback: () => void): TimerHandle;
  cancelTimer(handle: TimerHandle): void;
  now(): number;
  log(kind: LogKind, packet: Packet): void;
}

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
    const forwardLink = new Link(this.config.linkConfig, rng); // sender → receiver
    const reverseLink = new Link(this.config.linkConfig, rng); // receiver → sender

    const addLog = (kind: LogKind, packet: Packet): void => {
      entries.push({ time: clock, kind, packet });
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

    const senderCtx: EndpointCtx = {
      send(packet) {
        const result = forwardLink.transmit(packet);
        if (result.dropped) {
          addLog('drop', packet);
          return;
        }
        for (const delay of result.delays) {
          queue.push(clock + delay, () => onReceiverData(packet));
        }
      },
      setTimer: schedule,
      cancelTimer: (h) => {
        h.cancelled = true;
      },
      now: () => clock,
      log: addLog,
    };

    const receiverCtx: EndpointCtx = {
      send(packet) {
        const result = reverseLink.transmit(packet);
        if (result.dropped) {
          addLog('drop', packet);
          return;
        }
        for (const delay of result.delays) {
          queue.push(clock + delay, () => onSenderAck(packet));
        }
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
