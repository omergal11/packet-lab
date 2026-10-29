import type { EndpointCtx, ReceiverDef, SenderDef } from '../simulation.js';
import { GoBackNReceiver, GoBackNSender } from './goBackN.js';
import {
  SelectiveRepeatReceiver,
  SelectiveRepeatSender,
  type SlidingWindowConfig,
} from './slidingWindow.js';

export type ProtocolId = 'selective-repeat' | 'go-back-n';

export interface ProtocolInfo {
  name: string;
  // Cumulative ACKs (Go-Back-N) mean "everything up to n", which the replay must know.
  cumulativeAcks: boolean;
  createSender(ctx: EndpointCtx, config: SlidingWindowConfig, onDone: () => void): SenderDef;
  createReceiver(ctx: EndpointCtx, windowSize: number): ReceiverDef;
}

// One table describing every sliding-window protocol, so levels can refer to a
// protocol by id and scoring, replay and the UI all agree on how to run and show it.
export const PROTOCOLS: Record<ProtocolId, ProtocolInfo> = {
  'selective-repeat': {
    name: 'Selective Repeat',
    cumulativeAcks: false,
    createSender: (ctx, config, onDone) => new SelectiveRepeatSender(ctx, config, onDone),
    createReceiver: (ctx, windowSize) => new SelectiveRepeatReceiver(ctx, windowSize),
  },
  'go-back-n': {
    name: 'Go-Back-N',
    cumulativeAcks: true,
    createSender: (ctx, config, onDone) => new GoBackNSender(ctx, config, onDone),
    createReceiver: (ctx) => new GoBackNReceiver(ctx),
  },
};
