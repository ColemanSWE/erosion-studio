import { registerEffect, ProcessConfig } from "../effect-registry";
import { clamp, storeFrame, getFrameFromHistory, frameHistoryStore } from "./shared";

// ─── Experimental / Avant-Garde Effects ────────────────────────────────────────

// ─── 1. Flow Field ─────────────────────────────────────────────────────────────
// Computes gradient vectors from the image and renders flowing animated lines
// that follow the contours of the scene. Like a wind-map of the image.

registerEffect({
  type: "flow-field",
  label: "Flow Field",
  category: "style",
  defaultParams: {
    density: 4000,
    lineLength: 25,
    speed: 2,
    opacity: 0.7,
    color: "#00ff88",
    colorFromImage: true,
    lineWidth: 1.5,
    fadeAmount: 0.15,
  },
  paramsConfig: [
    { key: "density", label: "Particle Count", type: "slider", min: 500, max: 15000, step: 500 },
    { key: "lineLength", label: "Line Length", type: "slider", min: 3, max: 80, step: 1 },
    { key: "speed", label: "Speed", type: "slider", min: 0.5, max: 8, step: 0.5 },
    { key: "opacity", label: "Opacity", type: "slider", min: 0.1, max: 1, step: 0.05 },
    { key: "color", label: "Color", type: "color" },
    { key: "colorFromImage", label: "Color From Image", type: "checkbox" },
    { key: "lineWidth", label: "Line Width", type: "slider", min: 0.5, max: 5, step: 0.5 },
    { key: "fadeAmount", label: "BG Fade", type: "slider", min: 0, max: 1, step: 0.05 },
  ],
  processor: (data, { width, height, time = 0 }, params) => {
    const density = (params.density as number) ?? 4000;
    const lineLength = (params.lineLength as number) ?? 25;
    const speed = (params.speed as number) ?? 2;
    const opacity = (params.opacity as number) ?? 0.7;
    const color = (params.color as string) ?? "#00ff88";
    const colorFromImage = (params.colorFromImage as boolean) ?? true;
    const lineWidth = (params.lineWidth as number) ?? 1.5;
    const fadeAmount = (params.fadeAmount as number) ?? 0.15;

    // Build grayscale for gradient computation
    const gray = new Float32Array(width * height);
    for (let i = 0; i < width * height; i++) {
      const idx = i * 4;
      gray[i] = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;
    }

    // Compute gradient angle field
    const angles = new Float32Array(width * height);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const gx = gray[y * width + x + 1] - gray[y * width + x - 1];
        const gy = gray[(y + 1) * width + x] - gray[(y - 1) * width + x];
        angles[y * width + x] = Math.atan2(gy, gx);
      }
    }

    // Render
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = width;
    tempCanvas.height = height;
    const ctx = tempCanvas.getContext("2d");
    if (!ctx) return;

    // Draw darkened original as background
    const imgData = ctx.createImageData(width, height);
    for (let i = 0; i < data.length; i += 4) {
      imgData.data[i] = data[i] * (1 - fadeAmount);
      imgData.data[i + 1] = data[i + 1] * (1 - fadeAmount);
      imgData.data[i + 2] = data[i + 2] * (1 - fadeAmount);
      imgData.data[i + 3] = data[i + 3];
    }
    ctx.putImageData(imgData, 0, 0);

    ctx.lineWidth = lineWidth;
    ctx.globalAlpha = opacity;
    ctx.lineCap = "round";

    // Deterministic particle positions seeded by density
    let seed = density * 7 + width * 13;
    const prng = (): number => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };

    const t = time * speed;

    for (let p = 0; p < density; p++) {
      let px = prng() * width;
      let py = prng() * height;

      // Animate starting positions with time
      px = (px + t * 10 * prng()) % width;
      py = (py + t * 5 * prng()) % height;

      const startIdx = (Math.floor(py) * width + Math.floor(px)) * 4;
      if (colorFromImage && startIdx >= 0 && startIdx + 2 < data.length) {
        ctx.strokeStyle = `rgba(${data[startIdx]},${data[startIdx + 1]},${data[startIdx + 2]},${opacity})`;
      } else {
        ctx.strokeStyle = color;
      }

      ctx.beginPath();
      ctx.moveTo(px, py);

      for (let step = 0; step < lineLength; step++) {
        const ix = clamp(Math.floor(px), 0, width - 1);
        const iy = clamp(Math.floor(py), 0, height - 1);
        const angle = angles[iy * width + ix] + Math.sin(t * 0.1 + step * 0.1) * 0.3;

        px += Math.cos(angle) * speed;
        py += Math.sin(angle) * speed;

        if (px < 0 || px >= width || py < 0 || py >= height) break;
        ctx.lineTo(px, py);
      }

      ctx.stroke();
    }

    ctx.globalAlpha = 1;
    const resultData = ctx.getImageData(0, 0, width, height);
    data.set(resultData.data);
  },
});


// ─── 2. Neon Wireframe ─────────────────────────────────────────────────────────
// Edge detection → black background → thick neon-glowing edges. Tron/cyberpunk.

registerEffect({
  type: "neon-wireframe",
  label: "Neon Wireframe",
  category: "style",
  defaultParams: {
    threshold: 40,
    glowRadius: 8,
    glowIntensity: 2.0,
    color: "#00ffff",
    secondaryColor: "#ff00ff",
    dualTone: true,
    lineBoost: 2.5,
  },
  paramsConfig: [
    { key: "threshold", label: "Edge Threshold", type: "slider", min: 10, max: 200, step: 5 },
    { key: "glowRadius", label: "Glow Radius", type: "slider", min: 1, max: 30, step: 1 },
    { key: "glowIntensity", label: "Glow Intensity", type: "slider", min: 0.5, max: 5, step: 0.25 },
    { key: "color", label: "Primary Color", type: "color" },
    { key: "secondaryColor", label: "Secondary Color", type: "color" },
    { key: "dualTone", label: "Dual Tone", type: "checkbox" },
    { key: "lineBoost", label: "Line Boost", type: "slider", min: 1, max: 5, step: 0.25 },
  ],
  processor: (data, { width, height }, params) => {
    const threshold = (params.threshold as number) ?? 40;
    const glowRadius = (params.glowRadius as number) ?? 8;
    const glowIntensity = (params.glowIntensity as number) ?? 2.0;
    const color = (params.color as string) ?? "#00ffff";
    const secondaryColor = (params.secondaryColor as string) ?? "#ff00ff";
    const dualTone = (params.dualTone as boolean) ?? true;
    const lineBoost = (params.lineBoost as number) ?? 2.5;

    // Parse colors
    const parseHex = (hex: string) => {
      const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      return r ? [parseInt(r[1], 16), parseInt(r[2], 16), parseInt(r[3], 16)] : [0, 255, 255];
    };
    const c1 = parseHex(color);
    const c2 = parseHex(secondaryColor);

    // Build grayscale
    const gray = new Float32Array(width * height);
    for (let i = 0; i < width * height; i++) {
      const idx = i * 4;
      gray[i] = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;
    }

    // Sobel edge detection
    const edges = new Float32Array(width * height);
    const edgeAngles = new Float32Array(width * height);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const pos = y * width + x;
        const gx =
          -gray[pos - width - 1] - 2 * gray[pos - 1] - gray[pos + width - 1] +
          gray[pos - width + 1] + 2 * gray[pos + 1] + gray[pos + width + 1];
        const gy =
          -gray[pos - width - 1] - 2 * gray[pos - width] - gray[pos - width + 1] +
          gray[pos + width - 1] + 2 * gray[pos + width] + gray[pos + width + 1];
        edges[pos] = Math.sqrt(gx * gx + gy * gy);
        edgeAngles[pos] = Math.atan2(gy, gx);
      }
    }

    // Apply threshold and boost
    const edgeMask = new Float32Array(width * height);
    for (let i = 0; i < edges.length; i++) {
      edgeMask[i] = edges[i] > threshold ? Math.min(edges[i] * lineBoost / 255, 1) : 0;
    }

    // Multi-pass box blur for glow effect
    const glowBuffer = new Float32Array(edgeMask);
    const passes = 3;
    for (let pass = 0; pass < passes; pass++) {
      const temp = new Float32Array(glowBuffer.length);
      const r = Math.ceil(glowRadius / passes);
      // Horizontal pass
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          let sum = 0, count = 0;
          for (let dx = -r; dx <= r; dx++) {
            const nx = x + dx;
            if (nx >= 0 && nx < width) {
              sum += glowBuffer[y * width + nx];
              count++;
            }
          }
          temp[y * width + x] = sum / count;
        }
      }
      // Vertical pass
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          let sum = 0, count = 0;
          for (let dy = -r; dy <= r; dy++) {
            const ny = y + dy;
            if (ny >= 0 && ny < height) {
              sum += temp[ny * width + x];
              count++;
            }
          }
          glowBuffer[y * width + x] = sum / count;
        }
      }
    }

    // Composite: black background + glow + sharp edges
    for (let i = 0; i < width * height; i++) {
      const idx = i * 4;
      const edge = edgeMask[i];
      const glow = glowBuffer[i] * glowIntensity;

      // Choose color based on edge angle for dual-tone
      let cr: number, cg: number, cb: number;
      if (dualTone) {
        const t = (Math.sin(edgeAngles[i]) + 1) * 0.5; // 0..1
        cr = c1[0] * (1 - t) + c2[0] * t;
        cg = c1[1] * (1 - t) + c2[1] * t;
        cb = c1[2] * (1 - t) + c2[2] * t;
      } else {
        cr = c1[0]; cg = c1[1]; cb = c1[2];
      }

      // Combine sharp edge + soft glow
      const combined = Math.min(edge + glow, 1);
      data[idx] = clamp(Math.floor(cr * combined), 0, 255);
      data[idx + 1] = clamp(Math.floor(cg * combined), 0, 255);
      data[idx + 2] = clamp(Math.floor(cb * combined), 0, 255);
    }
  },
});


// ─── 3. Particle Disintegration ────────────────────────────────────────────────
// Image shatters into particles that drift based on luminance. Bright = float up, dark = sink.

const particleState: {
  particles: { x: number; y: number; vx: number; vy: number; origX: number; origY: number; life: number }[];
  width: number;
  height: number;
  initialized: boolean;
} = { particles: [], width: 0, height: 0, initialized: false };

registerEffect({
  type: "particle-disintegration",
  label: "Particle Disintegrate",
  category: "style",
  defaultParams: {
    particleSize: 3,
    gravity: -0.5,
    spread: 2,
    density: 0.3,
    decay: 0.98,
    respawn: true,
    wind: 1.0,
  },
  paramsConfig: [
    { key: "particleSize", label: "Particle Size", type: "slider", min: 1, max: 8, step: 0.5 },
    { key: "gravity", label: "Gravity", type: "slider", min: -3, max: 3, step: 0.1 },
    { key: "spread", label: "Spread", type: "slider", min: 0.5, max: 10, step: 0.5 },
    { key: "density", label: "Density", type: "slider", min: 0.05, max: 1, step: 0.05 },
    { key: "decay", label: "Decay", type: "slider", min: 0.9, max: 1, step: 0.005 },
    { key: "respawn", label: "Respawn", type: "checkbox" },
    { key: "wind", label: "Wind", type: "slider", min: -5, max: 5, step: 0.25 },
  ],
  processor: (data, { width, height, time = 0 }, params) => {
    const particleSize = (params.particleSize as number) ?? 3;
    const gravity = (params.gravity as number) ?? -0.5;
    const spread = (params.spread as number) ?? 2;
    const density = (params.density as number) ?? 0.3;
    const decay = (params.decay as number) ?? 0.98;
    const respawn = (params.respawn as boolean) ?? true;
    const wind = (params.wind as number) ?? 1.0;

    const step = Math.max(1, Math.floor(1 / density));

    // Initialize or reinitialize particles when dimensions change
    if (!particleState.initialized || particleState.width !== width || particleState.height !== height) {
      particleState.particles = [];
      for (let y = 0; y < height; y += step) {
        for (let x = 0; x < width; x += step) {
          particleState.particles.push({
            x, y, vx: 0, vy: 0,
            origX: x, origY: y,
            life: 1,
          });
        }
      }
      particleState.width = width;
      particleState.height = height;
      particleState.initialized = true;
    }

    // Use canvas for rendering
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = width;
    tempCanvas.height = height;
    const ctx = tempCanvas.getContext("2d");
    if (!ctx) return;

    // Black background
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, width, height);

    // Update and draw particles
    for (const p of particleState.particles) {
      // Sample luminance at original position for behavior
      const origIdx = (clamp(Math.floor(p.origY), 0, height - 1) * width + clamp(Math.floor(p.origX), 0, width - 1)) * 4;
      const lum = (data[origIdx] * 0.299 + data[origIdx + 1] * 0.587 + data[origIdx + 2] * 0.114) / 255;

      // Physics: bright pixels float, dark ones sink
      p.vy += gravity * lum - gravity * (1 - lum) * 0.3;
      p.vx += (Math.sin(time * 0.5 + p.origY * 0.01) * wind * 0.3);
      p.vx += (Math.random() - 0.5) * spread * 0.3;
      p.vy += (Math.random() - 0.5) * spread * 0.2;

      // Damping
      p.vx *= decay;
      p.vy *= decay;

      p.x += p.vx;
      p.y += p.vy;
      p.life *= 0.999;

      // Respawn if out of bounds
      if (respawn && (p.x < -50 || p.x > width + 50 || p.y < -50 || p.y > height + 50 || p.life < 0.01)) {
        p.x = p.origX;
        p.y = p.origY;
        p.vx = 0;
        p.vy = 0;
        p.life = 1;
      }

      // Draw particle with original image color
      if (p.x >= 0 && p.x < width && p.y >= 0 && p.y < height) {
        const r = data[origIdx];
        const g = data[origIdx + 1];
        const b = data[origIdx + 2];
        ctx.fillStyle = `rgba(${r},${g},${b},${p.life})`;
        ctx.fillRect(p.x - particleSize / 2, p.y - particleSize / 2, particleSize, particleSize);
      }
    }

    const resultData = ctx.getImageData(0, 0, width, height);
    data.set(resultData.data);
  },
});


// ─── 4. Reaction-Diffusion ─────────────────────────────────────────────────────
// Gray-Scott reaction-diffusion model seeded by image content.
// Creates organic, biological Turing patterns that evolve over time.

const rdState: {
  gridA: Float32Array | null;
  gridB: Float32Array | null;
  width: number;
  height: number;
  step: number;
} = { gridA: null, gridB: null, width: 0, height: 0, step: 0 };

registerEffect({
  type: "reaction-diffusion",
  label: "Reaction Diffusion",
  category: "style",
  defaultParams: {
    feed: 0.055,
    kill: 0.062,
    diffuseA: 1.0,
    diffuseB: 0.5,
    stepsPerFrame: 8,
    scale: 2,
    colorA: "#000000",
    colorB: "#00ff88",
    seedFromImage: true,
  },
  paramsConfig: [
    { key: "feed", label: "Feed Rate", type: "slider", min: 0.01, max: 0.1, step: 0.001 },
    { key: "kill", label: "Kill Rate", type: "slider", min: 0.01, max: 0.1, step: 0.001 },
    { key: "diffuseA", label: "Diffuse A", type: "slider", min: 0.2, max: 2, step: 0.1 },
    { key: "diffuseB", label: "Diffuse B", type: "slider", min: 0.1, max: 1, step: 0.05 },
    { key: "stepsPerFrame", label: "Speed", type: "slider", min: 1, max: 20, step: 1 },
    { key: "scale", label: "Scale", type: "slider", min: 1, max: 8, step: 1 },
    { key: "colorA", label: "Color A", type: "color" },
    { key: "colorB", label: "Color B", type: "color" },
    { key: "seedFromImage", label: "Seed From Image", type: "checkbox" },
  ],
  processor: (data, { width, height }, params) => {
    const feed = (params.feed as number) ?? 0.055;
    const kill = (params.kill as number) ?? 0.062;
    const dA = (params.diffuseA as number) ?? 1.0;
    const dB = (params.diffuseB as number) ?? 0.5;
    const stepsPerFrame = (params.stepsPerFrame as number) ?? 8;
    const scale = (params.scale as number) ?? 2;
    const colorA = (params.colorA as string) ?? "#000000";
    const colorB = (params.colorB as string) ?? "#00ff88";
    const seedFromImage = (params.seedFromImage as boolean) ?? true;

    const parseHex = (hex: string) => {
      const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
      return r ? [parseInt(r[1], 16), parseInt(r[2], 16), parseInt(r[3], 16)] : [0, 0, 0];
    };
    const cA = parseHex(colorA);
    const cB = parseHex(colorB);

    // Simulation runs at reduced resolution for performance
    const sw = Math.floor(width / scale);
    const sh = Math.floor(height / scale);
    const totalCells = sw * sh;

    // Initialize grids if needed
    if (!rdState.gridA || rdState.width !== sw || rdState.height !== sh) {
      rdState.gridA = new Float32Array(totalCells).fill(1);
      rdState.gridB = new Float32Array(totalCells).fill(0);
      rdState.width = sw;
      rdState.height = sh;
      rdState.step = 0;

      // Seed B from image luminance (dark areas = more B chemical)
      if (seedFromImage) {
        for (let y = 0; y < sh; y++) {
          for (let x = 0; x < sw; x++) {
            const imgX = Math.floor(x * scale);
            const imgY = Math.floor(y * scale);
            const idx = (imgY * width + imgX) * 4;
            const lum = (data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114) / 255;
            if (lum < 0.5) {
              rdState.gridB[y * sw + x] = 1 - lum;
            }
          }
        }
      } else {
        // Seed with random spots
        for (let i = 0; i < totalCells * 0.05; i++) {
          const idx = Math.floor(Math.random() * totalCells);
          rdState.gridB[idx] = 1;
        }
      }
    }

    const gridA = rdState.gridA!;
    const gridB = rdState.gridB!;

    // Run simulation steps
    for (let step = 0; step < stepsPerFrame; step++) {
      const nextA = new Float32Array(totalCells);
      const nextB = new Float32Array(totalCells);

      for (let y = 1; y < sh - 1; y++) {
        for (let x = 1; x < sw - 1; x++) {
          const idx = y * sw + x;
          const a = gridA[idx];
          const b = gridB[idx];

          // Laplacian (discrete)
          const lapA = gridA[idx - 1] + gridA[idx + 1] +
            gridA[idx - sw] + gridA[idx + sw] - 4 * a;
          const lapB = gridB[idx - 1] + gridB[idx + 1] +
            gridB[idx - sw] + gridB[idx + sw] - 4 * b;

          const reaction = a * b * b;
          nextA[idx] = clamp(a + dA * lapA - reaction + feed * (1 - a), 0, 1);
          nextB[idx] = clamp(b + dB * lapB + reaction - (kill + feed) * b, 0, 1);
        }
      }

      gridA.set(nextA);
      gridB.set(nextB);
    }

    rdState.step++;

    // Render to output
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const sx = clamp(Math.floor(x / scale), 0, sw - 1);
        const sy = clamp(Math.floor(y / scale), 0, sh - 1);
        const b = gridB[sy * sw + sx];
        const a = gridA[sy * sw + sx];

        const idx = (y * width + x) * 4;
        const t = clamp(b * 2, 0, 1);
        data[idx] = Math.floor(cA[0] * (1 - t) + cB[0] * t);
        data[idx + 1] = Math.floor(cA[1] * (1 - t) + cB[1] * t);
        data[idx + 2] = Math.floor(cA[2] * (1 - t) + cB[2] * t);
      }
    }
  },
});


// ─── 5. Droste Effect ──────────────────────────────────────────────────────────
// The image contains itself recursively, spiraling inward. Classic mathematical art.

registerEffect({
  type: "droste",
  label: "Droste Effect",
  category: "distortion",
  defaultParams: {
    zoom: 2.0,
    rotation: 30,
    centerX: 0.5,
    centerY: 0.5,
    innerRadius: 0.1,
    outerRadius: 0.9,
    animated: true,
    speed: 0.5,
  },
  glsl: {
    fragment: `
uniform float u_zoom;
uniform float u_rotation;
uniform float u_centerX;
uniform float u_centerY;
uniform float u_innerRadius;
uniform float u_outerRadius;
uniform bool u_animated;
uniform float u_speed;
void main() {
  float maxDim = max(u_resolution.x, u_resolution.y);
  vec2 center = vec2(u_centerX, u_centerY);
  vec2 d = v_texCoord - center;
  // Correct for non-square images
  d *= u_resolution / maxDim;
  float dist = length(d);
  float r1 = u_innerRadius * 0.5;
  float r2 = u_outerRadius * 0.5;
  float rotRad = u_rotation * 3.14159 / 180.0;
  float logZoom = log(u_zoom);
  float timeOffset = u_animated ? u_time * u_speed : 0.0;
  float period = log(r2 / max(r1, 0.001));
  if (dist < 0.001 || period < 0.001) {
    fragColor = texture(u_source, v_texCoord);
    return;
  }
  float logDist = log(dist / r1) + timeOffset;
  float angle = atan(d.y, d.x) + rotRad;
  float wraps = logDist / period;
  float fracWrap = fract(wraps);
  logDist = fracWrap * period;
  angle += floor(wraps) * rotRad;
  float newDist = r1 * exp(logDist);
  // Convert back to UV space
  vec2 srcD = vec2(cos(angle), sin(angle)) * newDist * maxDim / u_resolution;
  vec2 srcUV = center + srcD;
  fragColor = sampleClamped(srcUV);
}`,
    uniforms: {
      zoom: "float", rotation: "float", centerX: "float", centerY: "float",
      innerRadius: "float", outerRadius: "float", animated: "bool", speed: "float",
    },
  },
  paramsConfig: [
    { key: "zoom", label: "Zoom", type: "slider", min: 1.2, max: 5, step: 0.1 },
    { key: "rotation", label: "Rotation", type: "slider", min: -180, max: 180, step: 5 },
    { key: "centerX", label: "Center X", type: "slider", min: 0, max: 1, step: 0.05 },
    { key: "centerY", label: "Center Y", type: "slider", min: 0, max: 1, step: 0.05 },
    { key: "innerRadius", label: "Inner Radius", type: "slider", min: 0.01, max: 0.5, step: 0.01 },
    { key: "outerRadius", label: "Outer Radius", type: "slider", min: 0.5, max: 1.5, step: 0.05 },
    { key: "animated", label: "Animated", type: "checkbox" },
    { key: "speed", label: "Speed", type: "slider", min: 0.1, max: 3, step: 0.1 },
  ],
  processor: (data, { width, height, time = 0 }, params) => {
    const zoom = (params.zoom as number) ?? 2.0;
    const rotationDeg = (params.rotation as number) ?? 30;
    const cxParam = (params.centerX as number) ?? 0.5;
    const cyParam = (params.centerY as number) ?? 0.5;
    const innerRadius = (params.innerRadius as number) ?? 0.1;
    const outerRadius = (params.outerRadius as number) ?? 0.9;
    const animated = (params.animated as boolean) ?? true;
    const speed = (params.speed as number) ?? 0.5;

    const source = new Uint8ClampedArray(data);
    const cx = cxParam * width;
    const cy = cyParam * height;
    const maxDim = Math.max(width, height);

    // Droste transform uses complex logarithm
    const rotRad = (rotationDeg * Math.PI) / 180;
    const logZoom = Math.log(zoom);
    const timeOffset = animated ? time * speed : 0;

    // Complex number helpers for Droste spiral
    const r1 = innerRadius * maxDim * 0.5;
    const r2 = outerRadius * maxDim * 0.5;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const dx = x - cx;
        const dy = y - cy;

        const dist = Math.sqrt(dx * dx + dy * dy);
        let angle = Math.atan2(dy, dx);

        if (dist < 0.5) {
          // Skip center pixel
          continue;
        }

        // Log-polar transform
        let logDist = Math.log(dist / r1);
        logDist += timeOffset; // Animated zoom
        angle += rotRad;

        // Wrap into repeating annular region
        const period = Math.log(r2 / r1);
        if (period > 0.01) {
          // Apply spiral rotation during wrap
          const wraps = logDist / period;
          const fracWrap = wraps - Math.floor(wraps);
          logDist = fracWrap * period;
          angle += Math.floor(wraps) * rotRad;
        }

        // Back to Cartesian
        const newDist = r1 * Math.exp(logDist);
        const srcX = cx + Math.cos(angle) * newDist;
        const srcY = cy + Math.sin(angle) * newDist;

        const sx = clamp(Math.floor(srcX), 0, width - 1);
        const sy = clamp(Math.floor(srcY), 0, height - 1);

        const dstIdx = (y * width + x) * 4;
        const srcIdx = (sy * width + sx) * 4;
        data[dstIdx] = source[srcIdx];
        data[dstIdx + 1] = source[srcIdx + 1];
        data[dstIdx + 2] = source[srcIdx + 2];
      }
    }
  },
});


// ─── 6. Slit Scan ──────────────────────────────────────────────────────────────
// Takes slices from different time frames, compositing past and present.
// Creates iconic time-stretching distortion — dynamic with video.

const slitScanBuffer: {
  slices: Uint8ClampedArray[];
  width: number;
  height: number;
  maxSlices: number;
} = { slices: [], width: 0, height: 0, maxSlices: 120 };

registerEffect({
  type: "slit-scan",
  label: "Slit Scan",
  category: "style",
  defaultParams: {
    direction: "vertical",
    timeDepth: 60,
    speed: 1,
    waveAmount: 0,
    waveFrequency: 0.02,
    mirror: false,
  },
  paramsConfig: [
    { key: "direction", label: "Direction", type: "select", options: ["vertical", "horizontal", "radial"] },
    { key: "timeDepth", label: "Time Depth", type: "slider", min: 5, max: 120, step: 5 },
    { key: "speed", label: "Speed", type: "slider", min: 0.5, max: 5, step: 0.5 },
    { key: "waveAmount", label: "Wave Amount", type: "slider", min: 0, max: 50, step: 1 },
    { key: "waveFrequency", label: "Wave Frequency", type: "slider", min: 0.005, max: 0.1, step: 0.005 },
    { key: "mirror", label: "Mirror", type: "checkbox" },
  ],
  processor: (data, { width, height, time = 0 }, params) => {
    const direction = (params.direction as string) ?? "vertical";
    const timeDepth = (params.timeDepth as number) ?? 60;
    const speed = (params.speed as number) ?? 1;
    const waveAmount = (params.waveAmount as number) ?? 0;
    const waveFreq = (params.waveFrequency as number) ?? 0.02;
    const mirror = (params.mirror as boolean) ?? false;

    // Manage frame buffer
    if (slitScanBuffer.width !== width || slitScanBuffer.height !== height) {
      slitScanBuffer.slices = [];
      slitScanBuffer.width = width;
      slitScanBuffer.height = height;
    }

    // Store current frame
    slitScanBuffer.slices.push(new Uint8ClampedArray(data));
    if (slitScanBuffer.slices.length > slitScanBuffer.maxSlices) {
      slitScanBuffer.slices.shift();
    }

    const numSlices = slitScanBuffer.slices.length;
    if (numSlices < 2) return; // Need at least 2 frames

    const maxDepth = Math.min(timeDepth, numSlices);

    if (direction === "vertical") {
      // Each column comes from a different point in time
      for (let x = 0; x < width; x++) {
        let t = x / width;
        if (mirror) t = t < 0.5 ? t * 2 : 2 - t * 2;

        const sliceIdx = numSlices - 1 - Math.floor(t * (maxDepth - 1));
        const safeIdx = clamp(sliceIdx, 0, numSlices - 1);
        const slice = slitScanBuffer.slices[safeIdx];

        for (let y = 0; y < height; y++) {
          const wave = waveAmount > 0 ? Math.floor(Math.sin(y * waveFreq + time * speed) * waveAmount) : 0;
          const srcX = clamp(x + wave, 0, width - 1);
          const dstIdx = (y * width + x) * 4;
          const srcIdx = (y * width + srcX) * 4;
          data[dstIdx] = slice[srcIdx];
          data[dstIdx + 1] = slice[srcIdx + 1];
          data[dstIdx + 2] = slice[srcIdx + 2];
        }
      }
    } else if (direction === "horizontal") {
      // Each row comes from a different point in time
      for (let y = 0; y < height; y++) {
        let t = y / height;
        if (mirror) t = t < 0.5 ? t * 2 : 2 - t * 2;

        const sliceIdx = numSlices - 1 - Math.floor(t * (maxDepth - 1));
        const safeIdx = clamp(sliceIdx, 0, numSlices - 1);
        const slice = slitScanBuffer.slices[safeIdx];

        for (let x = 0; x < width; x++) {
          const wave = waveAmount > 0 ? Math.floor(Math.sin(x * waveFreq + time * speed) * waveAmount) : 0;
          const srcY = clamp(y + wave, 0, height - 1);
          const dstIdx = (y * width + x) * 4;
          const srcIdx = (srcY * width + x) * 4;
          data[dstIdx] = slice[srcIdx];
          data[dstIdx + 1] = slice[srcIdx + 1];
          data[dstIdx + 2] = slice[srcIdx + 2];
        }
      }
    } else {
      // Radial: distance from center determines time slice
      const cx = width / 2;
      const cy = height / 2;
      const maxR = Math.sqrt(cx * cx + cy * cy);

      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const dx = x - cx;
          const dy = y - cy;
          const r = Math.sqrt(dx * dx + dy * dy);
          let t = r / maxR;
          if (mirror) t = t < 0.5 ? t * 2 : 2 - t * 2;

          const sliceIdx = numSlices - 1 - Math.floor(t * (maxDepth - 1));
          const safeIdx = clamp(sliceIdx, 0, numSlices - 1);
          const slice = slitScanBuffer.slices[safeIdx];

          const wave = waveAmount > 0 ? Math.floor(Math.sin(r * waveFreq + time * speed) * waveAmount) : 0;
          const srcX = clamp(x + Math.floor(Math.cos(Math.atan2(dy, dx)) * wave), 0, width - 1);
          const srcY = clamp(y + Math.floor(Math.sin(Math.atan2(dy, dx)) * wave), 0, height - 1);
          const dstIdx = (y * width + x) * 4;
          const srcIdx = (srcY * width + srcX) * 4;
          data[dstIdx] = slice[srcIdx];
          data[dstIdx + 1] = slice[srcIdx + 1];
          data[dstIdx + 2] = slice[srcIdx + 2];
        }
      }
    }
  },
});
