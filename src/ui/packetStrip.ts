import type { Frame, SeqState } from '../engine/replay.js';
import { svg } from './svg.js';

// A marker per state so the strip never relies on color alone.
const MARKER: Record<SeqState, string> = {
  acked: '✓',
  'in-flight': '→',
  lost: '✕',
  discarded: '⊘',
  'not-sent': '–',
};

const LEFT = 30;
const WIDTH = 940;
const CELL_Y = 46;
const CELL_H = 52;
const GAP = 6;

export interface PacketStrip {
  render(frame: Frame, windowSize: number): void;
}

export function createPacketStrip(root: SVGSVGElement): PacketStrip {
  return {
    render(frame, windowSize) {
      root.replaceChildren();
      const n = frame.seqStates.length;
      const pitch = WIDTH / n; // cell width + gap
      const cellX = (seq: number): number => LEFT + seq * pitch;

      frame.seqStates.forEach((state, seq) => {
        const g = svg(root, 'g', { class: `cell cell-${state}` });
        svg(g, 'rect', {
          x: cellX(seq),
          y: CELL_Y,
          width: pitch - GAP,
          height: CELL_H,
          rx: 4,
        });
        const cx = cellX(seq) + (pitch - GAP) / 2;
        svg(g, 'text', { class: 'cell-seq', x: cx, y: CELL_Y + 18 }, String(seq));
        svg(g, 'text', { class: 'cell-marker', x: cx, y: CELL_Y + 40 }, MARKER[state]);
        svg(g, 'title', {}, `seq ${seq}: ${state}`);
      });

      // Bracket over the sender's window. Hidden once every packet is acknowledged.
      if (frame.windowBase >= n) return;
      const end = Math.min(frame.windowBase + windowSize, n);
      const x1 = cellX(frame.windowBase) - 2;
      const x2 = cellX(end) - GAP + 2;
      svg(root, 'path', {
        class: 'window-bracket',
        d: `M ${x1} ${CELL_Y - 4} V ${CELL_Y - 14} H ${x2} V ${CELL_Y - 4}`,
      });
      svg(
        root,
        'text',
        // Clamp so the label stays inside the viewBox when the window is at either end.
        { class: 'window-label', x: Math.min(Math.max((x1 + x2) / 2, 80), 920), y: CELL_Y - 20 },
        `window (size ${windowSize})`,
      );
    },
  };
}
