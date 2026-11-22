import { renderWithEffects } from "../effects/effects-renderer";
import { drawOverlay } from "../effects/overlay-compositor";
import { computeDrawRect, type RenderContext } from "../effects/render-types";
import type { GLPipeline } from "../effects/gl/pipeline";
import { detectFaces, requiresFaceDetection, type FaceBounds } from "../effects/face-detector";
import type { Effect, EffectParamTrack, Overlay, Region, TimelineClip } from "../effects/types";
import type { MediaItem, SourceTransform } from "../project";
import { resolveEffectsAtTime } from "../timeline";
import { isEffectsWorkerAvailable, processEffectsInWorker } from "../effects/worker-pool";
import { playbackClock, type PlaybackClock } from "./clock";
import { effectsNeedAnimation, effectsNeedTimelineFrames } from "./effect-traits";
import { resolveRenderSources, renderSourcesKey } from "./sources";
import {
  MediaPool,
  imageDimensions,
  type ImageLike,
  type ImageSourceDef,
  type VideoSourceDef,
} from "./media-pool";

export type { ImageSourceDef, VideoSourceDef };

/** The parts of the project that decide which media is on screen at a given time. */
export interface TimelineModel {
  clips: TimelineClip[];
  media: MediaItem[];
  overlays: Overlay[];
  selectedMediaId: string | undefined;
}

interface EngineSources {
  /** Timeline videos active at the playhead; [0] is the primary source. */
  videos: VideoSourceDef[];
  /** Timeline images active at the playhead; [0] is primary when there is no video. */
  images: ImageSourceDef[];
  overlayVideos: VideoSourceDef[];
  overlayImages: ImageSourceDef[];
}

const EMPTY_SOURCES: EngineSources = { videos: [], images: [], overlayVideos: [], overlayImages: [] };

/** 30 fps target. Above 2× the engine drops every other frame; above 4× it skips effects. */
const FRAME_BUDGET_MS = 33;
/** Run face detection on every Nth frame for moving sources. */
const FACE_DETECT_INTERVAL = 10;
/** Re-sync overlay videos to the primary every Nth frame. */
const DRIFT_CHECK_INTERVAL = 15;

type FrameHandle =
  | { kind: "raf"; id: number }
  | { kind: "rvfc"; id: number; video: HTMLVideoElement };

type Primary =
  | { kind: "video"; el: HTMLVideoElement; def: VideoSourceDef; w: number; h: number }
  | { kind: "image"; el: ImageLike; def: ImageSourceDef; w: number; h: number }
  | { kind: "camera"; el: HTMLVideoElement; w: number; h: number };

type FrameResult = "drawn" | "pending" | "idle";

type VideoWithRVFC = HTMLVideoElement & {
  requestVideoFrameCallback(cb: () => void): number;
  cancelVideoFrameCallback(id: number): void;
};

function hasRVFC(video: HTMLVideoElement): video is VideoWithRVFC {
  return "requestVideoFrameCallback" in video;
}

/**
 * RenderEngine — the one place frames get drawn.
 *
 * Owns the display canvas context, the scratch buffer, the (single) WebGL
 * pipeline, all decoded media, and the frame loop. React feeds it state via the
 * setters below; it reads live time from the PlaybackClock. The three source
 * kinds (timeline video, still image / GIF, live camera) differ only in how the
 * primary frame is obtained and when the loop keeps running.
 */
export class RenderEngine {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private readonly buffer: HTMLCanvasElement;
  private readonly bufferCtx: CanvasRenderingContext2D;
  private gl: GLPipeline | null = null;
  private readonly pool: MediaPool;

  private timeline: TimelineModel = { clips: [], media: [], overlays: [], selectedMediaId: undefined };
  private sourcesKey = "";
  private sources: EngineSources = EMPTY_SOURCES;
  private camera: HTMLVideoElement | null = null;
  private effects: Effect[] = [];
  private paramTracks: EffectParamTrack[] = [];
  private regions: Region[] = [];
  private overlays: Overlay[] = [];
  private sourceTransform: SourceTransform | undefined;
  private playing = false;

  private tick = 0;
  private emaFrameMs = 0;
  private faceBounds: FaceBounds[] = [];
  private faceDetectionBusy = false;
  private faceSourceId: string | null = null;
  private lastFrameAnimated = false;
  private lastVideoTime = -1;
  private errorVideoId: string | null = null;

  private handle: FrameHandle | null = null;
  private inFlight: Promise<FrameResult> | null = null;
  private queued = false;
  private dirty = true;
  private disposed = false;
  private readonly unsubscribeClock: () => void;

  /** Called when the primary video reports its duration. */
  onDurationChange: ((duration: number) => void) | null = null;

  constructor(private readonly clock: PlaybackClock = playbackClock) {
    this.buffer = document.createElement("canvas");
    const bufferCtx = this.buffer.getContext("2d", { willReadFrequently: true });
    if (!bufferCtx) throw new Error("RenderEngine: 2D canvas context unavailable");
    this.bufferCtx = bufferCtx;

    this.pool = new MediaPool({
      onReady: () => this.requestRender(),
      onVideoMetadata: (id, duration) => {
        if (id === this.sources.videos[0]?.id) this.onDurationChange?.(duration);
      },
      onVideoError: (id) => {
        if (id === this.sources.videos[0]?.id) {
          this.errorVideoId = id;
          this.cancelHandle();
          this.drawVideoError();
        }
      },
      getTime: () => this.clock.time,
      isPlaying: () => this.playing,
    });

    this.unsubscribeClock = clock.subscribe(this.onClock);

    void import("../effects/gl/pipeline").then(({ GLPipeline }) => {
      if (this.disposed) return;
      this.gl = GLPipeline.tryCreate();
      // CPU-only effects in a GPU chain run in a worker, so heavy per-pixel
      // loops don't block timeline/panel interaction on the main thread.
      if (this.gl && isEffectsWorkerAvailable()) this.gl.setCPURunner(processEffectsInWorker);
      this.requestRender();
    });
  }

  // ── State setters (called from React) ─────────────────────────────────────

  setCanvas(canvas: HTMLCanvasElement | null): void {
    this.canvas = canvas;
    this.ctx = canvas?.getContext("2d") ?? null;
    this.requestRender();
  }

  /**
   * Timeline state. The engine resolves which clips/overlays are on screen
   * itself — at the live clock time, or at the requested time during export.
   */
  setTimeline(timeline: TimelineModel): void {
    this.timeline = timeline;
    this.syncSourcesAt(this.clock.time, true);
    this.requestRender();
  }

  /** Re-resolve active media for `time`; returns true when the set changed. */
  private syncSourcesAt(time: number, force = false): boolean {
    const { clips, media, overlays, selectedMediaId } = this.timeline;
    const resolved = resolveRenderSources(clips, media, overlays, time, selectedMediaId);
    const key = renderSourcesKey(resolved);
    // Overlay objects change identity on edits (drag, text) even when the set doesn't.
    this.overlays = resolved.activeOverlays;
    if (!force && key === this.sourcesKey) return false;
    this.sourcesKey = key;

    const prevPrimary = this.sources.videos[0]?.id;
    this.sources = {
      videos: resolved.videoSources,
      images: resolved.imageSources,
      overlayVideos: resolved.overlayVideos,
      overlayImages: resolved.overlayImages,
    };
    this.pool.syncVideos([...this.sources.videos, ...this.sources.overlayVideos]);
    this.pool.syncImages([...this.sources.images, ...this.sources.overlayImages]);
    if (this.sources.videos[0]?.id !== prevPrimary) {
      this.errorVideoId = null;
      this.lastVideoTime = -1;
    }
    return true;
  }

  setCamera(video: HTMLVideoElement | null): void {
    if (video === this.camera) return;
    this.camera = video;
    this.faceBounds = [];
    this.requestRender();
  }

  setEffects(effects: Effect[], paramTracks: EffectParamTrack[]): void {
    this.effects = effects;
    this.paramTracks = paramTracks;
    this.requestRender();
  }

  setRegions(regions: Region[]): void {
    this.regions = regions;
    this.requestRender();
  }

  setSourceTransform(transform: SourceTransform | undefined): void {
    this.sourceTransform = transform;
    this.requestRender();
  }

  play(): void {
    if (this.playing) return;
    this.playing = true;
    this.pool.playAll();
    this.requestRender();
  }

  pause(): void {
    if (!this.playing) return;
    this.playing = false;
    this.pool.pauseAll();
    this.requestRender();
  }

  /**
   * Seek every source to `time`, wait for decoders, and render exactly one
   * frame at that time. Used by offline export; resolves once the display
   * canvas holds the frame.
   */
  async renderAt(time: number): Promise<void> {
    this.syncSourcesAt(time);
    await this.pool.whenVideosReady();
    await this.pool.seekAll(time, 0.001, true);
    this.cancelHandle();
    while (this.inFlight) await this.inFlight;
    this.lastVideoTime = -1;
    this.dirty = true;
    await this.runFrame(time, false);
  }

  /** Schedule a render on the next animation frame (coalesced). */
  requestRender(): void {
    if (this.disposed) return;
    this.dirty = true;
    if (this.inFlight) {
      this.queued = true;
      return;
    }
    this.cancelHandle();
    this.handle = { kind: "raf", id: requestAnimationFrame(this.onAnimationFrame) };
  }

  dispose(): void {
    this.disposed = true;
    this.cancelHandle();
    this.unsubscribeClock();
    this.pool.dispose();
    this.gl?.dispose();
    this.gl = null;
    this.canvas = null;
    this.ctx = null;
  }

  // ── Clock ─────────────────────────────────────────────────────────────────

  private onClock = (time: number, isSeek: boolean): void => {
    // Crossing a clip/overlay boundary swaps media in or out.
    if (this.syncSourcesAt(time)) this.requestRender();
    if (!isSeek) return; // Continuous playback: videos run natively, images loop on RAF.
    // While playing, only correct real jumps so ordinary clock/decoder jitter
    // never causes a seek stutter.
    void this.pool.seekAll(time, this.playing ? 0.25 : 0.01, false);
    this.lastVideoTime = -1;
    this.requestRender();
  };

  // ── Frame loop ────────────────────────────────────────────────────────────

  private onAnimationFrame = (): void => {
    this.handle = null;
    void this.runFrame(undefined, true);
  };

  private async runFrame(timeOverride: number | undefined, continueLoop: boolean): Promise<void> {
    if (this.disposed) return;
    if (this.inFlight) {
      this.queued = true;
      return;
    }

    const frame = this.renderFrame(timeOverride).catch((err) => {
      console.error("Render failed:", err);
      return "idle" as const;
    });
    this.inFlight = frame;
    const result = await frame;
    this.inFlight = null;
    if (this.disposed) return;

    if (this.queued) {
      this.queued = false;
      this.requestRender();
      return;
    }
    if (!continueLoop || this.handle) return;

    if (result === "pending") {
      this.handle = { kind: "raf", id: requestAnimationFrame(this.onAnimationFrame) };
      return;
    }
    this.scheduleContinuation();
  }

  private scheduleContinuation(): void {
    if (this.camera) {
      this.handle = { kind: "raf", id: requestAnimationFrame(this.onAnimationFrame) };
      return;
    }
    const video = this.primaryVideoElement();
    if (video) {
      if (!this.playing || video.paused || this.errorVideoId) return;
      if (hasRVFC(video)) {
        this.handle = { kind: "rvfc", video, id: video.requestVideoFrameCallback(this.onAnimationFrame) };
      } else {
        this.handle = { kind: "raf", id: requestAnimationFrame(this.onAnimationFrame) };
      }
      return;
    }
    if (this.sources.images.length > 0 && (this.playing || this.lastFrameAnimated)) {
      this.handle = { kind: "raf", id: requestAnimationFrame(this.onAnimationFrame) };
    }
  }

  private cancelHandle(): void {
    const h = this.handle;
    if (!h) return;
    if (h.kind === "raf") cancelAnimationFrame(h.id);
    else if (hasRVFC(h.video)) h.video.cancelVideoFrameCallback(h.id);
    this.handle = null;
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  private primaryVideoElement(): HTMLVideoElement | null {
    const def = this.sources.videos[0];
    return def ? this.pool.videos.get(def.id) ?? null : null;
  }

  private resolvePrimary(): Primary | "pending" | null {
    if (this.camera) {
      const el = this.camera;
      if (el.readyState < 2) return "pending";
      return { kind: "camera", el, w: el.videoWidth, h: el.videoHeight };
    }
    const vDef = this.sources.videos[0];
    if (vDef) {
      const el = this.pool.videos.get(vDef.id);
      if (!el || el.error || this.errorVideoId === vDef.id) return null;
      if (el.readyState < 2) return "pending";
      return { kind: "video", el, def: vDef, w: el.videoWidth, h: el.videoHeight };
    }
    const iDef = this.sources.images[0];
    if (iDef) {
      // Not ready yet → the image's onload will request a render.
      if (!this.pool.isImageReady(iDef.id)) return null;
      const el = this.pool.images.get(iDef.id)!;
      const { w, h } = imageDimensions(el);
      return { kind: "image", el, def: iDef, w, h };
    }
    return null;
  }

  private isEmpty(): boolean {
    return !this.camera && this.sources.videos.length === 0 && this.sources.images.length === 0;
  }

  private async renderFrame(timeOverride?: number): Promise<FrameResult> {
    const canvas = this.canvas;
    const ctx = this.ctx;
    if (!canvas || !ctx) return "idle";

    const primary = this.resolvePrimary();
    if (primary === "pending") return "pending";
    if (!primary) {
      if (this.isEmpty()) {
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      return "idle";
    }
    const w = primary.w || canvas.width;
    const h = primary.h || canvas.height;
    if (w <= 0 || h <= 0) return "idle";

    // Skip work when a playing video hasn't produced a new frame and nothing else changed.
    if (primary.kind === "video") {
      const vt = primary.el.currentTime;
      const newFrame = Math.abs(vt - this.lastVideoTime) > 0.0001;
      if (this.playing && !newFrame && !this.dirty && timeOverride === undefined) {
        this.tick++;
        return "drawn";
      }
      this.lastVideoTime = vt;
    }
    this.dirty = false;

    const time =
      timeOverride ??
      (primary.kind === "video" ? primary.def.clipStartTime + primary.el.currentTime : this.clock.time);
    const effects = resolveEffectsAtTime(this.effects, this.paramTracks, time);
    this.lastFrameAnimated = effectsNeedAnimation(effects);

    const isLive = primary.kind === "camera" || (primary.kind === "video" && this.playing);
    if (isLive && primary.kind === "video" && this.tick % DRIFT_CHECK_INTERVAL === 0) {
      this.pool.correctDrift(time, this.sources.overlayVideos.map((v) => v.id));
    }

    // Adaptive load shedding — only while frames are flowing; a paused scrub
    // must always draw the frame it asked for.
    const frameStart = performance.now();
    const skipEffects = isLive && this.emaFrameMs > FRAME_BUDGET_MS * 4;
    const dropFrame = isLive && !skipEffects && this.emaFrameMs > FRAME_BUDGET_MS * 2 && this.tick % 2 !== 0;

    if (!dropFrame) {
      if (!skipEffects && requiresFaceDetection(effects)) this.detectFaces(primary);

      const timelineFrames =
        primary.kind !== "camera" && effectsNeedTimelineFrames(effects)
          ? this.collectSecondaryFrames(primary.kind, w, h)
          : undefined;

      const isFlipped = primary.kind === "camera";
      const context: RenderContext = {
        ctx,
        buffer: this.buffer,
        bufferCtx: this.bufferCtx,
        source: primary.el,
        sourceWidth: w,
        sourceHeight: h,
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        tick: this.tick,
        faceBounds: this.faceBounds,
        timelineFrames,
        isFlipped,
        glPipeline: this.gl ?? undefined,
        overlays: this.overlays,
        getOverlaySource: isFlipped ? undefined : (id) => this.pool.get(id),
        sourceTransform: this.sourceTransform,
      };

      if (isFlipped) {
        // Mirror the camera so the user sees themselves as in a mirror.
        ctx.save();
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
      }
      try {
        if (skipEffects) this.drawUnprocessed(context);
        else await renderWithEffects(context, effects, this.regions, this.overlays);
      } finally {
        if (isFlipped) ctx.restore();
      }
    }

    const elapsed = performance.now() - frameStart;
    this.emaFrameMs = this.emaFrameMs * 0.8 + elapsed * 0.2;
    this.tick++;
    return "drawn";
  }

  /** Cheap path used while load-shedding: source + overlays, no effects. */
  private drawUnprocessed(context: RenderContext): void {
    const { ctx, source, sourceWidth, sourceHeight, canvasWidth, canvasHeight } = context;
    const { drawX, drawY, drawWidth, drawHeight } = computeDrawRect(
      sourceWidth, sourceHeight, canvasWidth, canvasHeight, context.sourceTransform,
    );
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    ctx.drawImage(source, drawX, drawY, drawWidth, drawHeight);
    for (const overlay of this.overlays) {
      if (overlay.isEffectZone) continue;
      drawOverlay(ctx, overlay, context, sourceWidth, sourceHeight, drawX, drawY, drawWidth, drawHeight);
    }
  }

  /** Frames of the non-primary timeline sources, for transition effects. */
  private collectSecondaryFrames(kind: "video" | "image", w: number, h: number): ImageData[] {
    const ids =
      kind === "video"
        ? this.sources.videos.slice(1).map((v) => v.id)
        : this.sources.images.slice(1).map((i) => i.id);
    const frames: ImageData[] = [];
    this.buffer.width = w;
    this.buffer.height = h;
    for (const id of ids) {
      const el = this.pool.get(id);
      if (!el) continue;
      if (el instanceof HTMLVideoElement && el.readyState < 2) continue;
      if (!(el instanceof HTMLVideoElement) && !this.pool.isImageReady(id)) continue;
      this.bufferCtx.drawImage(el, 0, 0, w, h);
      frames.push(this.bufferCtx.getImageData(0, 0, w, h));
    }
    return frames;
  }

  /** Fire-and-forget: results land in `faceBounds` for subsequent frames. */
  private detectFaces(primary: Primary): void {
    if (this.faceDetectionBusy) return;
    if (primary.kind === "image") {
      if (this.faceSourceId === primary.def.id) return; // Still image: detect once.
    } else if (this.tick % FACE_DETECT_INTERVAL !== 0) {
      return;
    }
    // MediaPipe accepts image, video and canvas elements; ImageBitmap (GIF frames) is skipped.
    if (!(primary.el instanceof HTMLImageElement || primary.el instanceof HTMLVideoElement)) return;

    const sourceId = primary.kind === "image" ? primary.def.id : null;
    this.faceDetectionBusy = true;
    detectFaces(primary.el)
      .then((bounds) => {
        this.faceBounds = bounds;
      })
      .catch(() => {
        this.faceBounds = [];
      })
      .finally(() => {
        this.faceDetectionBusy = false;
        if (sourceId) {
          this.faceSourceId = sourceId;
          this.requestRender();
        }
      });
  }

  private drawVideoError(): void {
    const c = this.canvas;
    const ctx = this.ctx;
    if (!c || !ctx) return;
    const fs = Math.max(12, Math.floor(c.height / 22));
    ctx.fillStyle = "#141414";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.textAlign = "center";
    ctx.fillStyle = "#555";
    ctx.font = `${fs}px monospace`;
    ctx.fillText("Video format not supported", c.width / 2, c.height / 2 - fs * 0.8);
    ctx.fillStyle = "#3a3a3a";
    ctx.font = `${Math.max(10, Math.floor(fs * 0.75))}px monospace`;
    ctx.fillText("Re-encode to H.264 MP4 to play in preview", c.width / 2, c.height / 2 + fs * 0.8);
  }
}
