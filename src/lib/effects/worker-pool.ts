import type { Effect } from "./types";
import type { ProcessConfig } from "./effect-registry";

type WorkerMessage = { id: number; buffer: Uint8ClampedArray; effects: Effect[]; config: ProcessConfig };
type WorkerResponse = { id: number; buffer: Uint8ClampedArray; error?: string };

const POOL_SIZE = 4;

interface PoolWorker {
  worker: Worker;
  busy: boolean;
}

const pool: Array<PoolWorker | null> = Array(POOL_SIZE).fill(null);
let nextId = 0;
let roundRobinIdx = 0;

const pending = new Map<number, {
  resolve: (buf: Uint8ClampedArray) => void;
  reject: (err: unknown) => void;
  workerIdx: number;
}>();

function makeWorker(idx: number): PoolWorker | null {
  try {
    const w = new Worker(new URL("./effects-worker.ts", import.meta.url), { type: "module" });
    const entry: PoolWorker = { worker: w, busy: false };

    w.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const { id, buffer, error } = e.data;
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      pool[p.workerIdx]!.busy = false;
      if (error) console.error("Worker effect processing error:", error);
      p.resolve(buffer);
    };

    w.onerror = (err) => {
      for (const [pid, p] of pending.entries()) {
        if (p.workerIdx === idx) {
          pending.delete(pid);
          p.reject(err);
        }
      }
      pool[idx] = null;
    };

    return entry;
  } catch {
    return null;
  }
}

function getIdleWorkerIdx(): number {
  // Prefer an idle worker; fall back to round-robin.
  for (let i = 0; i < POOL_SIZE; i++) {
    const idx = (roundRobinIdx + i) % POOL_SIZE;
    const entry = pool[idx];
    if (entry && !entry.busy) {
      roundRobinIdx = (idx + 1) % POOL_SIZE;
      return idx;
    }
  }
  const idx = roundRobinIdx % POOL_SIZE;
  roundRobinIdx = (roundRobinIdx + 1) % POOL_SIZE;
  return idx;
}

function getWorkerAt(idx: number): PoolWorker | null {
  if (!pool[idx]) pool[idx] = makeWorker(idx);
  return pool[idx];
}

export function processEffectsInWorker(
  buffer: Uint8ClampedArray,
  effects: Effect[],
  config: ProcessConfig,
): Promise<Uint8ClampedArray> {
  const workerIdx = getIdleWorkerIdx();
  const entry = getWorkerAt(workerIdx);
  if (!entry) return Promise.reject(new Error("Worker unavailable"));

  const id = nextId++;
  entry.busy = true;

  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, workerIdx });
    const configCopy: ProcessConfig = {
      ...config,
      timelineFrames: undefined,
      faceBounds: config.faceBounds,
      handBounds: config.handBounds,
      poseBounds: config.poseBounds,
    };
    entry.worker.postMessage(
      { id, buffer, effects, config: configCopy } as WorkerMessage,
      [buffer.buffer],
    );
  });
}

export function disposeEffectsWorker(): void {
  for (let i = 0; i < POOL_SIZE; i++) {
    if (pool[i]) {
      pool[i]!.worker.terminate();
      pool[i] = null;
    }
  }
  for (const p of pending.values()) p.reject(new Error("Worker disposed"));
  pending.clear();
}
