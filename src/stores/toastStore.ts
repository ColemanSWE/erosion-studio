import { create } from "zustand";

export type ToastKind = "success" | "error" | "info";

export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
  detail?: string;
}

interface ToastState {
  toasts: ToastItem[];
  push: (toast: Omit<ToastItem, "id">) => void;
  dismiss: (id: number) => void;
}

const DURATION_MS: Record<ToastKind, number> = { success: 4000, info: 4000, error: 8000 };
const MAX_VISIBLE = 4;
let nextId = 1;

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  push: (toast) => {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts.slice(-(MAX_VISIBLE - 1)), { ...toast, id }] }));
    setTimeout(() => get().dismiss(id), DURATION_MS[toast.kind]);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** Non-blocking notifications, callable from components, hooks and stores alike. */
export const toast = {
  success: (message: string, detail?: string) => useToastStore.getState().push({ kind: "success", message, detail }),
  error: (message: string, detail?: string) => useToastStore.getState().push({ kind: "error", message, detail }),
  info: (message: string, detail?: string) => useToastStore.getState().push({ kind: "info", message, detail }),
};
