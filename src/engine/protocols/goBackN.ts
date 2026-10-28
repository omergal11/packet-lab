import type { EndpointCtx, ReceiverDef, SenderDef, TimerHandle } from '../simulation.js';
import type { Packet } from '../packet.js';
import type { SlidingWindowConfig } from './slidingWindow.js';

// Go-Back-N sender.
// Like Selective Repeat it keeps up to windowSize packets in flight, but it has a single
// timer for the oldest unacknowledged packet. On timeout it resends the whole window,
// because the receiver throws away everything after a gap. That makes the receiver
// trivial (no buffer) at the cost of resending packets that may have arrived fine.
export class GoBackNSender implements SenderDef {
  private base = 0; // oldest unacknowledged seq
  private nextSeq = 0; // next seq that has never been sent
  private timer: TimerHandle | null = null;

  constructor(
    private readonly ctx: EndpointCtx,
    private readonly config: SlidingWindowConfig,
    private readonly onDone: () => void,
  ) {}

  start(): void {
    this.fillWindow();
  }

  onAck(ack: Packet): void {
    // Cumulative ACK: "I have everything up to and including ack.seq".
    // Anything older than the window is stale news.
    if (ack.seq < this.base) return;

    this.base = ack.seq + 1;
    this.stopTimer();
    if (this.base >= this.config.numPackets) {
      this.onDone();
      return;
    }
    // The timer always tracks the oldest unacknowledged packet, which just changed.
    if (this.base < this.nextSeq) this.startTimer();
    this.fillWindow();
  }

  private fillWindow(): void {
    const windowEnd = Math.min(this.base + this.config.windowSize, this.config.numPackets);
    while (this.nextSeq < windowEnd) {
      this.ctx.send(this.packet(this.nextSeq));
      this.nextSeq++;
      if (this.timer === null) this.startTimer();
    }
  }

  private startTimer(): void {
    this.timer = this.ctx.setTimer(this.config.timeoutMs, () => {
      this.ctx.log('timeout', this.packet(this.base));
      // Go back to the oldest unacknowledged packet and resend everything after it.
      for (let seq = this.base; seq < this.nextSeq; seq++) {
        this.ctx.send(this.packet(seq), 'retransmit');
      }
      this.startTimer();
    });
  }

  private stopTimer(): void {
    if (this.timer !== null) this.ctx.cancelTimer(this.timer);
    this.timer = null;
  }

  private packet(seq: number): Packet {
    return { kind: 'DATA', seq, payload: `data-${seq}` };
  }
}

// Go-Back-N receiver: accepts only the next expected packet and discards everything
// else, so it never needs a buffer. Every arrival triggers a cumulative ACK for the
// last in-order packet, which tells the sender where to go back to.
export class GoBackNReceiver implements ReceiverDef {
  private expectedSeq = 0;

  constructor(private readonly ctx: EndpointCtx) {}

  onData(pkt: Packet): void {
    if (pkt.seq === this.expectedSeq) {
      this.ctx.log('deliver', pkt);
      this.expectedSeq++;
    } else if (pkt.seq < this.expectedSeq) {
      this.ctx.log('duplicate-dropped', pkt);
    } else {
      this.ctx.log('out-of-order-dropped', pkt);
    }

    // Nothing has arrived in order yet, so there is nothing to acknowledge.
    if (this.expectedSeq > 0) this.ctx.send({ kind: 'ACK', seq: this.expectedSeq - 1 });
  }
}
