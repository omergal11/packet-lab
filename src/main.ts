// Debug entry point: runs one Stop-and-Wait simulation and prints the log + metrics.
// No styling — this is just enough to verify the engine works in the browser.
import { Simulation } from './engine/simulation.js';
import { StopAndWaitReceiver, StopAndWaitSender } from './engine/protocols/stopAndWait.js';
import type { LinkConfig } from './engine/link.js';

const linkConfig: LinkConfig = {
  lossRate: 0.2,
  baseDelayMs: 100,
  jitterMs: 50,
  duplicateRate: 0.1,
  reorderRate: 0.05,
};

const runConfig = {
  seed: 42,
  numPackets: 8,
  timeoutMs: 500,
  linkConfig,
};

const sim = new Simulation(runConfig);
const { log, metrics } = sim.run(
  (ctx, onDone) => new StopAndWaitSender(ctx, runConfig.numPackets, runConfig.timeoutMs, onDone),
  (ctx) => new StopAndWaitReceiver(ctx),
);

const lines: string[] = [
  '=== PacketLab — Stop-and-Wait debug run ===',
  `seed: ${runConfig.seed}`,
  '',
];

lines.push('--- Event Log ---');
for (const entry of log) {
  const pkt = entry.packet;
  const payload = pkt.payload !== undefined ? ` payload="${pkt.payload}"` : '';
  lines.push(
    `[${entry.time.toFixed(1).padStart(8)}ms]  ${entry.kind.padEnd(18)} seq=${pkt.seq}${payload}`,
  );
}

lines.push('');
lines.push('--- Metrics ---');
lines.push(`Delivered:          ${metrics.delivered} / ${runConfig.numPackets}`);
lines.push(`Total transmissions: ${metrics.totalTransmissions}`);
lines.push(`Efficiency:          ${(metrics.efficiency * 100).toFixed(1)}%`);
lines.push(`Total virtual time:  ${metrics.totalVirtualTimeMs.toFixed(1)} ms`);

const pre = document.createElement('pre');
pre.style.fontFamily = 'monospace';
pre.style.padding = '1rem';
pre.textContent = lines.join('\n');
document.body.appendChild(pre);
