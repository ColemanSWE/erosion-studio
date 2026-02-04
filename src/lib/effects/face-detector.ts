import {
  FaceLandmarker,
  FilesetResolver,
  HandLandmarkerResult,
  PoseLandmarkerResult,
} from "@mediapipe/tasks-vision";

export interface FaceLandmarks {
  x: number;
  y: number;
  z?: number;
}

export interface FaceBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  landmarks?: FaceLandmarks[];
}

export interface HandBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
}

export interface PoseBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
}

export interface DetectionBounds {
  faces: FaceBounds[];
  hands: HandBounds[];
  pose: PoseBounds[];
}

let landmarker: FaceLandmarker | null = null;
let isInitializing = false;
let initPromise: Promise<void> | null = null;

async function initializeLandmarker(): Promise<void> {
  if (landmarker) return;
  if (isInitializing && initPromise) return initPromise;

  isInitializing = true;
  initPromise = (async () => {
    try {
      const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
      );

      landmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
          delegate: "GPU",
        },
        runningMode: "IMAGE",
        numFaces: 5,
        minFaceDetectionConfidence: 0.5,
        minFacePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });

      isInitializing = false;
    } catch (error) {
      isInitializing = false;
      console.error("Failed to initialize face landmarker:", error);
      throw error;
    }
  })();

  return initPromise;
}

export async function detectFaces(
  image: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement
): Promise<FaceBounds[]> {
  if (!landmarker) {
    await initializeLandmarker();
  }

  if (!landmarker) {
    return [];
  }

  try {
    const results = landmarker.detect(image);
    const imgWidth =
      image instanceof HTMLVideoElement ? image.videoWidth : image.width;
    const imgHeight =
      image instanceof HTMLVideoElement ? image.videoHeight : image.height;

    if (imgWidth === 0 || imgHeight === 0) {
      return [];
    }

    if (!results.faceLandmarks || results.faceLandmarks.length === 0) {
      return [];
    }

    const bounds: FaceBounds[] = results.faceLandmarks.map((landmarks) => {
      const normalizedLandmarks: FaceLandmarks[] = landmarks.map((lm) => ({
        x: lm.x,
        y: lm.y,
        z: lm.z,
      }));

      let minX = 1,
        maxX = 0,
        minY = 1,
        maxY = 0;
      for (const lm of normalizedLandmarks) {
        minX = Math.min(minX, lm.x);
        maxX = Math.max(maxX, lm.x);
        minY = Math.min(minY, lm.y);
        maxY = Math.max(maxY, lm.y);
      }

      return {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
        landmarks: normalizedLandmarks,
      };
    });

    return bounds;
  } catch (error) {
    console.error("Face detection error:", error);
    return [];
  }
}

export function isDetectorReady(): boolean {
  return landmarker !== null;
}

export function getEyeLandmarks(landmarks: FaceLandmarks[]): {
  leftEye: FaceLandmarks[];
  rightEye: FaceLandmarks[];
} {
  const leftEyeIndices = [
    33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246,
  ];
  const rightEyeIndices = [
    362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384,
    398,
  ];

  return {
    leftEye: leftEyeIndices
      .filter((i) => i < landmarks.length)
      .map((i) => landmarks[i]),
    rightEye: rightEyeIndices
      .filter((i) => i < landmarks.length)
      .map((i) => landmarks[i]),
  };
}

export function getMouthLandmarks(landmarks: FaceLandmarks[]): FaceLandmarks[] {
  const mouthIndices = [
    61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 185, 40, 39, 37, 0, 267,
    269, 270, 409, 308, 415, 310, 311, 312, 13, 82, 81, 80, 191, 78,
  ];

  return mouthIndices
    .filter((i) => i < landmarks.length)
    .map((i) => landmarks[i]);
}

export function getLandmarkBounds(points: FaceLandmarks[]): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} {
  if (points.length === 0) {
    return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  }

  let minX = points[0].x;
  let maxX = points[0].x;
  let minY = points[0].y;
  let maxY = points[0].y;

  for (const point of points) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }

  return { minX, maxX, minY, maxY };
}

export function computeHandBounds(
  handResults: HandLandmarkerResult | null
): HandBounds[] {
  if (
    !handResults ||
    !handResults.landmarks ||
    handResults.landmarks.length === 0
  ) {
    return [];
  }

  const bounds: HandBounds[] = [];

  for (let i = 0; i < handResults.landmarks.length; i++) {
    const landmarks = handResults.landmarks[i];
    const handedness = handResults.handednesses?.[i]?.[0];

    let minX = 1,
      maxX = 0,
      minY = 1,
      maxY = 0;

    for (const lm of landmarks) {
      minX = Math.min(minX, lm.x);
      maxX = Math.max(maxX, lm.x);
      minY = Math.min(minY, lm.y);
      maxY = Math.max(maxY, lm.y);
    }

    const padding = 0.05;
    minX = Math.max(0, minX - padding);
    maxX = Math.min(1, maxX + padding);
    minY = Math.max(0, minY - padding);
    maxY = Math.min(1, maxY + padding);

    bounds.push({
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
      label: handedness?.categoryName || "Hand",
    });
  }

  return bounds;
}

export function computePoseBounds(
  poseResults: PoseLandmarkerResult | null
): PoseBounds[] {
  if (
    !poseResults ||
    !poseResults.landmarks ||
    poseResults.landmarks.length === 0
  ) {
    return [];
  }

  const bounds: PoseBounds[] = [];

  for (const landmarks of poseResults.landmarks) {
    let minX = 1,
      maxX = 0,
      minY = 1,
      maxY = 0;

    for (const lm of landmarks) {
      if (lm.visibility !== undefined && lm.visibility < 0.5) {
        continue;
      }

      minX = Math.min(minX, lm.x);
      maxX = Math.max(maxX, lm.x);
      minY = Math.min(minY, lm.y);
      maxY = Math.max(maxY, lm.y);
    }

    if (minX < maxX && minY < maxY) {
      bounds.push({
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
        label: "Body",
      });
    }
  }

  return bounds;
}
