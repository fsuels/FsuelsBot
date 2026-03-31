import type { WebSocket } from "ws";
import type { ConnectParams } from "../protocol/index.js";

export type GatewayQueuedEventFrame = {
  event: string;
  frame: string;
  dropIfSlow?: boolean;
};

export type GatewayReplayState = {
  active: boolean;
  queuedFrames: GatewayQueuedEventFrame[];
};

export type GatewayWsClient = {
  socket: WebSocket;
  connect: ConnectParams;
  connId: string;
  presenceKey?: string;
  clientIp?: string;
  replayState?: GatewayReplayState;
};
