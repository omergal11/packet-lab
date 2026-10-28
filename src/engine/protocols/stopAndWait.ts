import type { EndpointCtx, ReceiverDef, SenderDef, TimerHandle } from '../simulation.js';
import type { Packet } from '../packet.js';

// Stop-and-Wait sender: transmit one DATA packet, wait for its ACK, then move on.
// On timeout, retransmit the same packet and re-arm the timer.
export class StopAndWaitSender implements SenderDef {
  private seq = 0;
  private timer: TimerHandle | null = null;

  constructor(
    private readonly ctx: EndpointCtx,
    private readonly numPackets: number,
    private readonly timeoutMs: number,
    private readonly onDone: () => void,
  ) {}

  start(): void {
    this.transmitCurrent();
  }

  onAck(ack: Packet): void {
    // Ignore stale ACKs that arrive after we've already moved to a later sequence number.
    if (ack.seq !== this.seq) return;

    if (this.timer !== null) {
      this.ctx.cancelTimer(this.timer);
      this.timer = null;
    }

    this.seq++;
    if (this.seq >= this.numPackets) {
      this.onDone();
      return;
    }

    this.transmitCurrent();
  }

  private transmitCurrent(): void {
    const pkt: Packet = { kind: 'DATA', seq: this.seq, payload: `data-${this.seq}` };
    this.ctx.log('send', pkt);
    this.ctx.send(pkt);
    this.armTimeout(pkt);
  }

  private armTimeout(pkt: Packet): void {
    this.timer = this.ctx.setTimer(this.timeoutMs, () => {
      this.ctx.log('timeout', pkt);
      this.ctx.log('retransmit', pkt);
      this.ctx.send(pkt);
      this.armTimeout(pkt); // re-arm for the next potential timeout
    });
  }
}

// Stop-and-Wait receiver: deliver packets in order, exactly once.
// Re-ACK duplicates so the sender can unblock if it timed out.
export class StopAndWaitReceiver implements ReceiverDef {
  private expectedSeq = 0;

  constructor(private readonly ctx: EndpointCtx) {}

  onData(pkt: Packet): void {
    if (pkt.seq < this.expectedSeq) {
      // Duplicate of an already-delivered packet. Re-ACK it so the sender does not
      // keep retransmitting because its ACK was lost.
      const ack: Packet = { kind: 'ACK', seq: pkt.seq };
      this.ctx.log('duplicate-dropped', pkt);
      this.ctx.log('ack', ack);
      this.ctx.send(ack);
      return;
    }

    if (pkt.seq === this.expectedSeq) {
      this.ctx.log('deliver', pkt);
      this.expectedSeq++;
      const ack: Packet = { kind: 'ACK', seq: pkt.seq };
      this.ctx.log('ack', ack);
      this.ctx.send(ack);
    }
    // seq > expectedSeq: packet from the future — Stop-and-Wait never produces this,
    // but we silently ignore it for safety.
  }
}
