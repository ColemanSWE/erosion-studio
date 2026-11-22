import type { Effect } from "./types";
import type { ProcessConfig } from "./effect-registry";

type WorkerMessage = { id: number; buffer: Uint8ClampedArray; effects: Effect[]; config: ProcessConfig };
type WorkerResponse = { id: number; buffer: Uint8ClampedArray; error?: string };

/**
 * One persistent worker for CPU effects.
 *
 * Deliberately a single worker rather than a pool: several CPU effects
 * (datamosh, slit-scan, frame trails, …) keep module-level state between
 * frames, and that state lives inside whichever worker ran them. Routing every
 * frame through the same worker keeps it coherent. Frames are processed one at
 * a time anyway because the render loop awaits each frame.
 */
let worker: Worker | null = null;
let workerBroken = false;
let nextId = 0;
const pending = new Map<number, { resolve: (buf: Uint8ClampedArray) => void; reject: (err: unknown) => void }>();

function getWorker(): Worker | null {
  if (worker || workerBroken) return worker;
  try {
    const w = new Worker(new URL("./effects-worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const { id, buffer, error } = e.data;
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      if (error) {
        console.error("Worker effect processing error:", error);
        p.reject(new Error(error));
      } else {
        p.resolve(buffer);
      }
    };
    w.onerror = (err) => {
      // A crashed worker loses its transferred buffers; callers fall back to the main thread.
      for (const p of pending.values()) p.reject(err);
      pending.clear();
      w.terminate();
      worker = null;
      workerBroken = true;
    };
    worker = w;
  } catch {
    workerBroken = true;
  }
  return worker;
}

export function isEffectsWorkerAvailable(): boolean {
  return getWorker() !== null;
}

/**
 * Apply `effects` to `buffer` off the main thread. The buffer is transferred
 * (detached on this side); use the returned array. Rejects if the worker is
 * unavailable or fails — callers should re-read pixels and run on the main thread.
 */
export function processEffectsInWorker(
  buffer: Uint8ClampedArray,
  effects: Effect[],
  config: ProcessConfig,
): Promise<Uint8ClampedArray> {
  const w = getWorker();
  if (!w) return Promise.reject(new Error("Worker unavailable"));

  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, buffer, effects, config } as WorkerMessage, [buffer.buffer]);
  });
}

export function disposeEffectsWorker(): void {
  worker?.terminate();
  worker = null;
  for (const p of pending.values()) p.reject(new Error("Worker disposed"));
  pending.clear();
}
