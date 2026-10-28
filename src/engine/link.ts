export interface LinkConfig {
  lossRate: number; // 0–1: probability a packet is dropped entirely
  baseDelayMs: number; // fixed one-way propagation delay in ms
  jitterMs: number; // maximum extra random delay added on top of base
  duplicateRate: number; // 0–1: probability an extra copy is queued behind the original
  reorderRate: number; // 0–1: probability a copy is held back so later packets overtake it
}

// Where along the wire a lost packet disappears, as a fraction of its base delay.
// The link decides the loss at send time, but the log records it mid-lane so the
// replay can show the packet vanishing on the way instead of never leaving.
export const LOSS_POINT = 0.5;

// A reordered packet is held back by this many base delays, which is enough for the
// packets sent right after it to overtake it.
export const REORDER_EXTRA_DELAYS = 2;

export interface TransmitResult {
  dropped: boolean;
  // One entry per copy that will be delivered. Normally 1; 2 if duplicated; 0 if dropped.
  delays: number[];
}

// Link models a one-directional lossy channel.
// The caller passes the random source for each transmission. The Simulation gives
// every (direction, seq, attempt) its own source, so a packet's fate does not depend
// on what else was sent before it.
export class Link {
  constructor(private readonly config: LinkConfig) {}

  transmit(rng: () => number): TransmitResult {
    if (rng() < this.config.lossRate) {
      return { dropped: true, delays: [] };
    }

    const delays: number[] = [this.computeDelay(rng)];

    // Duplicate: queue a second copy with its own independent delay.
    if (rng() < this.config.duplicateRate) {
      delays.push(this.computeDelay(rng));
    }

    return { dropped: false, delays };
  }

  private computeDelay(rng: () => number): number {
    const jitter = rng() * this.config.jitterMs;
    // Jitter alone can reorder packets sent close together; reorderRate makes it
    // happen on purpose, independent of how far apart the packets were sent.
    const reorderExtra =
      rng() < this.config.reorderRate ? this.config.baseDelayMs * REORDER_EXTRA_DELAYS : 0;
    return this.config.baseDelayMs + jitter + reorderExtra;
  }
}
