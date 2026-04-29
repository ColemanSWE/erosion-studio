import type { Effect } from "./types";
import type { ProcessConfig } from "./effect-registry";

type WorkerMessage = { id: number; buffer: Uint8ClampedArray; effects: Effect[]; config: ProcessConfig };
type WorkerResponse = { id: number; buffer: Uint8ClampedArray; error?: string };

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, { resolve: (buf: Uint8ClampedArray) => void; reject: (err: unknown) => void }>();

function getWorker(): Worker | null {
  if (worker) return worker;
  try {
    worker = new Worker(
      new URL("./effects-worker.ts", import.meta.url),
      { type: "module" }
    );
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const { id, buffer, error } = e.data;
      const p = pending.get(id);
      if (!p) {
        console.warn(`Worker: received response for unknown request id=${id}`);
        return;
      }
      pending.delete(id);
      if (error) {
        console.error("Worker effect processing error:", error);
      }
      p.resolve(buffer);
    };
    worker.onerror = (err) => {
      for (const p of pending.values()) p.reject(err);
      pending.clear();
      worker = null;
    };
    return worker;
  } catch {
    return null;
  }
}

export function processEffectsInWorker(
  buffer: Uint8ClampedArray,
  effects: Effect[],
  config: ProcessConfig
): Promise<Uint8ClampedArray> {
  const w = getWorker();
  if (!w) return Promise.reject(new Error("Worker unavailable"));

  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    const configCopy: ProcessConfig = {
      ...config,
      timelineFrames: undefined,
      faceBounds: config.faceBounds,
      handBounds: config.handBounds,
      poseBounds: config.poseBounds,
    };
    w.postMessage(
      { id, buffer, effects, config: configCopy } as WorkerMessage,
      [buffer.buffer]
    );
  });
}

export function disposeEffectsWorker(): void {
  if (worker) {
    worker.terminate();
    worker = null;
  }
  for (const p of pending.values()) p.reject(new Error("Worker disposed"));
  pending.clear();
}
