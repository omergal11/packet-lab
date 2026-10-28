import type { Frame, FlightView } from '../engine/replay.js';
import { svg } from './svg.js';

// Geometry in viewBox units (the SVG is 1000 × 250 and scales to fit its container).
const LANE_START = 150;
const LANE_END = 850;
const DATA_Y = 90;
const ACK_Y = 175;
const PKT_W = 46;
const PKT_H = 26;

export interface LinkView {
  render(frame: Frame, lostLingerMs: number): void;
}

export function createLinkView(root: SVGSVGElement): LinkView {
  drawStatic(root);
  // Everything that moves lives in one group that is cleared and redrawn each frame.
  // With at most a few dozen packets this is cheap, and far simpler than diffing.
  const layer = svg(root, 'g', { class: 'packets' });

  return {
    render(frame, lostLingerMs) {
      layer.replaceChildren();
      for (const view of frame.flights) drawPacket(layer, view, lostLingerMs);
    },
  };
}

function drawStatic(root: SVGSVGElement): void {
  for (const [x, label] of [
    [20, 'Sender'],
    [LANE_END + 20, 'Receiver'],
  ] as const) {
    svg(root, 'rect', { class: 'node', x, y: 45, width: 110, height: 170, rx: 8 });
    svg(root, 'text', { class: 'node-label', x: x + 55, y: 135 }, label);
  }
  svg(root, 'line', { class: 'lane', x1: LANE_START, y1: DATA_Y, x2: LANE_END, y2: DATA_Y });
  svg(root, 'line', { class: 'lane', x1: LANE_START, y1: ACK_Y, x2: LANE_END, y2: ACK_Y });
  svg(root, 'text', { class: 'lane-label', x: 500, y: DATA_Y - 30 }, 'DATA  →');
  svg(root, 'text', { class: 'lane-label', x: 500, y: ACK_Y + 42 }, '←  ACK');
}

function drawPacket(layer: SVGGElement, view: FlightView, lostLingerMs: number): void {
  const { flight, progress, lostForMs } = view;
  const isData = flight.packet.kind === 'DATA';
  // DATA moves left → right, ACKs right → left.
  const x = isData
    ? LANE_START + progress * (LANE_END - LANE_START)
    : LANE_END - progress * (LANE_END - LANE_START);
  // Vertical stagger over four rows by seq, so packets sent (or lost) together do not
  // hide each other completely.
  const y = (isData ? DATA_Y : ACK_Y) + ((flight.packet.seq % 4) - 1.5) * 10;

  const lost = lostForMs !== null;
  const classes = ['pkt', isData ? 'pkt-data' : 'pkt-ack'];
  if (lost) classes.push('pkt-lost');
  if (flight.cause === 'retransmit') classes.push('pkt-retransmit');

  const g = svg(layer, 'g', {
    class: classes.join(' '),
    transform: `translate(${x.toFixed(1)} ${y.toFixed(1)})`,
    // Fade a lost packet out over the linger period.
    opacity: lost ? Math.max(0, 1 - lostForMs / lostLingerMs).toFixed(2) : 1,
  });
  svg(g, 'rect', { x: -PKT_W / 2, y: -PKT_H / 2, width: PKT_W, height: PKT_H, rx: 4 });
  svg(g, 'text', { class: 'pkt-text', y: 1 }, `${isData ? 'D' : 'A'}${flight.packet.seq}`);
  if (lost) svg(g, 'text', { class: 'pkt-caption', y: PKT_H + 2 }, '✕ lost');
  else if (flight.cause === 'link-duplicate') {
    svg(g, 'text', { class: 'pkt-caption', y: PKT_H + 2 }, 'dup');
  }
}
