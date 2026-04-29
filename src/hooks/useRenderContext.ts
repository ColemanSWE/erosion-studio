import { useEffect, useRef } from "react";
import type { GLPipeline } from "../lib/effects/effects-renderer";

export interface RenderContext {
  bufferRef: React.MutableRefObject<HTMLCanvasElement | null>;
  bufferCtxRef: React.MutableRefObject<CanvasRenderingContext2D | null>;
  glPipelineRef: React.MutableRefObject<GLPipeline | null>;
}

export function useRenderContext(): RenderContext {
  const bufferRef = useRef<HTMLCanvasElement | null>(null);
  const bufferCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const glPipelineRef = useRef<GLPipeline | null>(null);

  useEffect(() => {
    const buffer = document.createElement("canvas");
    bufferRef.current = buffer;
    bufferCtxRef.current = buffer.getContext("2d", { willReadFrequently: true });

    import("../lib/effects/gl/pipeline").then(({ GLPipeline }) => {
      glPipelineRef.current = GLPipeline.tryCreate();
    });

    return () => {
      glPipelineRef.current?.dispose();
      glPipelineRef.current = null;
      bufferRef.current = null;
      bufferCtxRef.current = null;
    };
  }, []);

  return { bufferRef, bufferCtxRef, glPipelineRef };
}
