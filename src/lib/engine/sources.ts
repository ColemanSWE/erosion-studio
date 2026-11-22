import type { TimelineClip, Overlay } from "../effects/types";
import type { MediaItem } from "../project";

interface ActiveMediaEntry {
  clip: TimelineClip | undefined;
  media: MediaItem;
  isFallback: boolean;
}

interface VideoSource {
  id: string;
  path: string;
  clipStartTime: number;
}

interface ImageSource {
  id: string;
  path: string;
}

interface OverlayVideoSource {
  id: string;
  path: string;
  clipStartTime: number;
}

interface OverlayImageSource {
  id: string;
  path: string;
}

export interface RenderSources {
  renderSources: ActiveMediaEntry[];
  imageSources: ImageSource[];
  videoSources: VideoSource[];
  activeOverlays: Overlay[];
  overlayVideos: OverlayVideoSource[];
  overlayImages: OverlayImageSource[];
  isCamera: boolean;
  isVideo: boolean;
}

export function resolveRenderSources(
  clips: TimelineClip[],
  media: MediaItem[],
  overlays: Overlay[],
  currentTime: number,
  selectedMediaId: string | undefined,
): RenderSources {
  const activeClips = clips
    .filter((c) => currentTime >= c.startTime && currentTime <= c.endTime)
    .sort((a, b) => a.startTime - b.startTime);

  const activeMediaList = activeClips
    .map((c) => ({
      clip: c,
      media: media.find((m) => m.id === c.mediaId),
      isFallback: false,
    }))
    .filter(
      (m): m is { clip: TimelineClip; media: MediaItem; isFallback: boolean } =>
        m.media != null,
    );

  const selectedMedia = media.find((m) => m.id === selectedMediaId);

  const renderSources: ActiveMediaEntry[] =
    activeMediaList.length > 0
      ? activeMediaList
      : selectedMedia
        ? [{ clip: undefined, media: selectedMedia, isFallback: true }]
        : [];

  const isCamera = renderSources.length > 0 && renderSources[0].media?.type === "camera";
  const isVideo = renderSources.length > 0 && renderSources.some((s) => s.media?.type === "video");

  const imageSources = renderSources
    .filter((s) => s.media.type === "image")
    .map((s) => ({
      id: s.clip ? s.clip.id : s.media.id,
      path: s.media.path,
    }));

  const videoSources = renderSources
    .filter((s) => s.media.type === "video")
    .map((s) => ({
      id: s.clip ? s.clip.id : s.media.id,
      path: s.media.path,
      clipStartTime: s.clip ? s.clip.startTime : 0,
    }));

  const activeOverlays = overlays.filter(
    (o) => currentTime >= o.startTime && currentTime <= o.endTime,
  );

  const overlayVideos = activeOverlays
    .filter((o) => o.type === "video" && o.mediaId)
    .map((o) => {
      const mediaItem = media.find((m) => m.id === o.mediaId);
      return { id: o.id, path: mediaItem?.path || "", clipStartTime: o.startTime };
    })
    .filter((o) => o.path);

  const overlayImages = activeOverlays
    .filter((o) => o.type === "image" && o.mediaId)
    .map((o) => {
      const mediaItem = media.find((m) => m.id === o.mediaId);
      return { id: o.id, path: mediaItem?.path || "" };
    })
    .filter((o) => o.path);

  return { renderSources, imageSources, videoSources, activeOverlays, overlayVideos, overlayImages, isCamera, isVideo };
}

/** Identity of the media set active at a time — changes only at clip/overlay boundaries. */
export function renderSourcesKey(sources: RenderSources): string {
  const ids = (xs: { id: string }[]) => xs.map((x) => x.id).join(",");
  return [
    ids(sources.videoSources),
    ids(sources.imageSources),
    ids(sources.overlayVideos),
    ids(sources.overlayImages),
    ids(sources.activeOverlays),
    sources.isCamera ? "cam" : "",
  ].join("|");
}
