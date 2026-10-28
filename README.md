# PacketLab

A browser-only game that teaches how reliable data transfer works: acknowledgements, timeouts, retransmission, and the sliding window algorithm. The player acts as the protocol — tuning parameters, running a simulated lossy network, and comparing their score to a TCP-like baseline.

Everything runs in the browser. There is no backend. The final site is deployed to GitHub Pages.

---

## Quick start

```bash
npm install
npm run dev      # open http://localhost:5173/packet-lab/  (debug log: /packet-lab/debug.html)
```

## Available scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the Vite dev server |
| `npm run build` | Produce a production build in `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm test` | Run all Vitest unit tests |
| `npm run typecheck` | Run `tsc --noEmit` (type-check without emitting files) |
| `npm run lint` | Run ESLint across the whole project |

---

## Architecture rule

> **The simulation engine (`src/engine/`) must never touch the DOM or any browser API.**

The engine is pure TypeScript: it can run identically in Node (tests) and in the browser. The UI (`src/main.ts` and `src/ui/`) is the only layer allowed to touch the DOM. The UI reads the engine's output — an event log and a metrics object — and renders it; it never reaches into the engine's internals.

This separation means:

* Unit tests run in Node with no browser globals.
* The engine logic can be reasoned about and tested without any rendering.
* Future UI frameworks (canvas, SVG, React) can be swapped in without touching the engine.

---

## How it works

**Simulate first, animate later.** Whenever the player moves a slider, the whole simulation runs to completion immediately — it is deterministic and takes a millisecond or two. The result is an event log plus metrics. The UI then *replays* that log as an animation with play, pause, step and speed controls. Protocol code never knows it is being animated.

1. **Simulation** (`simulation.ts`) owns a virtual clock and a priority queue of events. It always runs the earliest event next, so no real time passes and runs are reproducible.
2. **Links** (`link.ts`) decide what happens to each packet: drop, delay + jitter, duplicate, or reorder (hold back so later packets overtake). The forward (DATA) and reverse (ACK) links have independent random streams derived from the run seed, and can be configured separately.
3. **Protocols** (`protocols/`) implement a sender and a receiver. They only see an `EndpointCtx` (send, timers, clock, log) — never the simulation itself.
4. **Event log.** The simulation logs every wire event (`send`, `retransmit`, `link-duplicate`, `drop`, `data-received`, `ack-received`) with a `wireId` per physical copy. Protocols log only their own decisions (`timeout`, `deliver`, `buffer`, `duplicate-dropped`). Every entry includes the packet, so DATA and ACK are never ambiguous.
5. **Replay** (`replay.ts`) pairs each departure with its arrival or drop into *flights*, and answers "what does the network look like at time t?" — packets on each lane, the state of every sequence number, and the sender's window.
6. **Scoring** (`scoring.ts`): score = goodput (packets per virtual second) × efficiency (useful ÷ total DATA transmissions). The baseline sweeps every window/timeout setting the level allows, for the same seed, and keeps the best — nothing is hardcoded.

## Engine modules

| Module | Responsibility |
|---|---|
| `prng.ts` | Seeded PRNG (mulberry32) — same seed, same run |
| `eventQueue.ts` | Min-heap of events ordered by (time, insertion order) |
| `packet.ts` | `Packet` and `LogEntry` types; the list of log event kinds |
| `link.ts` | One-directional lossy channel: drop, delay, jitter, duplicate, reorder |
| `simulation.ts` | Virtual clock, event loop, `EndpointCtx`, wire-event logging |
| `metrics.ts` | Delivered count, transmissions, efficiency, total time — from the log |
| `protocols/stopAndWait.ts` | Stop-and-Wait sender and receiver |
| `protocols/slidingWindow.ts` | Selective Repeat sender (per-packet timers) and receiver (buffering) |
| `replay.ts` | Event log → timeline of frames for animation |
| `scoring.ts` | Run a level setting, score it, sweep for the baseline |

## Project layout

```
src/
  engine/                 Pure TypeScript — no DOM (see table above)
  levels/
    level.ts              Level type and the slider grid used by the baseline
    level1.ts             Level 1 data: seed, link, packet count, slider ranges
  ui/
    svg.ts                Tiny helper for creating SVG elements
    linkView.ts           Sender/receiver, DATA and ACK lanes, moving packets
    packetStrip.ts        Per-seq state cells and the window bracket
    player.ts             requestAnimationFrame playback over the virtual timeline
  main.ts                 Level 1 page: wires level, engine and UI together
  debug.ts                debug.html — prints a raw Stop-and-Wait event log
  style.css
tests/                    Vitest unit tests for every engine module
.github/workflows/        CI (lint, typecheck, test, build) and Pages deploy
```

---

## Deployment

The site is deployed to GitHub Pages via `deploy.yml`. The Vite `base` option is set to `/packet-lab/`, which assumes the repository is named **`packet-lab`**. If you rename the repository, update the `base` value in `vite.config.ts` to match.

Enable Pages in the repository settings: **Settings → Pages → Source → GitHub Actions**.

---

## Stack

- **TypeScript 6** — strict mode, ESM, no `any`
- **Vite** — dev server and bundler
- **Vitest** — unit tests
- **ESLint + Prettier** — linting and formatting
- **GitHub Actions** — CI and Pages deployment
