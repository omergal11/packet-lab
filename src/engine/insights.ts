import { PROTOCOLS } from './protocols/registry.js';
import { Timeline } from './replay.js';
import type { ScoredRun } from './scoring.js';

// Plain-language explanations of finished runs, computed only from the log and metrics.
// The game's point is teaching, so after every run it says what happened and why.

// Fraction of the run the window must be full before we call it the main problem.
const BLOCKED_THRESHOLD = 0.3;
// A timeout this many times the slowest round trip counts as "too cautious".
const SLOW_TIMEOUT_FACTOR = 1.5;

// Two or three sentences for one level. With several protocols, the first sentence
// compares them and each protocol then gets its own diagnosis.
export function explain(
  runs: readonly ScoredRun[],
  numPackets: number,
  baseline: ScoredRun | null,
): string[] {
  const unfinished = runs.filter((r) => !r.completed);
  if (unfinished.length > 0) return unfinished.map((r) => notFinished(r, numPackets));

  if (runs.length === 1) {
    const run = runs[0]!;
    const lines = [lossLine(run), diagnosis(run, numPackets)];
    if (baseline !== null) lines.push(baselineLine(run, baseline));
    return lines;
  }
  return [
    compareLine(runs, numPackets),
    ...runs.map((r) => `${PROTOCOLS[r.protocol].name}: ${diagnosis(r, numPackets)}`),
  ];
}

function notFinished(run: ScoredRun, numPackets: number): string {
  const seconds = Math.round(run.metrics.totalVirtualTimeMs / 1000);
  return (
    `${PROTOCOLS[run.protocol].name} did not finish: after ${seconds} s of virtual time only ` +
    `${run.metrics.delivered} of ${numPackets} packets had arrived, so the simulation stopped. ` +
    `When the link loses (almost) everything, no window or timeout can help.`
  );
}

export function lossLine(run: ScoredRun): string {
  const { dataLost, acksLost, timeouts } = run.metrics;
  if (dataLost + acksLost === 0) {
    return timeouts === 0
      ? 'No packets were lost on this run.'
      : `No packets were lost, yet ${plural(timeouts, 'timer')} still fired.`;
  }
  return (
    `${plural(dataLost, 'DATA packet')} and ${plural(acksLost, 'ACK')} were lost on the way, ` +
    `which caused ${plural(timeouts, 'timeout')}.`
  );
}

// The single most useful thing to say about how the settings fit the link.
export function diagnosis(run: ScoredRun, numPackets: number): string {
  const { windowSize, timeoutMs } = run.settings;
  const timeline = new Timeline(run.log, {
    numPackets,
    windowSize,
    cumulativeAcks: PROTOCOLS[run.protocol].cumulativeAcks,
  });
  const maxRtt = slowestRoundTrip(timeline);
  const early = prematureTimeouts(run, timeline);

  if (early > 0) {
    const { timeouts } = run.metrics;
    const which =
      early < timeouts
        ? `${early} of the ${timeouts} timeouts`
        : timeouts === 1
          ? 'The only timeout'
          : `All ${timeouts} timeouts`;
    return (
      `${which} fired while the packet or its ` +
      `ACK was still on the way. The timeout (${timeoutMs} ms) is shorter than a slow round trip ` +
      `(up to about ${maxRtt} ms), so those retransmissions were wasted.`
    );
  }
  const wasted = run.metrics.wastedArrivals;
  if (wasted > 0 && PROTOCOLS[run.protocol].cumulativeAcks) {
    return (
      `${plural(wasted, 'packet')} arrived but ${wasted === 1 ? 'was' : 'were'} thrown away, ` +
      `because ${wasted === 1 ? 'it came after a gap or was' : 'they came after a gap or were'} ` +
      `already there. After each timeout Go-Back-N resends the ` +
      `whole window, even packets that arrived fine.`
    );
  }
  const blocked = windowFullFraction(run, numPackets);
  if (blocked >= BLOCKED_THRESHOLD) {
    return (
      `The window was full ${percent(blocked)} of the time: the sender had more to send but ` +
      `had to wait for ACKs. A bigger window keeps the link busy.`
    );
  }
  if (run.metrics.timeouts > 0 && timeoutMs > maxRtt * SLOW_TIMEOUT_FACTOR) {
    return (
      `Every timeout was needed, but the sender waited ${timeoutMs} ms each time while a round ` +
      `trip takes at most about ${maxRtt} ms. A shorter timeout recovers from losses sooner.`
    );
  }
  // No single cause stands out, so report the two numbers that matter and let the player judge.
  return (
    `No single problem stands out: the window was full ${percent(blocked)} of the time and no ` +
    `timer fired too early.`
  );
}

export function baselineLine(run: ScoredRun, baseline: ScoredRun): string {
  const best = `window ${baseline.settings.windowSize}, timeout ${baseline.settings.timeoutMs} ms`;
  const ratio = baseline.score === 0 ? 1 : run.score / baseline.score;
  if (ratio >= 0.995) return `You matched the best setting on the grid (${best}).`;

  // Score = speed × efficiency, so name whichever factor lost more.
  const slower = run.metrics.totalVirtualTimeMs / baseline.metrics.totalVirtualTimeMs;
  const lessEfficient = baseline.metrics.efficiency / run.metrics.efficiency;
  const reason =
    slower >= lessEfficient
      ? `your run took ${slower.toFixed(1)}× as long ` +
        `(${ms(run.metrics.totalVirtualTimeMs)} vs ${ms(baseline.metrics.totalVirtualTimeMs)})`
      : `only ${percent(run.metrics.efficiency)} of your transmissions were useful, ` +
        `against ${percent(baseline.metrics.efficiency)} for the baseline`;
  return `You reached ${percent(ratio)} of the baseline (${best}), mainly because ${reason}.`;
}

function compareLine(runs: readonly ScoredRun[], numPackets: number): string {
  const sends = runs
    .map((r) => `${PROTOCOLS[r.protocol].name} sent ${r.metrics.totalTransmissions}`)
    .join(', ');
  const [fastest, ...others] = [...runs].sort(
    (a, b) => a.metrics.totalVirtualTimeMs - b.metrics.totalVirtualTimeMs,
  );
  const otherTimes = others
    .map((r) => `${ms(r.metrics.totalVirtualTimeMs)} for ${PROTOCOLS[r.protocol].name}`)
    .join(', ');
  return (
    `To deliver ${numPackets} packets, ${sends}. ` +
    `${PROTOCOLS[fastest!.protocol].name} finished first ` +
    `(${ms(fastest!.metrics.totalVirtualTimeMs)}, against ${otherTimes}).`
  );
}

// Timeouts that fired while a useful copy of the packet, or an ACK covering it, was
// still travelling and would have arrived: the timer was simply too short.
function prematureTimeouts(run: ScoredRun, timeline: Timeline): number {
  const cumulative = PROTOCOLS[run.protocol].cumulativeAcks;
  let count = 0;
  for (const e of run.log) {
    if (e.kind !== 'timeout') continue;
    const t = e.time;
    const seq = e.packet.seq;
    const stillComing = timeline.flights.some((f) => {
      if (f.outcome === 'lost' || f.departTime >= t || f.endTime <= t) return false;
      if (f.packet.kind === 'DATA') return f.packet.seq === seq && !f.wasted;
      return cumulative ? f.packet.seq >= seq : f.packet.seq === seq;
    });
    if (stillComing) count++;
  }
  return count;
}

// Time-weighted share of the run in which the window was full while packets were
// still waiting to be sent for the first time.
function windowFullFraction(run: ScoredRun, numPackets: number): number {
  const windowSize = run.settings.windowSize;
  const cumulative = PROTOCOLS[run.protocol].cumulativeAcks;
  const ackedSeqs = new Set<number>();
  let highestAck = -1;
  let firstSends = 0;
  let blockedMs = 0;
  let previousTime = 0;

  for (const e of run.log) {
    // The state held between the previous entry and this one.
    const acked = cumulative ? highestAck + 1 : ackedSeqs.size;
    if (firstSends - acked >= windowSize && firstSends < numPackets) {
      blockedMs += e.time - previousTime;
    }
    previousTime = e.time;

    if (e.kind === 'send' && e.packet.kind === 'DATA') firstSends++;
    if (e.kind === 'ack-received') {
      ackedSeqs.add(e.packet.seq);
      highestAck = Math.max(highestAck, e.packet.seq);
    }
  }
  const total = run.metrics.totalVirtualTimeMs;
  return total === 0 ? 0 : blockedMs / total;
}

function slowestRoundTrip(timeline: Timeline): number {
  const slowest = (kind: 'DATA' | 'ACK'): number =>
    Math.max(
      0,
      ...timeline.flights
        .filter((f) => f.packet.kind === kind && f.outcome === 'arrived')
        .map((f) => f.endTime - f.departTime),
    );
  return Math.round((slowest('DATA') + slowest('ACK')) / 10) * 10;
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

function percent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

function ms(value: number): string {
  return `${Math.round(value)} ms`;
}
