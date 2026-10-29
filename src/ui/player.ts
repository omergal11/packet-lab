import type { Frame, Timeline } from '../engine/replay.js';

// Plays finished Timelines back on screen. The player owns only a virtual clock;
// what to draw at any time comes from timeline.frameAt(), so play, pause and step
// can never get out of sync with the simulation. Several timelines share one clock,
// which keeps side-by-side protocols comparable moment by moment.
export class Player {
  private time = 0;
  private playing = false;
  private lastTimestamp: number | null = null;
  // Virtual milliseconds per real millisecond. 0.25 means a 200 ms trip takes 0.8 s.
  speed = 0.25;

  constructor(
    private timelines: Timeline[],
    private readonly onFrame: (frames: Frame[], playing: boolean) => void,
  ) {
    this.emit();
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  private get endTime(): number {
    return Math.max(0, ...this.timelines.map((t) => t.endTime));
  }

  // Swap in new runs (after a setting changes) and rewind to the start.
  load(timelines: Timeline[]): void {
    this.timelines = timelines;
    this.time = 0;
    this.pause();
  }

  play(): void {
    if (this.playing) return;
    if (this.time >= this.endTime) this.time = 0; // replay from the start
    this.playing = true;
    this.lastTimestamp = null;
    requestAnimationFrame(this.tick);
  }

  pause(): void {
    this.playing = false;
    this.emit();
  }

  restart(): void {
    this.time = 0;
    this.playing = false;
    this.play();
  }

  // Jump to the next logged event in any timeline, so each click shows one thing happening.
  step(): void {
    this.playing = false;
    const next = this.timelines.map((t) => t.nextEventTime(this.time)).filter((t) => t > this.time);
    this.time = next.length > 0 ? Math.min(...next) : this.endTime;
    this.emit();
  }

  // Arrow function so it keeps `this` when passed to requestAnimationFrame.
  private readonly tick = (timestamp: number): void => {
    if (!this.playing) return;
    if (this.lastTimestamp !== null) {
      // Cap the step so returning to a background tab does not skip the whole run.
      const realMs = Math.min(timestamp - this.lastTimestamp, 100);
      this.time = Math.min(this.time + realMs * this.speed, this.endTime);
    }
    this.lastTimestamp = timestamp;
    if (this.time >= this.endTime) this.playing = false;
    this.emit();
    if (this.playing) requestAnimationFrame(this.tick);
  };

  private emit(): void {
    this.onFrame(
      this.timelines.map((t) => t.frameAt(this.time)),
      this.playing,
    );
  }
}
