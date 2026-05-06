import { useCallback } from "react";

type DragHandlerFn = (dx: number, dy: number) => void;
type EndHandlerFn = () => void;

/**
 * Returns a `startDrag(e)` handler that attaches window-level mousemove/mouseup
 * listeners, throttles moves through requestAnimationFrame, and calls `onDrag`
 * with cumulative (dx, dy) deltas relative to the mousedown position.
 */
export function useDragHandler(onDrag: DragHandlerFn, onEnd?: EndHandlerFn) {
  return useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startY = e.clientY;
      let lastX = startX;
      let lastY = startY;
      let rafId: number | null = null;

      const onMove = (me: MouseEvent) => {
        lastX = me.clientX;
        lastY = me.clientY;
        if (rafId !== null) return;
        rafId = requestAnimationFrame(() => {
          rafId = null;
          onDrag(lastX - startX, lastY - startY);
        });
      };

      const onUp = () => {
        if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
        onEnd?.();
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [onDrag, onEnd],
  );
}

/**
 * Returns a `startResize(e)` handler. Passes the cumulative dx from mousedown to
 * `onResize(dx)` on every RAF tick, and calls `onEnd` on mouseup.
 */
export function useResizeHandler(onResize: (dx: number) => void, onEnd?: EndHandlerFn) {
  return useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      let lastX = startX;
      let rafId: number | null = null;

      const onMove = (me: MouseEvent) => {
        lastX = me.clientX;
        if (rafId !== null) return;
        rafId = requestAnimationFrame(() => {
          rafId = null;
          onResize(lastX - startX);
        });
      };

      const onUp = () => {
        if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
        onEnd?.();
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [onResize, onEnd],
  );
}
