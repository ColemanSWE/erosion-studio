import { useCallback, useEffect, useState } from "react";
import { RenderEngine, type TimelineModel } from "../lib/engine/render-engine";
import type { Effect, EffectParamTrack, Region } from "../lib/effects/types";
import type { SourceTransform } from "../lib/project";

interface UseRenderEngineOptions {
  canvas: HTMLCanvasElement | null;
  timeline: TimelineModel;
  effects: Effect[];
  paramTracks: EffectParamTrack[];
  regions: Region[];
  sourceTransform: SourceTransform | undefined;
  camera: HTMLVideoElement | null;
  isPlaying: boolean;
  /** Changing the output size clears the canvas, so it needs a redraw. */
  resolutionKey: string;
  onDurationChange: (duration: number) => void;
}

/**
 * Creates the app's single RenderEngine and keeps it in sync with React state.
 * Everything time-dependent (playback, scrubbing, clip boundaries) reaches the
 * engine through the PlaybackClock, not through here.
 */
export function useRenderEngine({
  canvas,
  timeline,
  effects,
  paramTracks,
  regions,
  sourceTransform,
  camera,
  isPlaying,
  resolutionKey,
  onDurationChange,
}: UseRenderEngineOptions) {
  const [engine, setEngine] = useState<RenderEngine | null>(null);

  // Created in an effect (not a lazy initializer) so StrictMode's
  // mount → unmount → mount cycle disposes and recreates cleanly.
  useEffect(() => {
    const instance = new RenderEngine();
    setEngine(instance);
    return () => instance.dispose();
  }, []);

  useEffect(() => engine?.setCanvas(canvas), [engine, canvas]);
  useEffect(() => engine?.setTimeline(timeline), [engine, timeline]);
  useEffect(() => engine?.setEffects(effects, paramTracks), [engine, effects, paramTracks]);
  useEffect(() => engine?.setRegions(regions), [engine, regions]);
  useEffect(() => engine?.setSourceTransform(sourceTransform), [engine, sourceTransform]);
  useEffect(() => engine?.setCamera(camera), [engine, camera]);
  useEffect(() => engine?.requestRender(), [engine, resolutionKey]);
  useEffect(() => {
    if (!engine) return;
    if (isPlaying) engine.play();
    else engine.pause();
  }, [engine, isPlaying]);
  useEffect(() => {
    if (engine) engine.onDurationChange = onDurationChange;
  }, [engine, onDurationChange]);

  /** Render exactly the frame at `time` (offline export). */
  const renderAt = useCallback(
    (time: number) => (engine ? engine.renderAt(time) : Promise.resolve()),
    [engine],
  );

  return { renderAt };
}
