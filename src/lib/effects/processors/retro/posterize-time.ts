import { registerEffect } from "../../effect-registry";
import { setPosterizeTimeCache, posterizeTimeCache } from "../shared";

registerEffect({
  type: "posterize-time",
  label: "Posterize Time",
  category: "retro",
    defaultParams: { fps: 12 },
  paramsConfig: [
    { key: "fps", label: "Frame Rate", type: "slider", min: 1, max: 30, default: 12 },
  ],
  processor: (data, { width, height, time = 0 }, params) => {
    const fps = (params.fps as number) ?? 12;
    const cacheKey = `${width}x${height}`;

    if (!posterizeTimeCache.has(cacheKey)) {
      setPosterizeTimeCache(cacheKey, {
        lastUpdateTime: 0,
        cachedFrame: null,
      });
    }

    const cache = posterizeTimeCache.get(cacheKey)!;
    const frameInterval = 60 / fps;
    const timeSinceLastUpdate = time - cache.lastUpdateTime;

    if (timeSinceLastUpdate >= frameInterval || cache.cachedFrame === null) {
      cache.cachedFrame = new Uint8ClampedArray(data);
      cache.lastUpdateTime = time;
    } else if (cache.cachedFrame) {
      data.set(cache.cachedFrame);
    }
  },
});
