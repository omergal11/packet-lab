// Captures the README screenshots with headless Chrome, driven over the Chrome
// DevTools Protocol using only Node's built-in fetch and WebSocket (Node 22+).
// No extra npm packages: Chrome's own protocol can emulate a screen size, click
// buttons through page JavaScript, and return a PNG.
//
// Usage:
//   npm run build && npx vite preview --port 4173
//   node scripts/screenshots.mjs http://localhost:4173/packet-lab/
//
// Set CHROME_PATH if Chrome is not at the default Windows location.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const baseUrl = process.argv[2] ?? 'http://localhost:4173/packet-lab/';
const outDir = process.argv[3] ?? 'docs';
// Optional: also save the 360px captures here, to eyeball the phone layout.
const phoneDir = process.argv[4];
const chromePath =
  process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const port = 9333;

// Page JavaScript run before a capture: set the sliders, then press Step `steps` times.
const setUp = (windowSize, timeoutMs, steps) => `
  const set = (id, v) => { const el = document.getElementById(id); el.value = v;
    el.dispatchEvent(new Event('input')); };
  ${windowSize === undefined ? '' : `set('window', ${windowSize});`}
  ${timeoutMs === undefined ? '' : `set('timeout', ${timeoutMs});`}
  for (let i = 0; i < ${steps}; i++) document.getElementById('step').click();
`;

const shots = [
  // Level 1 mid-run: losses on the wire and the window bracket over the strip.
  { file: 'level1.png', query: '?level=1', width: 1100, script: setUp(12, 550, 14) },
  // Level 2 mid-run: Go-Back-N's wasted copies next to Selective Repeat.
  { file: 'level2.png', query: '?level=2', width: 1100, script: setUp(undefined, undefined, 40) },
  // Level 2 explanations after the run.
  { file: 'level2-results.png', query: '?level=2', width: 1100, selector: '.metrics' },
];

async function main() {
  const profile = mkdtempSync(join(tmpdir(), 'packetlab-chrome-'));
  const chrome = spawn(chromePath, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    'about:blank',
  ]);
  try {
    const cdp = await connect();
    await cdp.send('Page.enable');
    for (const shot of shots) {
      const png = await capture(cdp, shot);
      writeFileSync(join(outDir, shot.file), png);
      console.log(`wrote ${join(outDir, shot.file)}`);
    }
    // Layout check at a small phone width: report any horizontal overflow.
    for (const query of ['?level=1', '?level=2']) {
      const overflow = await measureOverflow(cdp, query, 360);
      console.log(`360px ${query}: page is ${overflow} px wider than the screen`);
      if (phoneDir) {
        const png = await capture(cdp, { query, width: 360 });
        writeFileSync(join(phoneDir, `phone-level${query.slice(-1)}.png`), png);
      }
    }
    cdp.close();
  } finally {
    chrome.kill();
    // Chrome may still hold the profile for a moment; cleanup is best effort.
    setTimeout(() => rmSync(profile, { recursive: true, force: true }), 500);
  }
}

async function capture(cdp, { query, width, script, selector }) {
  await load(cdp, query, width, 900);
  if (script) await cdp.eval(script);
  // Grow the viewport to the full page height so one image holds everything.
  const height = await cdp.eval('document.documentElement.scrollHeight');
  await setViewport(cdp, width, height);
  let clip;
  if (selector) {
    clip = await cdp.eval(`(() => { const r = document.querySelector('${selector}')
      .getBoundingClientRect(); return { x: r.x - 8, y: r.y - 8, width: r.width + 16,
      height: r.height + 16, scale: 1 }; })()`);
  }
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', clip });
  return Buffer.from(data, 'base64');
}

async function measureOverflow(cdp, query, width) {
  await load(cdp, query, width, 800);
  return cdp.eval('document.documentElement.scrollWidth - window.innerWidth');
}

async function load(cdp, query, width, height) {
  await setViewport(cdp, width, height);
  const loaded = cdp.waitFor('Page.loadEventFired');
  await cdp.send('Page.navigate', { url: baseUrl + query });
  await loaded;
}

function setViewport(cdp, width, height) {
  return cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width < 600,
  });
}

// Minimal CDP client: numbered requests matched to responses, plus one-off event waits.
async function connect() {
  let targets = [];
  for (let attempt = 0; attempt < 50 && targets.length === 0; attempt++) {
    try {
      const all = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      targets = all.filter((t) => t.type === 'page');
    } catch {
      await new Promise((r) => setTimeout(r, 100)); // Chrome is still starting
    }
  }
  if (targets.length === 0) throw new Error('Could not reach Chrome on port ' + port);

  const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  let nextId = 1;
  const pending = new Map();
  const waiters = new Map();
  ws.onmessage = (msg) => {
    const data = JSON.parse(msg.data);
    if (data.id !== undefined) {
      const { resolve, reject } = pending.get(data.id);
      pending.delete(data.id);
      if (data.error) reject(new Error(data.error.message));
      else resolve(data.result);
    } else if (waiters.has(data.method)) {
      waiters.get(data.method)();
      waiters.delete(data.method);
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  return {
    send,
    waitFor: (method) => new Promise((resolve) => waiters.set(method, resolve)),
    async eval(expression) {
      const { result, exceptionDetails } = await send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      if (exceptionDetails) throw new Error(exceptionDetails.exception?.description);
      return result.value;
    },
    close: () => ws.close(),
  };
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
