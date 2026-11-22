import { GifDecoder } from "../gif-decoder";
import { needsCrossOrigin, toMediaUrl } from "../media-url";

export interface VideoSourceDef {
  id: string;
  path: string;
  /** Timeline time at which local time 0 of this video plays. */
  clipStartTime: number;
}

export interface ImageSourceDef {
  id: string;
  path: string;
}

export type ImageLike = HTMLImageElement | ImageBitmap;

export interface MediaPoolEvents {
  /** Something new can be drawn (image loaded, video can play, GIF advanced). */
  onReady: () => void;
  onVideoMetadata: (id: string, duration: number) => void;
  onVideoError: (id: string, path: string) => void;
  /** Current timeline time, used to position newly created videos. */
  getTime: () => number;
  isPlaying: () => boolean;
}

const GIF_TICK_MS = 33;

export const resolveMediaSrc = toMediaUrl;

function isGifPath(path: string): boolean {
  return path.toLowerCase().endsWith(".gif");
}

export function imageDimensions(img: ImageLike): { w: number; h: number } {
  if (img instanceof HTMLImageElement) return { w: img.naturalWidth, h: img.naturalHeight };
  return { w: img.width, h: img.height };
}

/**
 * Owns every decoded media element the render engine draws from: timeline and
 * overlay videos, still images and animated GIFs. Elements are keyed by clip or
 * overlay id, which is also the id the compositor looks overlays up by.
 */
export class MediaPool {
  readonly videos = new Map<string, HTMLVideoElement>();
  readonly images = new Map<string, ImageLike>();

  private gifs = new Map<string, GifDecoder>();
  private loadingGifs = new Set<string>();
  private wantedImages = new Set<string>();
  private videoDefs = new Map<string, VideoSourceDef>();
  /** Un-normalized src per element (video.src is URL-encoded by the browser). */
  private videoSrc = new WeakMap<HTMLVideoElement, string>();
  private gifTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly events: MediaPoolEvents) {}

  get(id: string): HTMLVideoElement | ImageLike | null {
    return this.videos.get(id) ?? this.images.get(id) ?? null;
  }

  // ── Videos ────────────────────────────────────────────────────────────────

  syncVideos(defs: VideoSourceDef[]): void {
    const map = this.videos;
    const wanted = new Set(defs.map((v) => v.id));
    this.videoDefs = new Map(defs.map((d) => [d.id, d]));

    // Same file under a new clip id (e.g. after a split) → re-key the element
    // instead of tearing it down and re-buffering.
    const incomingSrcToId = new Map<string, string>();
    for (const def of defs) incomingSrcToId.set(resolveMediaSrc(def.path), def.id);

    for (const [id, video] of map.entries()) {
      if (wanted.has(id)) continue;
      const newId = incomingSrcToId.get(this.videoSrc.get(video) ?? video.src);
      if (newId && !map.has(newId)) {
        map.set(newId, video);
        map.delete(id);
        const def = this.videoDefs.get(newId)!;
        video.currentTime = Math.max(0, this.events.getTime() - def.clipStartTime);
      } else {
        this.destroyVideo(video);
        map.delete(id);
      }
    }

    for (const def of defs) {
      if (!map.has(def.id)) map.set(def.id, this.createVideo(def));
    }
  }

  private createVideo(def: VideoSourceDef): HTMLVideoElement {
    const video = document.createElement("video");
    video.preload = "auto";
    video.playsInline = true;

    const src = resolveMediaSrc(def.path);
    // Required for media:// too, or drawing the video taints the canvas and
    // every getImageData / readPixels (effects, export) throws.
    if (needsCrossOrigin(src)) video.crossOrigin = "anonymous";

    video.onloadedmetadata = () => {
      if (video.duration && isFinite(video.duration)) {
        const id = this.idOf(video);
        if (id) this.events.onVideoMetadata(id, video.duration);
      }
    };
    // A seek with buffered data may not fire canplay again; redraw on seeked too.
    video.onseeked = () => this.events.onReady();
    video.oncanplay = () => {
      if (this.events.isPlaying()) video.play().catch(() => {});
      this.events.onReady();
    };
    video.onerror = () => {
      const id = this.idOf(video) ?? def.id;
      console.error("Failed to load video:", def.path, "resolved as:", src);
      this.events.onVideoError(id, def.path);
    };

    video.src = src;
    this.videoSrc.set(video, src);
    video.currentTime = Math.max(0, this.events.getTime() - def.clipStartTime);
    video.load();
    return video;
  }

  private idOf(video: HTMLVideoElement): string | undefined {
    for (const [id, v] of this.videos) if (v === video) return id;
    return undefined;
  }

  private destroyVideo(video: HTMLVideoElement): void {
    video.onerror = null;
    video.onloadedmetadata = null;
    video.oncanplay = null;
    video.onseeked = null;
    video.pause();
    video.removeAttribute("src");
    video.load();
  }

  playAll(): void {
    for (const video of this.videos.values()) video.play().catch(() => {});
  }

  pauseAll(): void {
    for (const video of this.videos.values()) video.pause();
  }

  /**
   * Seek every video to its local time for timeline `time`. Videos already
   * within `tolerance` seconds are left alone. When `waitForSeeked` is true the
   * returned promise resolves once every seek has landed (or timed out).
   */
  seekAll(time: number, tolerance: number, waitForSeeked: boolean): Promise<boolean> {
    const pending: Promise<void>[] = [];
    let seeked = false;
    for (const [id, video] of this.videos) {
      const def = this.videoDefs.get(id);
      if (!def) continue;
      const local = Math.max(0, time - def.clipStartTime);
      if (Math.abs(video.currentTime - local) <= tolerance) continue;
      seeked = true;
      if (waitForSeeked && !video.error) {
        pending.push(
          new Promise<void>((resolve) => {
            const done = () => {
              clearTimeout(timer);
              video.removeEventListener("seeked", done);
              resolve();
            };
            // Never let a stuck decoder hang an export.
            const timer = setTimeout(done, 2000);
            video.addEventListener("seeked", done);
          }),
        );
      }
      video.currentTime = local;
    }
    return Promise.all(pending).then(() => seeked);
  }

  /** Resolves once every video can draw a frame (or has failed / timed out). */
  whenVideosReady(timeoutMs = 3000): Promise<void> {
    const waits = Array.from(this.videos.values())
      .filter((v) => v.readyState < 2 && !v.error)
      .map(
        (video) =>
          new Promise<void>((resolve) => {
            const done = () => {
              clearTimeout(timer);
              video.removeEventListener("loadeddata", done);
              video.removeEventListener("error", done);
              resolve();
            };
            const timer = setTimeout(done, timeoutMs);
            video.addEventListener("loadeddata", done);
            video.addEventListener("error", done);
          }),
      );
    return Promise.all(waits).then(() => undefined);
  }

  /** Nudge overlay videos back in sync with the primary clock. */
  correctDrift(time: number, ids: string[], tolerance = 0.15): void {
    for (const id of ids) {
      const video = this.videos.get(id);
      const def = this.videoDefs.get(id);
      if (!video || !def || video.readyState < 2) continue;
      const expected = Math.max(0, time - def.clipStartTime);
      if (Math.abs(video.currentTime - expected) > tolerance) video.currentTime = expected;
    }
  }

  // ── Images & GIFs ─────────────────────────────────────────────────────────

  syncImages(defs: ImageSourceDef[]): void {
    const wanted = new Set(defs.map((d) => d.id));
    this.wantedImages = wanted;

    for (const id of this.images.keys()) if (!wanted.has(id)) this.images.delete(id);
    for (const [id, decoder] of this.gifs) {
      if (!wanted.has(id)) {
        decoder.dispose();
        this.gifs.delete(id);
      }
    }
    for (const id of this.loadingGifs) if (!wanted.has(id)) this.loadingGifs.delete(id);

    for (const def of defs) {
      if (this.images.has(def.id) || this.gifs.has(def.id) || this.loadingGifs.has(def.id)) continue;
      if (isGifPath(def.path)) this.loadGif(def);
      else this.loadImage(def);
    }

    this.updateGifTimer();
  }

  private loadImage(def: ImageSourceDef): void {
    const img = new Image();
    const src = resolveMediaSrc(def.path);
    if (needsCrossOrigin(src)) img.crossOrigin = "anonymous";
    img.onload = () => this.events.onReady();
    img.onerror = () => console.error("Failed to load image:", def.path);
    img.src = src;
    this.images.set(def.id, img);
  }

  private loadGif(def: ImageSourceDef): void {
    this.loadingGifs.add(def.id);
    GifDecoder.create(def.path)
      .then((decoder) => {
        this.loadingGifs.delete(def.id);
        if (!this.wantedImages.has(def.id)) {
          decoder.dispose();
          return;
        }
        this.gifs.set(def.id, decoder);
        if (decoder.bitmap) this.images.set(def.id, decoder.bitmap);
        this.updateGifTimer();
        this.events.onReady();
      })
      .catch((err) => {
        this.loadingGifs.delete(def.id);
        console.error("Failed to load GIF:", def.path, err);
      });
  }

  private updateGifTimer(): void {
    if (this.gifs.size > 0 && !this.gifTimer) {
      this.gifTimer = setInterval(() => void this.tickGifs(), GIF_TICK_MS);
    } else if (this.gifs.size === 0 && this.gifTimer) {
      clearInterval(this.gifTimer);
      this.gifTimer = null;
    }
  }

  private async tickGifs(): Promise<void> {
    const now = performance.now();
    const results = await Promise.all(
      Array.from(this.gifs.entries()).map(async ([id, decoder]) => {
        const advanced = await decoder.tick(now);
        if (advanced && decoder.bitmap && this.gifs.get(id) === decoder) {
          this.images.set(id, decoder.bitmap);
          return true;
        }
        return false;
      }),
    );
    if (results.some(Boolean)) this.events.onReady();
  }

  isImageReady(id: string): boolean {
    const img = this.images.get(id);
    if (!img) return false;
    if (img instanceof HTMLImageElement) return img.complete && img.naturalWidth > 0;
    return img.width > 0;
  }

  dispose(): void {
    if (this.gifTimer) clearInterval(this.gifTimer);
    this.gifTimer = null;
    for (const video of this.videos.values()) this.destroyVideo(video);
    this.videos.clear();
    for (const decoder of this.gifs.values()) decoder.dispose();
    this.gifs.clear();
    this.images.clear();
    this.loadingGifs.clear();
  }
}
