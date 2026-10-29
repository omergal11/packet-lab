import './style.css';
import { explain } from './engine/insights.js';
import { PROTOCOLS } from './engine/protocols/registry.js';
import { Timeline } from './engine/replay.js';
import { runProtocol, type Scenario, type ScoredRun, type Settings } from './engine/scoring.js';
import { LEVELS } from './levels/index.js';
import { levelBaseline } from './levels/level.js';
import { createProtocolPanel } from './ui/protocolPanel.js';
import { Player } from './ui/player.js';

// Simulate first, animate later: every settings change re-runs the whole simulation
// (a few milliseconds), and the player only replays the finished logs.

const LOST_LINGER_MS = 250; // virtual ms a lost packet stays visible while it fades

function byId<T extends Element = HTMLElement>(id: string): T {
  const el = document.querySelector<T>(`#${id}`);
  if (el === null) throw new Error(`Missing element #${id}`);
  return el;
}

// ---------- Level and URL options ----------

// ?level=2 picks a level. ?loss=0.5 overrides the link's loss rate — a "what if" knob
// that also makes the safety stop easy to see (?loss=1 can never finish).
const params = new URLSearchParams(location.search);
const level = LEVELS.find((l) => String(l.id) === params.get('level')) ?? LEVELS[0]!;
const lossOverride = parseLoss(params.get('loss'));
const scenario: Scenario =
  lossOverride === null
    ? level.scenario
    : {
        ...level.scenario,
        linkConfig: { ...level.scenario.linkConfig, lossRate: lossOverride },
      };
const { numPackets } = scenario;

function parseLoss(value: string | null): number | null {
  if (value === null) return null;
  const loss = Number(value);
  return Number.isFinite(loss) && loss >= 0 && loss <= 1 ? loss : null;
}

// The baseline is defined for the level as designed. On a custom link we skip it:
// sweeping hundreds of settings on a link that loses everything would stall the page.
const baseline = lossOverride === null ? levelBaseline(level) : null;

// ---------- Static page content ----------

byId('level-name').textContent = level.name;
byId('level-goal').textContent = level.goal;
byId('level-intro').textContent = level.intro;
byId('seed').textContent = String(scenario.seed);
if (lossOverride !== null) {
  byId('custom-link').textContent =
    `Custom loss rate ${Math.round(lossOverride * 100)}% (from the URL) — no baseline.`;
}

const nav = byId('level-nav');
for (const l of LEVELS) {
  const link = document.createElement('a');
  link.href = `?level=${l.id}`;
  link.textContent = `Level ${l.id}`;
  if (l === level) link.setAttribute('aria-current', 'page');
  nav.appendChild(link);
}

const windowInput = byId<HTMLInputElement>('window');
const timeoutInput = byId<HTMLInputElement>('timeout');
const playButton = byId<HTMLButtonElement>('play');
const speedSelect = byId<HTMLSelectElement>('speed');
for (const [input, range, value] of [
  [windowInput, level.windowSize, level.initial.windowSize],
  [timeoutInput, level.timeoutMs, level.initial.timeoutMs],
] as const) {
  input.min = String(range.min);
  input.max = String(range.max);
  input.step = String(range.step);
  input.value = String(value);
}

const panelsContainer = byId('protocol-panels');
const panels = level.protocols.map((p) =>
  createProtocolPanel(panelsContainer, PROTOCOLS[p].name, LOST_LINGER_MS),
);

// ---------- Simulation and playback ----------

let runs = simulate();
showResults();
const player = new Player(timelinesFor(runs), (frames, playing) => {
  frames.forEach((frame, i) => panels[i]!.render(frame, runs[i]!.settings.windowSize, numPackets));
  const end = Math.max(...runs.map((r) => r.metrics.totalVirtualTimeMs));
  byId('clock').textContent = `${Math.round(frames[0]?.time ?? 0)} / ${Math.round(end)} ms`;
  playButton.textContent = playing ? 'Pause' : 'Play';
});

function currentSettings(): Settings {
  return { windowSize: Number(windowInput.value), timeoutMs: Number(timeoutInput.value) };
}

function simulate(): ScoredRun[] {
  const settings = currentSettings();
  return level.protocols.map((p) => runProtocol(p, scenario, settings));
}

function timelinesFor(rs: ScoredRun[]): Timeline[] {
  return rs.map(
    (r) =>
      new Timeline(r.log, {
        numPackets,
        windowSize: r.settings.windowSize,
        lostLingerMs: LOST_LINGER_MS,
        cumulativeAcks: PROTOCOLS[r.protocol].cumulativeAcks,
      }),
  );
}

// ---------- Results ----------

function showResults(): void {
  const settings = runs[0]!.settings;
  byId('window-value').textContent = String(settings.windowSize);
  byId('timeout-value').textContent = `${settings.timeoutMs} ms`;

  const unfinished = runs.filter((r) => !r.completed);
  const notice = byId('notice');
  notice.hidden = unfinished.length === 0;
  notice.textContent =
    `⚠ Did not finish: ${unfinished.map((r) => PROTOCOLS[r.protocol].name).join(' and ')} ` +
    `stopped at the safety limit before every packet arrived.`;

  const body = byId<HTMLTableSectionElement>('results-body');
  body.replaceChildren();
  for (const run of runs) {
    const m = run.metrics;
    const row = body.insertRow();
    row.insertCell().textContent = PROTOCOLS[run.protocol].name;
    row.insertCell().textContent = `${m.delivered} / ${numPackets}`;
    row.insertCell().textContent = run.completed
      ? `${Math.round(m.totalVirtualTimeMs)} ms`
      : `did not finish (${Math.round(m.totalVirtualTimeMs / 1000)} s)`;
    row.insertCell().textContent = `${Math.round(m.efficiency * 100)}% (${m.totalTransmissions} sends)`;
    row.insertCell().textContent = String(m.wastedArrivals);
  }

  renderBars();

  const list = byId('insights');
  list.replaceChildren();
  for (const line of explain(runs, numPackets, baseline)) {
    const item = document.createElement('li');
    item.textContent = line;
    list.appendChild(item);
  }
}

// One bar per protocol run plus the baseline, all on one scale.
function renderBars(): void {
  const rows = runs.map((r) => ({
    label: runs.length === 1 ? 'You' : PROTOCOLS[r.protocol].name,
    score: r.score,
    className: 'bar-you',
  }));
  if (baseline !== null) {
    rows.push({ label: 'Best on grid', score: baseline.score, className: 'bar-baseline' });
  }
  const scaleMax = Math.max(...rows.map((r) => r.score), 1e-9);

  const container = byId('bars');
  container.replaceChildren();
  for (const row of rows) {
    const line = document.createElement('div');
    line.className = 'bar-row';
    const label = document.createElement('span');
    label.className = 'bar-label';
    label.textContent = row.label;
    const track = document.createElement('div');
    track.className = 'bar-track';
    const bar = document.createElement('div');
    bar.className = `bar ${row.className}`;
    bar.style.width = `${(row.score / scaleMax) * 100}%`;
    track.appendChild(bar);
    const value = document.createElement('span');
    value.className = 'bar-value';
    value.textContent = row.score.toFixed(1);
    line.append(label, track, value);
    container.appendChild(line);
  }
  if (baseline !== null) {
    const note = document.createElement('p');
    note.className = 'hint';
    note.textContent =
      `Best on grid: ${PROTOCOLS[baseline.protocol].name}, window ${baseline.settings.windowSize}, ` +
      `timeout ${baseline.settings.timeoutMs} ms — the best of every setting the sliders allow.`;
    container.appendChild(note);
  }
}

// ---------- Controls ----------

function onSettingsChange(): void {
  runs = simulate();
  showResults();
  player.load(timelinesFor(runs));
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
