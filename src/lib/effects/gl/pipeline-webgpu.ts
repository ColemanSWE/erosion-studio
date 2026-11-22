/**
 * WebGPU Pipeline — prototype replacement for GLPipeline.
 *
 * Why WebGPU over WebGL2:
 *   - Compute shaders: pixel-sort, blob-track, reaction-diffusion, and other
 *     CPU-only effects can run entirely on GPU without a readPixels round-trip.
 *   - Explicit synchronisation: no implicit pipeline stalls; GPU work submits
 *     as recorded command buffers and runs asynchronously.
 *   - Render bundles: the effect chain can be pre-recorded and replayed each
 *     frame, cutting JS overhead per frame.
 *   - Timestamp queries: per-pass GPU timing without CPU/GPU sync.
 *   - Better texture management: explicit layouts, no "preserveDrawingBuffer" hack.
 *
 * Migration path from GLPipeline:
 *   1. This class implements the same public surface as GLPipeline
 *      (renderEffects, compositeOverlays, compositeOverlaysOnto, dispose).
 *   2. Effects with a `glsl` shader need a matching `wgsl` body added to their
 *      EffectDefinition. The preamble (bindings, helpers) is generated from
 *      WGSL_FRAGMENT_PREAMBLE below — only the effect body needs to be written.
 *   3. CPU-only effects (pixel-sort, datamosh, etc.) get a `compute` WGSL
 *      shader that replaces the readPixels→JS→texSubImage2D round-trip.
 *   4. Swap GLPipeline.tryCreate() for WebGPUPipeline.tryCreate() in
 *      useRenderContext.ts; the rest of the stack is unchanged.
 *
 * Current state: prototype — covers pipeline initialisation, texture/buffer
 * management, and the core effect-pass loop. Compute shaders for CPU effects
 * and full overlay compositing are stubbed with TODOs.
 */

import type { Effect } from "../types";
import type { ProcessConfig } from "../effect-registry";
import { getEffectDefinition, applyEffect } from "../effect-registry";

// ── WGSL shader templates ──────────────────────────────────────────────────

const WGSL_VERTEX = /* wgsl */`
struct VertexOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn main(@builtin(vertex_index) vi: u32) -> VertexOut {
  // Full-screen triangle (no vertex buffer needed)
  let x = f32((vi & 1u) * 2u) - 1.0;
  let y = f32((vi >> 1u) * 2u) - 1.0;
  var out: VertexOut;
  out.pos = vec4f(x, y, 0.0, 1.0);
  out.uv  = vec2f(x * 0.5 + 0.5, 1.0 - (y * 0.5 + 0.5));
  return out;
}`;

// Preamble injected before every effect's WGSL fragment body.
// Effects declare their own uniforms in a struct bound at group(0) binding(2).
const WGSL_FRAGMENT_PREAMBLE = /* wgsl */`
@group(0) @binding(0) var srcSampler: sampler;
@group(0) @binding(1) var srcTexture: texture_2d<f32>;

struct FrameUniforms {
  resolution: vec2f,
  time: f32,
  _pad: f32,
};
@group(0) @binding(3) var<uniform> frame: FrameUniforms;

fn pseudoRandom(seed: f32) -> f32 {
  return fract(sin(seed * 12.9898 + 78.233) * 43758.5453);
}
fn hash2(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(12.9898, 78.233))) * 43758.5453);
}
fn sampleClamped(uv: vec2f) -> vec4f {
  return textureSample(srcTexture, srcSampler, clamp(uv, vec2f(0.0), vec2f(1.0)));
}
`;

// Passthrough fragment for blits / copies (unused until the WGSL effect path lands).
const _WGSL_PASSTHROUGH_FRAGMENT = WGSL_FRAGMENT_PREAMBLE + /* wgsl */`
@fragment
fn main(@location(0) uv: vec2f) -> @location(0) vec4f {
  return textureSample(srcTexture, srcSampler, uv);
}`;

// ── Types ──────────────────────────────────────────────────────────────────

export interface WGSLEffect {
  /** WGSL fragment body (after the preamble). Must declare @fragment fn main. */
  fragment: string;
  /** Optional WGSL compute shader for effects that need parallel writes (pixel-sort etc). */
  compute?: string;
  /** Map from param key → WGSL type string for the effect uniform struct. */
  uniforms?: Record<string, string>;
  uniformMapper?: (params: Record<string, unknown>) => Record<string, unknown>;
  multiPass?: (resolution: [number, number], params: Record<string, unknown>) => number;
  skipGPU?: (params: Record<string, unknown>) => boolean;
  needsPrevFrame?: boolean;
}

// ── WebGPUPipeline ─────────────────────────────────────────────────────────

export class WebGPUPipeline {
  private device: GPUDevice;
  readonly canvas: HTMLCanvasElement;
  private ctx: GPUCanvasContext;
  private format: GPUTextureFormat;

  // Ping-pong textures + views at source resolution
  private pingTex: GPUTexture | null = null;
  private pongTex: GPUTexture | null = null;
  private current: 0 | 1 = 0;
  private width = 0;
  private height = 0;

  // Persistent texture for temporal effects (u_prevFrame equivalent)
  private prevFrameTex: GPUTexture | null = null;

  // Per-frame uniforms buffer (resolution + time)
  private frameUniformBuf: GPUBuffer;

  // Sampler shared by all passes
  private linearSampler: GPUSampler;

  // Pipeline + bind-group-layout cache
  private pipelineCache = new Map<string, GPURenderPipeline>();
  private computePipelineCache = new Map<string, GPUComputePipeline>();

  // CPU readback buffer (for CPU-fallback effects without a WGSL shader)
  private readbackBuf: GPUBuffer | null = null;

  private constructor(
    device: GPUDevice,
    canvas: HTMLCanvasElement,
    ctx: GPUCanvasContext,
    format: GPUTextureFormat,
  ) {
    this.device = device;
    this.canvas = canvas;
    this.ctx = ctx;
    this.format = format;

    this.frameUniformBuf = device.createBuffer({
      size: 16, // vec2f resolution + f32 time + f32 pad
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.linearSampler = device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    });
  }

  // ── Init ────────────────────────────────────────────────────────────────

  static async tryCreate(initialWidth = 1, initialHeight = 1): Promise<WebGPUPipeline | null> {
    try {
      if (!navigator.gpu) return null;
      const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
      if (!adapter) return null;

      // Timestamp queries let us profile GPU time per pass without readPixels stalls.
      const features: GPUFeatureName[] = [];
      if (adapter.features.has("timestamp-query")) features.push("timestamp-query");

      const device = await adapter.requestDevice({ requiredFeatures: features });

      const canvas = document.createElement("canvas");
      canvas.width = initialWidth;
      canvas.height = initialHeight;
      const ctx = canvas.getContext("webgpu");
      if (!ctx) return null;

      const format = navigator.gpu.getPreferredCanvasFormat();
      ctx.configure({ device, format, alphaMode: "premultiplied" });

      return new WebGPUPipeline(device, canvas, ctx, format);
    } catch {
      return null;
    }
  }

  // ── Texture management ───────────────────────────────────────────────────

  private ensureSize(w: number, h: number): void {
    if (this.width === w && this.height === h) return;
    this.width = w;
    this.height = h;
    this.canvas.width = w;
    this.canvas.height = h;

    this.pingTex?.destroy();
    this.pongTex?.destroy();
    this.prevFrameTex?.destroy();

    const desc: GPUTextureDescriptor = {
      size: [w, h],
      format: "rgba8unorm",
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.RENDER_ATTACHMENT |
        GPUTextureUsage.COPY_SRC |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.STORAGE_BINDING,
    };
    this.pingTex = this.device.createTexture(desc);
    this.pongTex = this.device.createTexture(desc);
    this.prevFrameTex = this.device.createTexture(desc);
    this.current = 0;

    // Re-allocate the readback staging buffer.
    this.readbackBuf?.destroy();
    this.readbackBuf = this.device.createBuffer({
      size: w * h * 4,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });
  }

  private get currentTex(): GPUTexture { return this.current === 0 ? this.pingTex! : this.pongTex!; }
  private get nextTex():    GPUTexture { return this.current === 0 ? this.pongTex! : this.pingTex!; }
  private swapBuffers(): void { this.current = this.current === 0 ? 1 : 0; }

  private uploadSource(source: CanvasImageSource): void {
    // createImageBitmap → copyExternalImageToTexture: zero-copy on most drivers.
    // This avoids the texImage2D "implicit flip" that caused orientation issues in WebGL.
    // HTMLVideoElement + VideoFrame are natively supported.
    this.device.queue.copyExternalImageToTexture(
      { source: source as ImageBitmap },
      { texture: this.currentTex },
      [this.width, this.height],
    );
  }

  // ── Shader pipeline cache ────────────────────────────────────────────────

  private getRenderPipeline(key: string, fragmentWGSL: string): GPURenderPipeline {
    let p = this.pipelineCache.get(key);
    if (!p) {
      p = this.device.createRenderPipeline({
        layout: "auto",
        vertex: {
          module: this.device.createShaderModule({ code: WGSL_VERTEX }),
          entryPoint: "main",
        },
        fragment: {
          module: this.device.createShaderModule({
            code: WGSL_FRAGMENT_PREAMBLE + "\n" + fragmentWGSL,
          }),
          entryPoint: "main",
          targets: [{ format: this.format }],
        },
        primitive: { topology: "triangle-strip" },
      });
      this.pipelineCache.set(key, p);
    }
    return p;
  }

  /**
   * Get or compile a compute pipeline for effects that can run entirely on GPU
   * without a readPixels round-trip. The compute shader receives the source
   * texture via read-only storage binding and writes to the destination texture
   * via read-write storage binding.
   *
   * Example WGSL compute body for a simple invert:
   *   @compute @workgroup_size(8, 8)
   *   fn main(@builtin(global_invocation_id) gid: vec3u) {
   *     let uv = vec2f(f32(gid.x), f32(gid.y));
   *     let c  = textureLoad(srcTex, vec2i(gid.xy), 0);
   *     textureStore(dstTex, vec2i(gid.xy), vec4f(1.0 - c.rgb, c.a));
   *   }
   */
  private getComputePipeline(key: string, computeWGSL: string): GPUComputePipeline {
    let p = this.computePipelineCache.get(key);
    if (!p) {
      const code = /* wgsl */`
@group(0) @binding(0) var srcTex: texture_2d<f32>;
@group(0) @binding(1) var dstTex: texture_storage_2d<rgba8unorm, write>;
${computeWGSL}`;
      p = this.device.createComputePipeline({
        layout: "auto",
        compute: {
          module: this.device.createShaderModule({ code }),
          entryPoint: "main",
        },
      });
      this.computePipelineCache.set(key, p);
    }
    return p;
  }

  // ── Per-frame uniform upload ─────────────────────────────────────────────

  private writeFrameUniforms(time: number): void {
    const data = new Float32Array([this.width, this.height, time, 0]);
    this.device.queue.writeBuffer(this.frameUniformBuf, 0, data);
  }

  // ── Effect pass ─────────────────────────────────────────────────────────

  private runRenderPass(pipeline: GPURenderPipeline, effectUniformBuf?: GPUBuffer): void {
    const enc = this.device.createCommandEncoder();
    const pass = enc.beginRenderPass({
      colorAttachments: [{
        view: this.nextTex.createView(),
        loadOp: "clear",
        storeOp: "store",
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
      }],
    });

    const bindings: GPUBindGroupEntry[] = [
      { binding: 0, resource: this.linearSampler },
      { binding: 1, resource: this.currentTex.createView() },
      { binding: 3, resource: { buffer: this.frameUniformBuf } },
    ];
    if (effectUniformBuf) {
      bindings.push({ binding: 2, resource: { buffer: effectUniformBuf } });
    }

    pass.setPipeline(pipeline);
    pass.setBindGroup(0, this.device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: bindings,
    }));
    pass.draw(3); // full-screen triangle (vertex shader generates geometry)
    pass.end();

    this.device.queue.submit([enc.finish()]);
    this.swapBuffers();
  }

  private runComputePass(pipeline: GPUComputePipeline): void {
    const enc = this.device.createCommandEncoder();
    const pass = enc.beginComputePass();

    pass.setPipeline(pipeline);
    pass.setBindGroup(0, this.device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: this.currentTex.createView() },
        { binding: 1, resource: this.nextTex.createView() },
      ],
    }));
    // Dispatch one workgroup per 8×8 tile
    pass.dispatchWorkgroups(
      Math.ceil(this.width  / 8),
      Math.ceil(this.height / 8),
    );
    pass.end();

    this.device.queue.submit([enc.finish()]);
    this.swapBuffers();
  }

  // ── CPU fallback (effects without WGSL) ─────────────────────────────────
  //
  // Until every effect has a WGSL shader, effects that only have a CPU
  // processor fall back to the same readPixels→JS→upload cycle as WebGL.
  // This is async in WebGPU: mapAsync avoids blocking the JS thread while
  // waiting for the GPU to finish, which is better than WebGL's synchronous
  // readPixels stall.
  private async readCurrentPixelsCPU(): Promise<Uint8ClampedArray> {
    const enc = this.device.createCommandEncoder();
    enc.copyTextureToBuffer(
      { texture: this.currentTex },
      { buffer: this.readbackBuf!, bytesPerRow: this.width * 4 },
      [this.width, this.height],
    );
    this.device.queue.submit([enc.finish()]);
    await this.readbackBuf!.mapAsync(GPUMapMode.READ);
    const data = new Uint8ClampedArray(this.readbackBuf!.getMappedRange());
    const copy = new Uint8ClampedArray(data);
    this.readbackBuf!.unmap();
    return copy;
  }

  private uploadPixelsCPU(buf: Uint8ClampedArray): void {
    this.device.queue.writeTexture(
      { texture: this.currentTex },
      buf.buffer as ArrayBuffer,
      { bytesPerRow: this.width * 4, offset: buf.byteOffset },
      [this.width, this.height],
    );
  }

  // ── Public API (mirrors GLPipeline) ─────────────────────────────────────

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
  ): Promise<void> {
    if (sourceWidth <= 0 || sourceHeight <= 0) return;
    this.ensureSize(sourceWidth, sourceHeight);
    this.writeFrameUniforms(config.time ?? 0);
    this.uploadSource(source);

    for (const effect of effects) {
      if (!effect.active) continue;
      const def = getEffectDefinition(effect.type);
      if (!def) continue;

      // TODO: check def.wgsl (not yet added to EffectDefinition) and use
      // getComputePipeline / getRenderPipeline. For now fall back to CPU.
      const cpuBuf = await this.readCurrentPixelsCPU();
      applyEffect(cpuBuf, effect, { ...config, width: sourceWidth, height: sourceHeight });
      this.uploadPixelsCPU(cpuBuf);
    }

    // Capture prev frame for temporal effects
    if (this.prevFrameTex) {
      const enc = this.device.createCommandEncoder();
      enc.copyTextureToTexture(
        { texture: this.currentTex },
        { texture: this.prevFrameTex },
        [this.width, this.height],
      );
      this.device.queue.submit([enc.finish()]);
    }

    // Blit to display canvas via ImageBitmap
    const bitmap = await createImageBitmap(this.canvas);
    displayCtx.fillStyle = "#000";
    displayCtx.fillRect(0, 0, canvasWidth, canvasHeight);
    displayCtx.drawImage(bitmap, drawX, drawY, drawWidth, drawHeight);
    bitmap.close();
  }

  // TODO: overlay compositing — bind all overlay textures and composite in
  // a single render pass using a dynamic array of rect descriptors passed
  // through a storage buffer. This removes the per-overlay full-frame pass
  // and supports batching all N overlays in one draw call.
  compositeOverlays(_descriptors: unknown[], _config?: ProcessConfig): void {
    // stub
  }

  compositeOverlaysOnto(
    _background: CanvasImageSource,
    _bgWidth: number,
    _bgHeight: number,
    _descriptors: unknown[],
    _displayCtx: CanvasRenderingContext2D,
    _drawX: number,
    _drawY: number,
    _drawWidth: number,
    _drawHeight: number,
    _canvasWidth: number,
    _canvasHeight: number,
  ): void {
    // stub
  }

  dispose(): void {
    this.pingTex?.destroy();
    this.pongTex?.destroy();
    this.prevFrameTex?.destroy();
    this.readbackBuf?.destroy();
    this.frameUniformBuf.destroy();
    this.pipelineCache.clear();
    this.computePipelineCache.clear();
  }
}
