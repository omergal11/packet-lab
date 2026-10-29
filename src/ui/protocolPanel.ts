import type { Frame } from '../engine/replay.js';
import { createLinkView } from './linkView.js';
import { createPacketStrip } from './packetStrip.js';
import { svg } from './svg.js';

export interface ProtocolPanel {
  render(frame: Frame, windowSize: number, numPackets: number): void;
}

// One protocol's view: a heading, the link with moving packets, and the packet strip.
// Level 1 shows one panel; Level 2 shows one per protocol, stacked so the same moment
// lines up vertically.
export function createProtocolPanel(
  container: HTMLElement,
  title: string,
  lostLingerMs: number,
): ProtocolPanel {
  const section = document.createElement('section');
  section.className = 'panel';
  section.setAttribute('aria-label', title);
  const heading = document.createElement('h2');
  heading.textContent = title;
  // Live count while the animation plays; the results table shows the final numbers.
  const live = document.createElement('span');
  live.className = 'live-count';
  heading.appendChild(live);
  section.appendChild(heading);
  container.appendChild(section);

  const linkSvg = svg(section, 'svg', {
    viewBox: '0 0 1000 250',
    role: 'img',
    'aria-label': `${title}: packets travelling between sender and receiver`,
  });
  const stripSvg = svg(section, 'svg', {
    viewBox: '0 0 1000 110',
    role: 'img',
    'aria-label': `${title}: state of each sequence number`,
  });
  const linkView = createLinkView(linkSvg);
  const strip = createPacketStrip(stripSvg);

  return {
    render(frame, windowSize, numPackets) {
      live.textContent = `delivered ${frame.delivered} / ${numPackets}`;
      linkView.render(frame, lostLingerMs);
      strip.render(frame, windowSize);
    },
  };
}
