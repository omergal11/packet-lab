import type { Frame, Timeline } from '../engine/replay.js';

// Plays a finished Timeline back on screen. The player owns only a virtual clock;
// what to draw at any time comes from timeline.frameAt(), so play, pause and step
// can never get out of sync with the simulation.
export class Player {
  private time = 0;
  private playing = false;
  private lastTimestamp: number | null = null;
  // Virtual milliseconds per real millisecond. 0.25 means a 200 ms trip takes 0.8 s.
  speed = 0.25;

  constructor(
    private timeline: Timeline,
    private readonly onFrame: (frame: Frame, playing: boolean) => void,
  ) {
    this.emit();
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  // Swap in a new run (after a setting changes) and rewind to the start.
  load(timeline: Timeline): void {
    this.timeline = timeline;
    this.time = 0;
    this.pause();
  }

  play(): void {
    if (this.playing) return;
    if (this.time >= this.timeline.endTime) this.time = 0; // replay from the start
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

  // Jump to the next logged event, so each click shows exactly one thing happening.
  step(): void {
    this.playing = false;
    this.time = this.timeline.nextEventTime(this.time);
    this.emit();
  }

  // Arrow function so it keeps `this` when passed to requestAnimationFrame.
  private readonly tick = (timestamp: number): void => {
    if (!this.playing) return;
    if (this.lastTimestamp !== null) {
      // Cap the step so returning to a background tab does not skip the whole run.
      const realMs = Math.min(timestamp - this.lastTimestamp, 100);
      this.time = Math.min(this.time + realMs * this.speed, this.timeline.endTime);
    }
    this.lastTimestamp = timestamp;
    if (this.time >= this.timeline.endTime) this.playing = false;
    this.emit();
    if (this.playing) requestAnimationFrame(this.tick);
  };

  private emit(): void {
    this.onFrame(this.timeline.frameAt(this.time), this.playing);
  }
}
