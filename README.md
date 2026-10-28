# PacketLab

A browser-only game that teaches how reliable data transfer works: acknowledgements, timeouts, retransmission, and the sliding window algorithm. The player acts as the protocol — tuning parameters, running a simulated lossy network, and comparing their score to a TCP-like baseline.

Everything runs in the browser. There is no backend. The final site is deployed to GitHub Pages.

---

## Quick start

```bash
npm install
npm run dev      # open http://localhost:5173/packet-lab/
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

The engine is pure TypeScript: it can run identically in Node (tests) and in the browser. The UI (`src/main.ts` and future UI files) is the only layer allowed to read the DOM. The UI reads the engine's output — an event log and a metrics object — and renders it; it never reaches into the engine's internals.

This separation means:

* Unit tests run in Node with no browser globals.
* The engine logic can be reasoned about and tested without any rendering.
* Future UI frameworks (canvas, SVG, React) can be swapped in without touching the engine.

---

## Project layout

```
src/
  engine/
    prng.ts               Seeded PRNG (mulberry32) — same seed → same run
    eventQueue.ts         Min-heap priority queue ordered by virtual time
    packet.ts             Packet and LogEntry types
    link.ts               One-directional lossy channel (drop, delay, jitter, duplicate, reorder)
    simulation.ts         Virtual clock, event loop, EndpointCtx interface
    metrics.ts            Efficiency, throughput, and time from the event log
    protocols/
      stopAndWait.ts      Stop-and-Wait sender + receiver
  main.ts                 Debug page — runs a simulation and prints the log
tests/
  prng.test.ts
  eventQueue.test.ts
  link.test.ts
  simulation.test.ts
.github/
  workflows/
    ci.yml                Lint → typecheck → test → build on every push/PR
    deploy.yml            Deploy dist/ to GitHub Pages on push to main
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
