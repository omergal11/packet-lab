import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/engine/simulation.js';
import {
  SelectiveRepeatReceiver,
  SelectiveRepeatSender,
} from '../src/engine/protocols/slidingWindow.js';
import { LOSS_POINT, type LinkConfig } from '../src/engine/link.js';
import { Timeline } from '../src/engine/replay.js';
import type { LogEntry } from '../src/engine/packet.js';
import { NOISY_LINK, linkConfig } from './helpers.js';

function timelineFor(link: Partial<LinkConfig>, windowSize = 4, numPackets = 8, seed = 1) {
  const timeoutMs = 600;
  const sim = new Simulation({ seed, linkConfig: linkConfig(link) });
  const { log } = sim.run(
    (ctx, onDone) => new SelectiveRepeatSender(ctx, { numPackets, windowSize, timeoutMs }, onDone),
    (ctx) => new SelectiveRepeatReceiver(ctx, windowSize),
  );
  return { log, timeline: new Timeline(log, { numPackets, windowSize }) };
}

describe('Timeline — flights', () => {
  it('creates one flight per copy put on the wire', () => {
    const { log, timeline } = timelineFor(NOISY_LINK);
    const departures = log.filter((e) => ['send', 'retransmit', 'link-duplicate'].includes(e.kind));
    expect(timeline.flights).toHaveLength(departures.length);
  });

  it('lost flights end where the log says they were dropped', () => {
    const { log, timeline } = timelineFor({ lossRate: 0.4 });
    const lost = timeline.flights.filter((f) => f.outcome === 'lost');
    expect(lost.length).toBeGreaterThan(0);
    for (const f of lost) {
      const drop = log.find((e: LogEntry) => e.kind === 'drop' && e.wireId === f.wireId);
      expect(drop?.time).toBe(f.endTime);
    }
  });
});

describe('Timeline — frames', () => {
  it('at t=0 the first window is in flight and nothing else is sent', () => {
    const { timeline } = timelineFor({}, 4, 8);
    const frame = timeline.frameAt(0);
    expect(frame.seqStates).toEqual([
      ...Array<string>(4).fill('in-flight'),
      ...Array<string>(4).fill('not-sent'),
    ]);
    expect(frame.windowBase).toBe(0);
    expect(frame.flights.every((v) => v.progress === 0)).toBe(true);
  });

  it('halfway through the first trip, packets are halfway across', () => {
    const { timeline } = timelineFor({}, 4, 8); // base delay 100, no jitter
    const frame = timeline.frameAt(50);
    expect(frame.flights).toHaveLength(4);
    for (const v of frame.flights) expect(v.progress).toBeCloseTo(0.5);
  });

  it('at the end every seq is acked, all packets are delivered, and the window is past the end', () => {
    const { timeline } = timelineFor(NOISY_LINK, 4, 8);
    const frame = timeline.frameAt(timeline.endTime);
    expect(frame.seqStates.every((s) => s === 'acked')).toBe(true);
    expect(frame.delivered).toBe(8);
    expect(frame.windowBase).toBe(8);
  });

  it('a lost copy is shown at the loss point, then disappears', () => {
    const { timeline } = timelineFor({ lossRate: 0.4 });
    const lost = timeline.flights.find((f) => f.outcome === 'lost')!;
    const atLoss = timeline.frameAt(lost.endTime).flights.find((v) => v.flight === lost)!;
    expect(atLoss.progress).toBeCloseTo(LOSS_POINT);
    expect(atLoss.lostForMs).toBe(0);
    const later = timeline.frameAt(lost.endTime + 1000).flights.find((v) => v.flight === lost);
    expect(later).toBeUndefined();
  });

  it("marks a seq as lost when its only copy was dropped, until it's resent", () => {
    const { timeline } = timelineFor({ lossRate: 0.4 });
    const lost = timeline.flights.find((f) => f.outcome === 'lost' && f.packet.kind === 'DATA')!;
    const frame = timeline.frameAt(lost.endTime);
    expect(frame.seqStates[lost.packet.seq]).toBe('lost');
  });

  it('window base never moves backwards', () => {
    const { log, timeline } = timelineFor(NOISY_LINK, 3, 12);
    let prev = 0;
    for (const e of log) {
      const base = timeline.frameAt(e.time).windowBase;
      expect(base).toBeGreaterThanOrEqual(prev);
      prev = base;
    }
  });
});

describe('Timeline — stepping', () => {
  it('nextEventTime walks through every distinct event time and stops at the end', () => {
    const { log, timeline } = timelineFor({ lossRate: 0.2, jitterMs: 20 });
    const distinct = [...new Set(log.map((e) => e.time))];
    const visited: number[] = [0];
    let t = 0;
    while (t < timeline.endTime) {
      t = timeline.nextEventTime(t);
      visited.push(t);
    }
    expect(visited).toEqual(distinct);
    expect(timeline.nextEventTime(timeline.endTime)).toBe(timeline.endTime);
  });
});
