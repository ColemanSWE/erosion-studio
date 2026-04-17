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
  type UniformType,
} from "./shaders";
export type { UniformType };
export type { GLSLEffect } from "./shaders";

export interface GLRegion {
  rect: [number, number, number, number]; // [rx, ry, rw, rh] in source image pixels
  effects: Effect[];
}

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

  private runEffectList(
    effects: Effect[],
    config: ProcessConfig,
    resolution: [number, number],
    time: number,
    regionRect?: [number, number, number, number],
  ): void {
    const rw = regionRect?.[2] ?? this.width;
    const rh = regionRect?.[3] ?? this.height;

    let cpuBuf: Uint8ClampedArray | null = null;
    let cpuDirty = false;

    const flushCPU = () => {
      if (!cpuBuf || !cpuDirty) return;
      if (regionRect) {
        this.uploadRegionPixels(cpuBuf, regionRect);
      } else {
        this.uploadPixels(cpuBuf);
      }
      this.cpuFlushed = true;
      cpuBuf = null;
      cpuDirty = false;
    };

    for (const effect of effects) {
      if (!effect.active) continue;
      const def = getEffectDefinition(effect.type);
      if (!def) continue;
      const params = { ...def.defaultParams, ...effect.params };
      const glsl = (def as { glsl?: import("./shaders").GLSLEffect }).glsl;

      if (glsl && !glsl.skipGL?.(params)) {
        flushCPU();
        const mappedParams = glsl.uniformMapper ? glsl.uniformMapper(params) : params;
        const prog = this.getProgram(effect.type, glsl.fragment);
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
      } else {
        if (!cpuBuf) {
          cpuBuf = regionRect ? this.readRegionPixels(regionRect) : this.readCurrentPixels();
          // readPixels from the raw texImage2D FBO (or a GPU-processed FBO that used
          // u_flipY=-1.0) returns rows bottom-first. Flip to top-first so CPU effect
          // code can treat row 0 as the image top. After a CPU upload (cpuFlushed=true)
          // the FBO is in a different orientation that does not need this flip.
          if (!this.cpuFlushed) {
            this.flipYBuffer(cpuBuf, rw, rh);
          }
        }
        applyEffect(cpuBuf, effect, { ...config, width: rw, height: rh });
        cpuDirty = true;
      }
    }

    flushCPU();
  }

  renderEffects(
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
  ): void {
    if (sourceWidth <= 0 || sourceHeight <= 0) return;
    this.ensureSize(sourceWidth, sourceHeight);
    this.current = 0;
    this.cpuFlushed = false;
    this.uploadSource(source);

    const resolution: [number, number] = [sourceWidth, sourceHeight];
    const time = config.time ?? 0;

    this.runEffectList(effects, config, resolution, time);

    if (glRegions) {
      for (const region of glRegions) {
        const [, , rw, rh] = region.rect;
        if (rw <= 0 || rh <= 0) continue;
        this.runEffectList(region.effects, config, resolution, time, region.rect);
      }
    }

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
    gl.deleteVertexArray(this.vao);
    for (const prog of this.programCache.values()) {
      clearUniformCache(prog);
      gl.deleteProgram(prog);
    }
    this.programCache.clear();
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
