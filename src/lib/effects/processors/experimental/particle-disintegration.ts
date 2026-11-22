import { registerEffect } from "../../effect-registry";
import { clamp } from "../shared";

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
  experimental: true,
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
