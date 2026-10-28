import type { EndpointCtx, ReceiverDef, SenderDef, TimerHandle } from '../simulation.js';
import type { Packet } from '../packet.js';

export interface SlidingWindowConfig {
  numPackets: number;
  windowSize: number; // max packets sent but not yet acknowledged
  timeoutMs: number;
}

// Selective Repeat sender.
// Keeps up to windowSize unacknowledged packets in flight, each with its own timer,
// so a single loss only costs one retransmission (unlike Go-Back-N, which resends
// everything after the lost packet).
//
// Sequence numbers are never reused here, so we avoid the classic SR rule that the
// window must be at most half the sequence-number space. A real protocol with a
// finite seq field would need that rule.
export class SelectiveRepeatSender implements SenderDef {
  private base = 0; // oldest unacknowledged seq — the left edge of the window
  private nextSeq = 0; // next seq that has never been sent
  private readonly ackedAboveBase = new Set<number>(); // ACKed out of order, waiting for base
  private readonly timers = new Map<number, TimerHandle>();

  constructor(
    private readonly ctx: EndpointCtx,
    private readonly config: SlidingWindowConfig,
    private readonly onDone: () => void,
  ) {}

  start(): void {
    this.fillWindow();
  }

  onAck(ack: Packet): void {
    const seq = ack.seq;
    // Ignore ACKs for packets already acknowledged (duplicated or re-sent ACKs).
    if (seq < this.base || seq >= this.nextSeq || this.ackedAboveBase.has(seq)) return;

    const timer = this.timers.get(seq);
    if (timer !== undefined) {
      this.ctx.cancelTimer(timer);
      this.timers.delete(seq);
    }
    this.ackedAboveBase.add(seq);

    // Slide the window past every packet that is now acknowledged in a row.
    while (this.ackedAboveBase.has(this.base)) {
      this.ackedAboveBase.delete(this.base);
      this.base++;
    }

    if (this.base >= this.config.numPackets) {
      this.onDone();
      return;
    }
    this.fillWindow();
  }

  private fillWindow(): void {
    const windowEnd = Math.min(this.base + this.config.windowSize, this.config.numPackets);
    while (this.nextSeq < windowEnd) {
      const pkt: Packet = { kind: 'DATA', seq: this.nextSeq, payload: `data-${this.nextSeq}` };
      this.ctx.send(pkt);
      this.armTimer(pkt);
      this.nextSeq++;
    }
  }

  // One timer per packet: when it fires, only that packet is resent.
  private armTimer(pkt: Packet): void {
    const handle = this.ctx.setTimer(this.config.timeoutMs, () => {
      this.ctx.log('timeout', pkt);
      this.ctx.send(pkt, 'retransmit');
      this.armTimer(pkt);
    });
    this.timers.set(pkt.seq, handle);
  }
}

// Selective Repeat receiver.
// Accepts any packet inside its window, buffers out-of-order ones, ACKs each one
// individually, and hands data to the application strictly in order.
export class SelectiveRepeatReceiver implements ReceiverDef {
  private base = 0; // next seq the application is waiting for
  private readonly buffer = new Map<number, Packet>();

  constructor(
    private readonly ctx: EndpointCtx,
    private readonly windowSize: number,
  ) {}

  onData(pkt: Packet): void {
    const seq = pkt.seq;

    if (seq >= this.base + this.windowSize) {
      // The sender can never legally get this far ahead, so this cannot happen with
      // our sender. Dropping it without an ACK is the safe choice.
      return;
    }

    if (seq < this.base || this.buffer.has(seq)) {
      // Already have it. The sender is resending because our ACK was lost or late,
      // so ACK again — otherwise the sender would retransmit forever.
      this.ctx.log('duplicate-dropped', pkt);
      this.sendAck(seq);
      return;
    }

    this.buffer.set(seq, pkt);
    if (seq !== this.base) this.ctx.log('buffer', pkt);

    // Deliver everything that is now contiguous from the window's left edge.
    let next = this.buffer.get(this.base);
    while (next !== undefined) {
      this.ctx.log('deliver', next);
      this.buffer.delete(this.base);
      this.base++;
      next = this.buffer.get(this.base);
    }

    this.sendAck(seq);
  }

  private sendAck(seq: number): void {
    this.ctx.send({ kind: 'ACK', seq });
  }
}
