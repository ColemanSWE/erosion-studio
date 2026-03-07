import { registerEffect, ProcessConfig } from "../effect-registry";
import { EffectType, EffectParamConfig } from "../types";
import { FaceBounds, HandBounds, PoseBounds, getEyeLandmarks, getMouthLandmarks, getLandmarkBounds } from "../face-detector";
import { BAYER_MATRIX_4x4, motionSmearState, datamoshState, blockShovingState, bilinearSample, meltState, perlinNoise, posterizeTimeCache, pseudoRandom, clamp, sortSegment, sortSegmentV, getBlockAverage, hexToRgb, rgbToHsl, hslToRgb, isPointInFaceBounds, frameHistoryStore, storeFrame, getFrameFromHistory } from "./shared";

registerEffect({
  type: "film-grain",
  label: "Film Grain",
  category: "noise",
    defaultParams: { intensity: 30 },
  paramsConfig: [],
  processor: (data, { width, height, time = 0 }, params) => {
    const intensity = (params.intensity as number) || 30;
    if (intensity === 0) return;

    const strength = intensity * 2.55;
    const seed = Math.floor(time / 2);

    for (let i = 0; i < data.length; i += 4) {
      const noise = (pseudoRandom(seed + i) - 0.5) * strength;
      data[i] = clamp(data[i] + noise, 0, 255);
      data[i + 1] = clamp(data[i + 1] + noise, 0, 255);
      data[i + 2] = clamp(data[i + 2] + noise, 0, 255);
    }
  },
});

registerEffect({
  type: "noise",
  label: "Static Noise",
  category: "noise",
    defaultParams: { intensity: 20, colored: false },
  paramsConfig: [],
  processor: (data, { time = 0 }, params) => {
    const intensity = (params.intensity as number) || 20;
    const colored = (params.colored as boolean) || false;
    if (intensity === 0) return;

    const noiseAmount = intensity / 100;
    const seed = Math.floor(time * 1000);

    for (let i = 0; i < data.length; i += 4) {
      const r = pseudoRandom(seed + i * 7 + 0);
      if (r < noiseAmount) {
        const noiseStrength = r / noiseAmount;
        if (colored) {
          const noiseR = (pseudoRandom(seed + i * 7 + 1) - 0.5) * 2;
          const noiseG = (pseudoRandom(seed + i * 7 + 2) - 0.5) * 2;
          const noiseB = (pseudoRandom(seed + i * 7 + 3) - 0.5) * 2;
          data[i] = clamp(data[i] + noiseR * noiseStrength * 255, 0, 255);
          data[i + 1] = clamp(
            data[i + 1] + noiseG * noiseStrength * 255,
            0,
            255
          );
          data[i + 2] = clamp(
            data[i + 2] + noiseB * noiseStrength * 255,
            0,
            255
          );
        } else {
          const noise = (pseudoRandom(seed + i * 7 + 1) - 0.5) * 2;
          const noiseValue = noise * noiseStrength * 255;
          data[i] = clamp(data[i] + noiseValue, 0, 255);
          data[i + 1] = clamp(data[i + 1] + noiseValue, 0, 255);
          data[i + 2] = clamp(data[i + 2] + noiseValue, 0, 255);
        }
      }
    }
  },
});