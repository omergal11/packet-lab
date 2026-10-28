import './style.css';
import { Timeline } from './engine/replay.js';
import {
  findBaseline,
  runSelectiveRepeat,
  type ScoredRun,
  type Settings,
} from './engine/scoring.js';
import { gridFor } from './levels/level.js';
import { level1 } from './levels/level1.js';
import { createLinkView } from './ui/linkView.js';
import { createPacketStrip } from './ui/packetStrip.js';
import { Player } from './ui/player.js';

// Simulate first, animate later: every settings change re-runs the whole simulation
// (it takes a millisecond or two), and the player only replays the finished log.

const LOST_LINGER_MS = 250; // virtual ms a lost packet stays visible while it fades

function byId<T extends Element = HTMLElement>(id: string): T {
  const el = document.querySelector<T>(`#${id}`);
  if (el === null) throw new Error(`Missing element #${id}`);
  return el;
}

const level = level1;
const { numPackets } = level.scenario;

const windowInput = byId<HTMLInputElement>('window');
const timeoutInput = byId<HTMLInputElement>('timeout');
const playButton = byId<HTMLButtonElement>('play');
const speedSelect = byId<HTMLSelectElement>('speed');

byId('level-name').textContent = level.name;
byId('level-goal').textContent = level.goal;
byId('seed').textContent = String(level.scenario.seed);
for (const [input, range, value] of [
  [windowInput, level.windowSize, level.initial.windowSize],
  [timeoutInput, level.timeoutMs, level.initial.timeoutMs],
] as const) {
  input.min = String(range.min);
  input.max = String(range.max);
  input.step = String(range.step);
  input.value = String(value);
}

// The baseline depends only on the level, so compute it once.
const baseline = findBaseline(level.scenario, gridFor(level));

const linkView = createLinkView(byId<SVGSVGElement>('link-view'));
const strip = createPacketStrip(byId<SVGSVGElement>('packet-strip'));

let run = simulate();
const player = new Player(timelineFor(run), (frame, playing) => {
  linkView.render(frame, LOST_LINGER_MS);
  strip.render(frame, run.settings.windowSize);
  byId('m-delivered').textContent = `${frame.delivered} / ${numPackets}`;
  byId('clock').textContent =
    `${Math.round(frame.time)} / ${Math.round(run.metrics.totalVirtualTimeMs)} ms`;
  playButton.textContent = playing ? 'Pause' : 'Play';
});
showResults();

function currentSettings(): Settings {
  return { windowSize: Number(windowInput.value), timeoutMs: Number(timeoutInput.value) };
}

function simulate(): ScoredRun {
  return runSelectiveRepeat(level.scenario, currentSettings());
}

function timelineFor(r: ScoredRun): Timeline {
  return new Timeline(r.log, {
    numPackets,
    windowSize: r.settings.windowSize,
    lostLingerMs: LOST_LINGER_MS,
  });
}

function showResults(): void {
  const { metrics } = run;
  byId('window-value').textContent = String(run.settings.windowSize);
  byId('timeout-value').textContent = `${run.settings.timeoutMs} ms`;
  byId('m-time').textContent = `${Math.round(metrics.totalVirtualTimeMs)} ms`;
  byId('m-efficiency').textContent =
    `${Math.round(metrics.efficiency * 100)}% (${metrics.totalTransmissions} sends for ${numPackets} packets)`;

  // Bars share one scale: the larger of the two scores fills the track.
  const scaleMax = Math.max(run.score, baseline.score);
  byId('bar-you').style.width = `${(run.score / scaleMax) * 100}%`;
  byId('bar-baseline').style.width = `${(baseline.score / scaleMax) * 100}%`;
  byId('score-you').textContent = run.score.toFixed(1);
  byId('score-baseline').textContent = baseline.score.toFixed(1);

  const percent = Math.round((run.score / baseline.score) * 100);
  const best = `window ${baseline.settings.windowSize}, timeout ${baseline.settings.timeoutMs} ms`;
  byId('verdict').textContent =
    percent >= 100
      ? `You matched the baseline (${best}) — the best setting on the grid for this seed.`
      : `You reached ${percent}% of the baseline score. The baseline is the best setting on the grid for this seed.`;
}

function onSettingsChange(): void {
  run = simulate();
  player.load(timelineFor(run));
  showResults();
}

windowInput.addEventListener('input', onSettingsChange);
timeoutInput.addEventListener('input', onSettingsChange);
byId('run').addEventListener('click', () => player.restart());
playButton.addEventListener('click', () => (player.isPlaying ? player.pause() : player.play()));
byId('step').addEventListener('click', () => player.step());
speedSelect.addEventListener('change', () => {
  player.speed = Number(speedSelect.value);
});
player.speed = Number(speedSelect.value);
