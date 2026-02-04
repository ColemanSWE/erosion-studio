export interface Clip {
  id: string;
  sourceId: string;
  startTime: number;
  duration: number;
  inPoint: number;
  outPoint: number;
  effects: string[];
}

export interface Track {
  id: string;
  type: "video" | "audio" | "effects";
  clips: Clip[];
}

export interface Timeline {
  duration: number;
  tracks: Track[];
}

export function createEmptyTimeline(): Timeline {
  return {
    duration: 0,
    tracks: [
      { id: "video-1", type: "video", clips: [] },
      { id: "audio-1", type: "audio", clips: [] },
    ],
  };
}

export function addClipToTrack(
  timeline: Timeline,
  trackId: string,
  clip: Clip
): Timeline {
  return {
    ...timeline,
    tracks: timeline.tracks.map((track) =>
      track.id === trackId ? { ...track, clips: [...track.clips, clip] } : track
    ),
    duration: Math.max(timeline.duration, clip.startTime + clip.duration),
  };
}

export function removeClipFromTrack(
  timeline: Timeline,
  trackId: string,
  clipId: string
): Timeline {
  return {
    ...timeline,
    tracks: timeline.tracks.map((track) =>
      track.id === trackId
        ? { ...track, clips: track.clips.filter((c) => c.id !== clipId) }
        : track
    ),
  };
}

export function splitClip(
  timeline: Timeline,
  trackId: string,
  clipId: string,
  splitTime: number
): Timeline {
  const track = timeline.tracks.find((t) => t.id === trackId);
  if (!track) return timeline;

  const clip = track.clips.find((c) => c.id === clipId);
  if (!clip) return timeline;

  if (
    splitTime <= clip.startTime ||
    splitTime >= clip.startTime + clip.duration
  ) {
    return timeline;
  }

  const splitOffset = splitTime - clip.startTime;

  const clip1: Clip = {
    ...clip,
    id: `${clip.id}-1`,
    duration: splitOffset,
    outPoint: clip.inPoint + splitOffset,
  };

  const clip2: Clip = {
    ...clip,
    id: `${clip.id}-2`,
    startTime: splitTime,
    duration: clip.duration - splitOffset,
    inPoint: clip.inPoint + splitOffset,
  };

  return {
    ...timeline,
    tracks: timeline.tracks.map((t) =>
      t.id === trackId
        ? {
            ...t,
            clips: t.clips
              .filter((c) => c.id !== clipId)
              .concat([clip1, clip2])
              .sort((a, b) => a.startTime - b.startTime),
          }
        : t
    ),
  };
}

export function trimClip(
  timeline: Timeline,
  trackId: string,
  clipId: string,
  newInPoint: number,
  newOutPoint: number
): Timeline {
  return {
    ...timeline,
    tracks: timeline.tracks.map((track) =>
      track.id === trackId
        ? {
            ...track,
            clips: track.clips.map((clip) =>
              clip.id === clipId
                ? {
                    ...clip,
                    inPoint: newInPoint,
                    outPoint: newOutPoint,
                    duration: newOutPoint - newInPoint,
                  }
                : clip
            ),
          }
        : track
    ),
  };
}
