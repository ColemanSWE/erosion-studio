import type { Effect } from "../types";
import type { ProcessConfig } from "../effect-registry";
import { getEffectDefinition, applyEffect } from "../effect-registry";
import {
  VERTEX_SRC,
  PASSTHROUGH_FRAGMENT,
  buildFragmentSrc,
  createProgram,
  bindUniforms,
  getUniformLocation,
  clearUniformCache,
  MAX_HISTORY_FRAMES,
  type UniformType,
} from "./shaders";
export type { UniformType };
export type { GLSLEffect } from "./shaders";

export interface GLRegion {
  rect: [number, number, number, number]; // [rx, ry, rw, rh] in source image pixels
  effects: Effect[];
}

/** Overlay to composite into the GL pipeline before the final blit. */
export interface OverlayDescriptor {
  source: TexImageSource;
  /** Position in source-frame pixels, y=0 at top. */
  x: number;
  y: number;
  w: number;
  h: number;
  opacity: number;
  /** Optional effects to apply to the overlay's own content before compositing. */
  effects?: Effect[];
}

// Standalone vertex + fragment shaders for rect-bound overlay compositing.
//
// Instead of a full-screen pass that branches per-pixel to skip fragments
// outside the overlay rect, each overlay is drawn as a minimal quad that
// covers only its own bounding rect. Fragment work scales with overlay area
// rather than full frame area — a ~95% reduction for typical small overlays.
//
// Attribute layout (location indices must match buildOverlayRectVAO):
//   0: a_position    — clip-space XY of the rect quad corner
//   1: a_sourceCoord — raw texcoord into the source FBO (y flipped in VS)
//   2: a_overlayCoord — texcoord into the overlay texture (0,0=top-left)
const OVERLAY_RECT_VERTEX_SRC = `#version 300 es
layout(location = 0) in vec2 a_position;
layout(location = 1) in vec2 a_sourceCoord;
layout(location = 2) in vec2 a_overlayCoord;
uniform float u_flipY;
out vec2 v_sourceCoord;
out vec2 v_overlayCoord;
void main() {
  gl_Position = vec4(a_position.x, a_position.y * u_flipY, 0.0, 1.0);
  v_sourceCoord = vec2(a_sourceCoord.x, 1.0 - a_sourceCoord.y);
  v_overlayCoord = a_overlayCoord;
}`;

const OVERLAY_RECT_FRAGMENT_SRC = `#version 300 es
precision highp float;
uniform sampler2D u_source;
uniform sampler2D u_overlayTex;
uniform float u_opacity;
in vec2 v_sourceCoord;
in vec2 v_overlayCoord;
out vec4 fragColor;
void main() {
  vec4 bg = texture(u_source, v_sourceCoord);
  vec4 overlay = texture(u_overlayTex, v_overlayCoord);
  float alpha = overlay.a * u_opacity;
  fragColor = vec4(mix(bg.rgb, overlay.rgb, alpha), bg.a);
}`;

interface FBOPair {
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
}

function makeFBO(gl: WebGL2RenderingContext, width: number, height: number): FBOPair {
  const tex = gl.createTexture();
  if (!tex) throw new Error("WebGL: failed to create texture");
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindTexture(gl.TEXTURE_2D, null);

  const fbo = gl.createFramebuffer();
  if (!fbo) throw new Error("WebGL: failed to create framebuffer");
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error(`WebGL: incomplete framebuffer (status 0x${status.toString(16)})`);
  }
  return { fbo, tex };
}

function freeFBO(gl: WebGL2RenderingContext, pair: FBOPair): void {
  gl.deleteFramebuffer(pair.fbo);
  gl.deleteTexture(pair.tex);
}

/**
 * Runs a batch of CPU effects. The buffer may be transferred (detached); the
 * returned array holds the result.
 */
export type CPUEffectRunner = (
  buffer: Uint8ClampedArray,
  effects: Effect[],
  config: ProcessConfig,
) => Promise<Uint8ClampedArray>;

interface HistoryRing {
  tex: WebGLTexture;
  cap: number;
  w: number;
  h: number;
  head: number;
  count: number;
  lastUsed: number;
}

/** Rings unused for this many rendered frames are freed (effect removed / disabled). */
const HISTORY_EVICT_FRAMES = 120;

export class GLPipeline {
  private gl: WebGL2RenderingContext;
  readonly canvas: HTMLCanvasElement;
  private fbo: [FBOPair, FBOPair];
  private current = 0;
  private vao: WebGLVertexArrayObject;
  private programCache = new Map<string, WebGLProgram>();
  private width = 0;
  private height = 0;
  private cpuBufFull: Uint8ClampedArray | null = null;
  private cpuBufRegion: Uint8ClampedArray | null = null;
  // True once a CPU effect has uploaded pixels this frame. Determines whether the
  // FBO data needs a Y-flip before CPU processing and which flipY the final blit uses.
  private cpuFlushed = false;
  /** Off-main-thread executor for CPU effect batches; null → run inline. */
  private cpuRunner: CPUEffectRunner | null = null;
  /** Per-effect-instance rings of past input frames (see GLSLEffect.historyFrames). */
  private historyRings = new Map<string, HistoryRing>();
  private frameCounter = 0;
  // Persistent texture holding the previous rendered frame for temporal effects.
  private prevFrameFBO: FBOPair | null = null;
  // Reusable texture pool for GPU overlay compositing (one slot per concurrent overlay).
  private overlayTexPool: WebGLTexture[] = [];
  // Tracks which pool slots have had at least one valid frame uploaded.
  private overlayTexInitialized: boolean[] = [];
  // Last-seen currentTime per overlay slot. Used to skip texImage2D when a video
  // source hasn't decoded a new frame since the previous composite.
  private overlayLastTime: number[] = [];
  // Dedicated FBO pair for processing per-overlay effects in isolation.
  private overlayEffectFBOs: [FBOPair, FBOPair] | null = null;
  private overlayEffectFBOSize: [number, number] = [0, 0];
  // Reusable canvas + context for scaling overlay sources to their rendered dimensions.
  private scalingCanvas: HTMLCanvasElement | null = null;
  private scalingCtx: CanvasRenderingContext2D | null = null;
  // VAO + VBO for rect-bound overlay composite draw calls.
  private overlayRectVAO: WebGLVertexArrayObject | null = null;
  private overlayRectVBO: WebGLBuffer | null = null;
  // Cached overlay rect program (compiled once, shared across all overlays).
  private overlayRectProgram: WebGLProgram | null = null;

  constructor(gl: WebGL2RenderingContext, canvas: HTMLCanvasElement) {
    this.gl = gl;
    this.canvas = canvas;
    this.fbo = [makeFBO(gl, 1, 1), makeFBO(gl, 1, 1)];
    this.vao = this.buildQuadVAO();
  }

  private getProgram(key: string, fragmentBody: string): WebGLProgram {
    let p = this.programCache.get(key);
    if (!p) {
      p = createProgram(this.gl, VERTEX_SRC, buildFragmentSrc(fragmentBody));
      this.programCache.set(key, p);
    }
    return p;
  }

  private buildQuadVAO(): WebGLVertexArrayObject {
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);

    const data = new Float32Array([
      -1, -1,  0, 0,
       1, -1,  1, 0,
      -1,  1,  0, 1,
       1, -1,  1, 0,
       1,  1,  1, 1,
      -1,  1,  0, 1,
    ]);
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);

    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);

    gl.bindVertexArray(null);
    return vao;
  }

  private ensureSize(w: number, h: number): void {
    if (this.width === w && this.height === h) return;
    this.width = w;
    this.height = h;
    this.canvas.width = w;
    this.canvas.height = h;
    freeFBO(this.gl, this.fbo[0]);
    freeFBO(this.gl, this.fbo[1]);
    this.fbo = [makeFBO(this.gl, w, h), makeFBO(this.gl, w, h)];
    if (this.prevFrameFBO) {
      freeFBO(this.gl, this.prevFrameFBO);
      this.prevFrameFBO = null;
    }
  }

  private uploadSource(source: CanvasImageSource): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.fbo[this.current].tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source as TexImageSource);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  private runPass(
    program: WebGLProgram,
    resolution: [number, number],
    time: number,
    params: Record<string, unknown>,
    uniformTypes: Record<string, UniformType>,
    flipY = 1.0
  ): void {
    const gl = this.gl;
    const next = 1 - this.current;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo[next].fbo);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(program);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.fbo[this.current].tex);
    const srcLoc = getUniformLocation(gl, program, "u_source");
    if (srcLoc) gl.uniform1i(srcLoc, 0);

    const flipLoc = getUniformLocation(gl, program, "u_flipY");
    if (flipLoc) gl.uniform1f(flipLoc, flipY);

    bindUniforms(gl, program, resolution, time, params, uniformTypes);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.current = next;
  }

  private readCurrentPixels(): Uint8ClampedArray {
    const gl = this.gl;
    const size = this.width * this.height * 4;
    if (!this.cpuBufFull || this.cpuBufFull.length !== size) {
      this.cpuBufFull = new Uint8ClampedArray(size);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo[this.current].fbo);
    gl.readPixels(0, 0, this.width, this.height, gl.RGBA, gl.UNSIGNED_BYTE, this.cpuBufFull);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return this.cpuBufFull;
  }

  private uploadPixels(buf: Uint8ClampedArray): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.fbo[this.current].tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.width, this.height, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  private readRegionPixels([rx, ry, rw, rh]: [number, number, number, number]): Uint8ClampedArray {
    const gl = this.gl;
    const size = rw * rh * 4;
    if (!this.cpuBufRegion || this.cpuBufRegion.length < size) {
      this.cpuBufRegion = new Uint8ClampedArray(size);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo[this.current].fbo);
    gl.readPixels(rx, ry, rw, rh, gl.RGBA, gl.UNSIGNED_BYTE, this.cpuBufRegion);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return this.cpuBufRegion;
  }

  private uploadRegionPixels(buf: Uint8ClampedArray, [rx, ry, rw, rh]: [number, number, number, number]): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.fbo[this.current].tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, rx, ry, rw, rh, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  private runRegionPass(
    program: WebGLProgram,
    [rx, ry, rw, rh]: [number, number, number, number],
    resolution: [number, number],
    time: number,
    params: Record<string, unknown>,
    uniformTypes: Record<string, UniformType>,
    flipY = 1.0
  ): void {
    const gl = this.gl;
    const next = 1 - this.current;

    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.fbo[this.current].fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.fbo[next].fbo);
    gl.blitFramebuffer(0, 0, this.width, this.height, 0, 0, this.width, this.height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);

    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(rx, ry, rw, rh);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo[next].fbo);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(program);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.fbo[this.current].tex);
    const srcLoc = getUniformLocation(gl, program, "u_source");
    if (srcLoc) gl.uniform1i(srcLoc, 0);

    const flipLoc = getUniformLocation(gl, program, "u_flipY");
    if (flipLoc) gl.uniform1f(flipLoc, flipY);

    bindUniforms(gl, program, resolution, time, params, uniformTypes);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.disable(gl.SCISSOR_TEST);

    this.current = next;
  }

  private setFBOFilter(filter: number): void {
    const gl = this.gl;
    for (const pair of this.fbo) {
      gl.bindTexture(gl.TEXTURE_2D, pair.tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    }
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  private blitToDefaultFB(flipY = 1.0): void {
    const gl = this.gl;
    const prog = this.getProgram("__passthrough", PASSTHROUGH_FRAGMENT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(prog);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.fbo[this.current].tex);
    const loc = getUniformLocation(gl, prog, "u_source");
    if (loc) gl.uniform1i(loc, 0);

    const flipLoc = getUniformLocation(gl, prog, "u_flipY");
    if (flipLoc) gl.uniform1f(flipLoc, flipY);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
  }

  private flipYBuffer(buf: Uint8ClampedArray, w: number, h: number): void {
    const rowLen = w * 4;
    const half = h >> 1;
    const temp = new Uint8ClampedArray(rowLen);
    for (let y = 0; y < half; y++) {
      const top = y * rowLen;
      const bot = (h - 1 - y) * rowLen;
      temp.set(buf.subarray(top, top + rowLen));
      buf.copyWithin(top, bot, bot + rowLen);
      buf.set(temp, bot);
    }
  }

  private capturePrevFrame(): void {
    const gl = this.gl;
    if (!this.prevFrameFBO) {
      this.prevFrameFBO = makeFBO(gl, this.width, this.height);
    }
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.fbo[this.current].fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.prevFrameFBO.fbo);
    gl.blitFramebuffer(0, 0, this.width, this.height, 0, 0, this.width, this.height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
  }

  /** Copy the current FBO into the effect's history ring and return the ring. */
  private pushHistory(key: string, cap: number): HistoryRing {
    const gl = this.gl;
    const w = this.width;
    const h = this.height;
    let ring = this.historyRings.get(key);
    if (!ring || ring.cap !== cap || ring.w !== w || ring.h !== h) {
      if (ring) gl.deleteTexture(ring.tex);
      const tex = gl.createTexture();
      if (!tex) throw new Error("WebGL: failed to create history texture");
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
      gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, w, h, cap);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      ring = { tex, cap, w, h, head: -1, count: 0, lastUsed: 0 };
      this.historyRings.set(key, ring);
    }
    ring.head = (ring.head + 1) % ring.cap;
    ring.count = Math.min(ring.count + 1, ring.cap);
    ring.lastUsed = this.frameCounter;

    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.fbo[this.current].fbo);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, ring.tex);
    gl.copyTexSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, ring.head, 0, 0, w, h);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    return ring;
  }

  private evictStaleHistory(): void {
    for (const [key, ring] of this.historyRings) {
      if (this.frameCounter - ring.lastUsed > HISTORY_EVICT_FRAMES) {
        this.gl.deleteTexture(ring.tex);
        this.historyRings.delete(key);
      }
    }
  }

  // CPU-only effects (no GLSL or skipGL always returns true) that cause
  // readPixels/texSubImage2D round-trips on every frame they appear in a chain:
  //   pixel-sort  — skipGL: () => true; radix sort requires sequential CPU ops
  //   datamosh    — no glsl; block motion search + temporal state
  //   flow-field  — no glsl; uses canvas 2D API for line rendering
  //   slit-scan   — no glsl; sequential scanline accumulation
  //   particle-disintegration — no glsl; particle system with persistent state
  //   reaction-diffusion      — no glsl; iterative diffusion simulation
  //   droste      — no glsl; logarithmic spiral tiling with canvas ops
  //   motion-smear (mode=bloom) — skipGL when mode === "bloom"
  //
  // When these are interleaved with GPU effects (e.g. GPU → CPU → GPU → CPU),
  // each GPU→CPU transition triggers a full readPixels sync stall. Prefer
  // grouping CPU effects consecutively or pass reorderGPUFirst=true for chains
  // where visual output order doesn't matter.
  private async runEffectList(
    effects: Effect[],
    config: ProcessConfig,
    resolution: [number, number],
    time: number,
    regionRect?: [number, number, number, number],
    reorderGPUFirst = false,
  ): Promise<void> {
    const rw = regionRect?.[2] ?? this.width;
    const rh = regionRect?.[3] ?? this.height;

    // When reorderGPUFirst is set, separate GPU and CPU effects to avoid
    // interleaved readback/upload round-trips. GPU effects run first as a
    // batch, then CPU effects. This trades strict stack order for fewer GPU
    // pipeline stalls — only enable it when the caller knows that reordering
    // doesn't change the intended output (e.g. independent region/zone effects).
    let orderedEffects = effects;
    if (reorderGPUFirst && effects.length > 1) {
      const hasGPU = effects.some(e => {
        if (!e.active) return false;
        const def = getEffectDefinition(e.type);
        if (!def) return false;
        const glsl = (def as { glsl?: import("./shaders").GLSLEffect }).glsl;
        const params = { ...def.defaultParams, ...e.params };
        return glsl && !glsl.skipGL?.(params);
      });
      const hasCPU = effects.some(e => {
        if (!e.active) return false;
        const def = getEffectDefinition(e.type);
        if (!def) return false;
        const glsl = (def as { glsl?: import("./shaders").GLSLEffect }).glsl;
        const params = { ...def.defaultParams, ...e.params };
        return !glsl || !!glsl.skipGL?.(params);
      });
      if (hasGPU && hasCPU) {
        orderedEffects = [
          ...effects.filter(e => {
            if (!e.active) return false;
            const def = getEffectDefinition(e.type);
            if (!def) return false;
            const glsl = (def as { glsl?: import("./shaders").GLSLEffect }).glsl;
            const params = { ...def.defaultParams, ...e.params };
            return glsl && !glsl.skipGL?.(params);
          }),
          ...effects.filter(e => {
            if (!e.active) return true;
            const def = getEffectDefinition(e.type);
            if (!def) return true;
            const glsl = (def as { glsl?: import("./shaders").GLSLEffect }).glsl;
            const params = { ...def.defaultParams, ...e.params };
            return !glsl || !!glsl.skipGL?.(params);
          }),
        ];
      }
    }

    // Consecutive CPU effects are batched: one readback, one run (in the worker
    // when available), one upload — instead of a round-trip per effect.
    let cpuBatch: Effect[] = [];

    const flushCPU = async () => {
      if (cpuBatch.length === 0) return;
      const batch = cpuBatch;
      cpuBatch = [];
      const result = await this.runCPUBatch(batch, { ...config, width: rw, height: rh }, regionRect);
      if (regionRect) this.uploadRegionPixels(result, regionRect);
      else this.uploadPixels(result);
      this.cpuFlushed = true;
    };

    for (const effect of orderedEffects) {
      if (!effect.active) continue;
      const def = getEffectDefinition(effect.type);
      if (!def) continue;
      const params = { ...def.defaultParams, ...effect.params };
      const glsl = (def as { glsl?: import("./shaders").GLSLEffect }).glsl;

      if (glsl && !glsl.skipGL?.(params)) {
        await flushCPU();
        const mappedParams = glsl.uniformMapper ? glsl.uniformMapper(params) : params;
        const prog = this.getProgram(effect.type, glsl.fragment);

        // Bind the persistent previous-frame texture to unit 1 for temporal effects.
        if (glsl.needsPrevFrame) {
          this.gl.activeTexture(this.gl.TEXTURE1);
          this.gl.bindTexture(this.gl.TEXTURE_2D, this.prevFrameFBO ? this.prevFrameFBO.tex : null);
          this.gl.activeTexture(this.gl.TEXTURE0);
          this.gl.useProgram(prog);
          const prevLoc = getUniformLocation(this.gl, prog, "u_prevFrame");
          if (prevLoc) this.gl.uniform1i(prevLoc, 1);
        }

        // Ring of past input frames for temporal effects (trails, echo, delay).
        let historyBound = false;
        if (glsl.historyFrames) {
          const cap = Math.max(1, Math.min(MAX_HISTORY_FRAMES, Math.round(glsl.historyFrames(params))));
          const key = regionRect ? `${effect.id}@${regionRect.join(",")}` : effect.id;
          const ring = this.pushHistory(key, cap);
          const gl = this.gl;
          gl.activeTexture(gl.TEXTURE2);
          gl.bindTexture(gl.TEXTURE_2D_ARRAY, ring.tex);
          gl.activeTexture(gl.TEXTURE0);
          gl.useProgram(prog);
          const set = (name: string, v: number) => {
            const loc = getUniformLocation(gl, prog, name);
            if (loc) gl.uniform1i(loc, v);
          };
          set("u_history", 2);
          set("u_historyCount", ring.count);
          set("u_historyHead", ring.head);
          set("u_historyCap", ring.cap);
          historyBound = true;
        }

        const passCount = glsl.multiPass ? glsl.multiPass(resolution, mappedParams) : 1;
        const uniforms: Record<string, import("./shaders").UniformType> = { ...(glsl.uniforms ?? {}) };
        if (passCount > 1) uniforms["pass"] = "int";
        if (passCount > 1) this.setFBOFilter(this.gl.NEAREST);

        // Always use u_flipY=-1.0 for every GPU pass. This keeps gl_FragCoord.y and
        // v_texCoord.y in the same direction (both increase bottom-to-top), so shaders
        // that use either or both produce consistent results. Any number of -1.0 passes
        // in sequence leaves the FBO in the same orientation as the original texImage2D
        // upload, which blitToDefaultFB(1.0) then corrects for display.
        for (let p = 0; p < passCount; p++) {
          const passParams = { ...mappedParams, pass: p };
          if (regionRect) {
            this.runRegionPass(prog, regionRect, resolution, time, passParams, uniforms, -1.0);
          } else {
            this.runPass(prog, resolution, time, passParams, uniforms, -1.0);
          }
        }

        if (passCount > 1) {
          this.setFBOFilter(this.gl.LINEAR);
          this.gl.flush();
        }

        if (glsl.needsPrevFrame) {
          this.gl.activeTexture(this.gl.TEXTURE1);
          this.gl.bindTexture(this.gl.TEXTURE_2D, null);
          this.gl.activeTexture(this.gl.TEXTURE0);
        }
        if (historyBound) {
          this.gl.activeTexture(this.gl.TEXTURE2);
          this.gl.bindTexture(this.gl.TEXTURE_2D_ARRAY, null);
          this.gl.activeTexture(this.gl.TEXTURE0);
        }
      } else {
        cpuBatch.push(effect);
      }
    }

    await flushCPU();
  }

  /**
   * Read the current FBO (or region), run `effects` on the pixels and return
   * them ready for upload. Uses the worker when one is set and the batch can be
   * shipped; falls back to the main thread on any failure.
   */
  private async runCPUBatch(
    effects: Effect[],
    config: ProcessConfig,
    regionRect?: [number, number, number, number],
  ): Promise<Uint8ClampedArray> {
    const read = () => {
      const buf = regionRect ? this.readRegionPixels(regionRect) : this.readCurrentPixels();
      // readPixels from the raw texImage2D FBO (or a GPU-processed FBO that used
      // u_flipY=-1.0) returns rows bottom-first. Flip to top-first so CPU effect
      // code can treat row 0 as the image top. After a CPU upload (cpuFlushed=true)
      // the FBO is in a different orientation that does not need this flip.
      if (!this.cpuFlushed) this.flipYBuffer(buf, config.width, config.height);
      return buf;
    };

    // Always offload when possible, even with timelineFrames (they are cloned to
    // the worker): stateful effects such as datamosh keep their cross-frame state
    // in the worker, so running some frames inline would split that state.
    const canOffload = !!this.cpuRunner;
    if (canOffload) {
      try {
        const result = await this.cpuRunner!(read(), effects, config);
        // The scratch buffer was transferred; adopt the returned one for reuse.
        if (regionRect) this.cpuBufRegion = result;
        else this.cpuBufFull = result;
        return result;
      } catch {
        // Worker failed and may have taken the buffer with it — read again below.
        if (regionRect) this.cpuBufRegion = null;
        else this.cpuBufFull = null;
      }
    }

    const buf = read();
    for (const effect of effects) applyEffect(buf, effect, config);
    return buf;
  }

  /** Route CPU effect batches through `runner` (e.g. a Web Worker). */
  setCPURunner(runner: CPUEffectRunner | null): void {
    this.cpuRunner = runner;
  }

  private ensureOverlayEffectFBOs(w: number, h: number): [FBOPair, FBOPair] {
    const [ow, oh] = this.overlayEffectFBOSize;
    if (!this.overlayEffectFBOs || ow !== w || oh !== h) {
      if (this.overlayEffectFBOs) {
        freeFBO(this.gl, this.overlayEffectFBOs[0]);
        freeFBO(this.gl, this.overlayEffectFBOs[1]);
      }
      this.overlayEffectFBOs = [makeFBO(this.gl, w, h), makeFBO(this.gl, w, h)];
      this.overlayEffectFBOSize = [w, h];
    }
    return this.overlayEffectFBOs;
  }

  private getScalingCtx(w: number, h: number): CanvasRenderingContext2D {
    if (!this.scalingCanvas) {
      this.scalingCanvas = document.createElement("canvas");
      this.scalingCtx = this.scalingCanvas.getContext("2d");
    }
    this.scalingCanvas.width = w;
    this.scalingCanvas.height = h;
    return this.scalingCtx!;
  }

  // Build the VAO + VBO used by rect-bound overlay passes. The VBO is allocated
  // once and updated via bufferSubData before each draw.
  private buildOverlayRectVAO(): WebGLVertexArrayObject {
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    const vbo = gl.createBuffer()!;

    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    // 6 vertices × 6 floats (pos×2, sourceCoord×2, overlayCoord×2) = 36 floats, dynamic
    gl.bufferData(gl.ARRAY_BUFFER, 36 * 4, gl.DYNAMIC_DRAW);

    const stride = 6 * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 2 * 4);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, 4 * 4);

    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindVertexArray(null);

    this.overlayRectVAO = vao;
    this.overlayRectVBO = vbo;
    return vao;
  }

  // Generate a rect quad covering [rx,ry,rw,rh] in v_texCoord space (canvas y=0 at top).
  // Returns 36 floats: 6 vertices × (clipX, clipY, sourceCoordX, sourceCoordY, overlayU, overlayV).
  private buildOverlayRectVertices(rx: number, ry: number, rw: number, rh: number): Float32Array {
    const x0 = rx,      x1 = rx + rw;
    const y0 = ry,      y1 = ry + rh; // v_texCoord y: y0=top, y1=bottom

    // a_sourceCoord.y = 1 - v_texCoord.y (vertex shader applies the same flip as VERTEX_SRC)
    const sy0 = 1 - y0; // a_sourceCoord.y at top corners
    const sy1 = 1 - y1; // a_sourceCoord.y at bottom corners

    // clip space: a_position = a_sourceCoord * 2 - 1
    const px0 = x0  * 2 - 1, px1 = x1  * 2 - 1;
    const py0 = sy0 * 2 - 1, py1 = sy1 * 2 - 1; // before u_flipY

    // overlay coords: (0,0)=top-left, (1,1)=bottom-right, matching v_texCoord direction
    return new Float32Array([
      // tri 1: bottom-left, bottom-right, top-left
      px0, py1,  x0, sy1,  0, 1,
      px1, py1,  x1, sy1,  1, 1,
      px0, py0,  x0, sy0,  0, 0,
      // tri 2: bottom-right, top-right, top-left
      px1, py1,  x1, sy1,  1, 1,
      px1, py0,  x1, sy0,  1, 0,
      px0, py0,  x0, sy0,  0, 0,
    ]);
  }

  private getOverlayRectProgram(): WebGLProgram {
    if (!this.overlayRectProgram) {
      this.overlayRectProgram = createProgram(this.gl, OVERLAY_RECT_VERTEX_SRC, OVERLAY_RECT_FRAGMENT_SRC);
    }
    return this.overlayRectProgram;
  }

  /**
   * Upload `source` scaled to `w × h`, run `effects` against it in isolated
   * FBOs, and return the result texture. The main pipeline FBO state is saved
   * and restored, so this can be called mid-frame without corrupting the main
   * effect chain.
   */
  private async runEffectsOnOverlaySource(
    source: TexImageSource,
    w: number,
    h: number,
    effects: Effect[],
    config: ProcessConfig,
  ): Promise<WebGLTexture> {
    const gl = this.gl;
    const overlayW = Math.max(1, Math.round(w));
    const overlayH = Math.max(1, Math.round(h));
    const fbos = this.ensureOverlayEffectFBOs(overlayW, overlayH);

    // Scale the overlay source to its rendered dimensions via a 2D canvas so
    // that the GL texture dimensions are exactly overlayW × overlayH.
    const scaleCtx = this.getScalingCtx(overlayW, overlayH);
    scaleCtx.clearRect(0, 0, overlayW, overlayH);
    scaleCtx.drawImage(source as CanvasImageSource, 0, 0, overlayW, overlayH);

    gl.bindTexture(gl.TEXTURE_2D, fbos[0].tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, this.scalingCanvas!);
    gl.bindTexture(gl.TEXTURE_2D, null);

    // Swap main pipeline state for the duration of the overlay effect pass.
    const savedFBO = this.fbo;
    const savedCurrent = this.current;
    const savedWidth = this.width;
    const savedHeight = this.height;
    const savedCPUFlushed = this.cpuFlushed;

    this.fbo = fbos;
    this.current = 0;
    this.width = overlayW;
    this.height = overlayH;
    this.cpuFlushed = false;

    // Effects applied to an isolated overlay source don't depend on the main
    // frame — GPU-first reordering eliminates unnecessary readback stalls.
    await this.runEffectList(effects, config, [overlayW, overlayH], config.time ?? 0, undefined, true);

    const resultIdx = this.current;

    this.fbo = savedFBO;
    this.current = savedCurrent;
    this.width = savedWidth;
    this.height = savedHeight;
    this.cpuFlushed = savedCPUFlushed;

    return fbos[resultIdx].tex;
  }

  private ensureOverlayTex(index: number): WebGLTexture {
    const gl = this.gl;
    while (this.overlayTexPool.length <= index) {
      const tex = gl.createTexture();
      if (!tex) throw new Error("WebGL: failed to create overlay texture");
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindTexture(gl.TEXTURE_2D, null);
      this.overlayTexPool.push(tex);
      this.overlayTexInitialized.push(false);
    }
    return this.overlayTexPool[index];
  }

  private runOverlayPass(
    overlayTex: WebGLTexture,
    rect: [number, number, number, number],
    opacity: number,
  ): void {
    const gl = this.gl;
    const prog = this.getOverlayRectProgram();
    const vao = this.overlayRectVAO ?? this.buildOverlayRectVAO();
    const next = 1 - this.current;

    // Upload the rect-bound quad vertices covering only this overlay's area.
    const verts = this.buildOverlayRectVertices(rect[0], rect[1], rect[2], rect[3]);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.overlayRectVBO!);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, verts);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo[next].fbo);
    // Copy the current FBO into the next so that pixels outside the overlay
    // rect retain their contents (we're only drawing the overlay quad).
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.fbo[this.current].fbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.fbo[next].fbo);
    gl.blitFramebuffer(0, 0, this.width, this.height, 0, 0, this.width, this.height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo[next].fbo);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(prog);
    gl.bindVertexArray(vao);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.fbo[this.current].tex);
    const srcLoc = getUniformLocation(gl, prog, "u_source");
    if (srcLoc) gl.uniform1i(srcLoc, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, overlayTex);
    const ovrLoc = getUniformLocation(gl, prog, "u_overlayTex");
    if (ovrLoc) gl.uniform1i(ovrLoc, 1);

    const opacityLoc = getUniformLocation(gl, prog, "u_opacity");
    if (opacityLoc) gl.uniform1f(opacityLoc, opacity);

    const flipLoc = getUniformLocation(gl, prog, "u_flipY");
    if (flipLoc) gl.uniform1f(flipLoc, this.cpuFlushed ? 1.0 : -1.0);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.current = next;
  }

  async compositeOverlays(descriptors: OverlayDescriptor[], config?: ProcessConfig): Promise<void> {
    if (descriptors.length === 0) return;
    const gl = this.gl;
    for (let i = 0; i < descriptors.length; i++) {
      const { source, x, y, w, h, opacity, effects } = descriptors[i];
      if (w <= 0 || h <= 0) continue;
      const notReady = source instanceof HTMLVideoElement && source.readyState < 2;

      const hasEffects = !notReady && effects && effects.length > 0 && config;

      let tex: WebGLTexture;
      if (hasEffects) {
        // Run effects against the overlay's own pixels in isolated FBOs, then
        // composite the effected result into the main frame.
        tex = await this.runEffectsOnOverlaySource(source, w, h, effects!, config!);
      } else {
        tex = this.ensureOverlayTex(i);
        if (!notReady) {
          // For HTMLVideoElement sources, skip the upload when the decoder hasn't
          // produced a new frame since the last composite — avoids burning ~8MB of
          // GPU bandwidth per stalled overlay per frame.
          const videoTime = source instanceof HTMLVideoElement ? source.currentTime : null;
          const timeChanged = videoTime === null || videoTime !== this.overlayLastTime[i];
          if (timeChanged) {
            gl.bindTexture(gl.TEXTURE_2D, tex);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
            gl.bindTexture(gl.TEXTURE_2D, null);
            this.overlayTexInitialized[i] = true;
            if (videoTime !== null) this.overlayLastTime[i] = videoTime;
          } else if (!this.overlayTexInitialized[i]) {
            continue;
          }
        } else if (!this.overlayTexInitialized[i]) {
          // No frame ever uploaded for this slot — nothing to show yet.
          continue;
        }
        // If notReady but initialized, fall through and reuse the last good frame.
      }

      const rx = x / this.width;
      const ry = y / this.height;
      const rw = w / this.width;
      const rh = h / this.height;
      this.runOverlayPass(tex, [rx, ry, rw, rh], opacity);
    }
  }

  /**
   * Upload `background` as the GL source, composite `descriptors` on top, and
   * draw the result to `displayCtx`.  Used by the hybrid render path to GPU-
   * composite remaining (non-effect-zone) overlays after the CPU masking pass.
   */
  async compositeOverlaysOnto(
    background: CanvasImageSource,
    bgWidth: number,
    bgHeight: number,
    descriptors: OverlayDescriptor[],
    displayCtx: CanvasRenderingContext2D,
    drawX: number,
    drawY: number,
    drawWidth: number,
    drawHeight: number,
    canvasWidth: number,
    canvasHeight: number,
  ): Promise<void> {
    if (bgWidth <= 0 || bgHeight <= 0) return;
    this.ensureSize(bgWidth, bgHeight);
    this.current = 0;
    this.cpuFlushed = false;
    this.uploadSource(background);
    if (descriptors.length > 0) {
      await this.compositeOverlays(descriptors);
    }
    // The background was uploaded from a 2D canvas (CPU-side, display orientation).
    // texImage2D stores row 0 of the canvas at v=0, so blitToDefaultFB(1.0) is correct.
    this.blitToDefaultFB(1.0);
    displayCtx.fillStyle = "#000";
    displayCtx.fillRect(0, 0, canvasWidth, canvasHeight);
    displayCtx.drawImage(this.canvas, drawX, drawY, drawWidth, drawHeight);
  }

  async renderEffects(
    source: CanvasImageSource,
    sourceWidth: number,
    sourceHeight: number,
    effects: Effect[],
    config: ProcessConfig,
    displayCtx: CanvasRenderingContext2D,
    drawX: number,
    drawY: number,
    drawWidth: number,
    drawHeight: number,
    canvasWidth: number,
    canvasHeight: number,
    glRegions?: GLRegion[],
    overlayDescriptors?: OverlayDescriptor[],
  ): Promise<void> {
    if (sourceWidth <= 0 || sourceHeight <= 0) return;
    this.ensureSize(sourceWidth, sourceHeight);
    this.current = 0;
    this.cpuFlushed = false;
    this.uploadSource(source);

    const resolution: [number, number] = [sourceWidth, sourceHeight];
    const time = config.time ?? 0;

    await this.runEffectList(effects, config, resolution, time);

    if (glRegions) {
      for (const region of glRegions) {
        const [, , rw, rh] = region.rect;
        if (rw <= 0 || rh <= 0) continue;
        // Region effects are applied to isolated pixel areas — GPU-first reordering
        // is safe here because each effect only reads/writes inside its own rect.
        await this.runEffectList(region.effects, config, resolution, time, region.rect, true);
      }
    }

    // Composite GPU overlays into the FBO before the prev-frame snapshot and final blit.
    if (overlayDescriptors && overlayDescriptors.length > 0) {
      await this.compositeOverlays(overlayDescriptors, config);
    }

    // Snapshot the final rendered output for temporal effects (e.g. motion-smear) to
    // sample as u_prevFrame in the next call to renderEffects.
    this.capturePrevFrame();
    this.frameCounter++;
    this.evictStaleHistory();

    // After GPU-only effects (u_flipY=-1.0, orientation preserved from texImage2D),
    // blit(1.0) swaps to the display-correct orientation.
    // After a CPU upload, the FBO is already in display-correct orientation,
    // so blit(-1.0) preserves it.
    this.blitToDefaultFB(this.cpuFlushed ? -1.0 : 1.0);

    displayCtx.fillStyle = "#000";
    displayCtx.fillRect(0, 0, canvasWidth, canvasHeight);
    displayCtx.drawImage(this.canvas, drawX, drawY, drawWidth, drawHeight);
  }

  dispose(): void {
    const gl = this.gl;
    freeFBO(gl, this.fbo[0]);
    freeFBO(gl, this.fbo[1]);
    if (this.prevFrameFBO) freeFBO(gl, this.prevFrameFBO);
    if (this.overlayEffectFBOs) {
      freeFBO(gl, this.overlayEffectFBOs[0]);
      freeFBO(gl, this.overlayEffectFBOs[1]);
      this.overlayEffectFBOs = null;
    }
    for (const tex of this.overlayTexPool) gl.deleteTexture(tex);
    this.overlayTexPool = [];
    this.overlayTexInitialized = [];
    this.overlayLastTime = [];
    this.scalingCanvas = null;
    this.scalingCtx = null;
    if (this.overlayRectVAO) { gl.deleteVertexArray(this.overlayRectVAO); this.overlayRectVAO = null; }
    if (this.overlayRectVBO) { gl.deleteBuffer(this.overlayRectVBO); this.overlayRectVBO = null; }
    if (this.overlayRectProgram) {
      clearUniformCache(this.overlayRectProgram);
      gl.deleteProgram(this.overlayRectProgram);
      this.overlayRectProgram = null;
    }
    gl.deleteVertexArray(this.vao);
    for (const prog of this.programCache.values()) {
      clearUniformCache(prog);
      gl.deleteProgram(prog);
    }
    this.programCache.clear();
    for (const ring of this.historyRings.values()) gl.deleteTexture(ring.tex);
    this.historyRings.clear();
  }

  static tryCreate(initialWidth = 1, initialHeight = 1): GLPipeline | null {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = initialWidth;
      canvas.height = initialHeight;
      const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true });
      if (!gl) return null;
      return new GLPipeline(gl, canvas);
    } catch {
      return null;
    }
  }
}
