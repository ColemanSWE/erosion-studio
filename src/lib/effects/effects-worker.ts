import { applyEffects } from "./effect-registry";
import type { Effect } from "./types";
import type { ProcessConfig } from "./effect-registry";

import "./processors";

if (typeof document === "undefined") {
  const doc = {
    createElement: (tag: string): HTMLCanvasElement =>
      tag === "canvas"
        ? (new OffscreenCanvas(1, 1) as unknown as HTMLCanvasElement)
        : (() => { throw new Error(`Worker: createElement("${tag}") not supported`); })(),
  };
  (globalThis as unknown as { document: typeof doc }).document = doc;
}

interface WorkerRequest {
  id: number;
  buffer: Uint8ClampedArray;
  effects: Effect[];
  config: ProcessConfig;
}

interface WorkerResponse {
  id: number;
  buffer: Uint8ClampedArray;
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const { id, buffer, effects, config } = e.data;
  try {
    applyEffects(buffer, effects, config);
    self.postMessage({ id, buffer } as WorkerResponse, { transfer: [buffer.buffer] });
  } catch {
    self.postMessage({ id, buffer } as WorkerResponse, { transfer: [buffer.buffer] });
  }
};
