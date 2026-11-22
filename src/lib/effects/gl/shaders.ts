export type UniformType = "float" | "int" | "bool" | "vec2" | "vec3" | "vec4";

export interface GLSLEffect {
  fragment: string;
  uniforms?: Record<string, UniformType>;
  uniformMapper?: (params: Record<string, unknown>) => Record<string, unknown>;
  multiPass?: (resolution: [number, number], params: Record<string, unknown>) => number;
  skipGL?: (params: Record<string, unknown>) => boolean;
  /** When true, GLPipeline binds a persistent previous-frame texture to u_prevFrame (sampler2D, unit 1). */
  needsPrevFrame?: boolean;
  /**
   * Number of past *input* frames this effect reads (including the current one).
   * GLPipeline keeps a per-effect-instance ring of that many frames and exposes
   * it through HISTORY_GLSL's `historyFrame(age)`. Capped at MAX_HISTORY_FRAMES.
   */
  historyFrames?: (params: Record<string, unknown>) => number;
}

export const MAX_HISTORY_FRAMES = 16;

/**
 * Prepend to an effect fragment that declares `historyFrames`.
 * age 0 is this frame's input (identical to u_source); age n is n frames ago.
 * Only ages below u_historyCount hold real frames.
 */
export const HISTORY_GLSL = `
uniform highp sampler2DArray u_history;
uniform int u_historyCount;
uniform int u_historyHead;
uniform int u_historyCap;
vec4 historyFrameAt(int age, vec2 uv) {
  int layer = (u_historyHead - age + u_historyCap) % u_historyCap;
  return texture(u_history, vec3(uv, float(layer)));
}
vec4 historyFrame(int age) { return historyFrameAt(age, v_texCoord); }
`;

// layout(location) qualifiers are required so the VAO binding by index (0,1) works
// regardless of when the program is linked.
export const VERTEX_SRC = `#version 300 es
layout(location = 0) in vec2 a_position;
layout(location = 1) in vec2 a_texCoord;
uniform float u_flipY;
out vec2 v_texCoord;
void main() {
  gl_Position = vec4(a_position.x, a_position.y * u_flipY, 0.0, 1.0);
  // Flip Y so v_texCoord (0,0) = top-left, matching Canvas 2D convention
  v_texCoord = vec2(a_texCoord.x, 1.0 - a_texCoord.y);
}`;

// Standard preamble prepended to every effect fragment shader
export const FRAGMENT_PREAMBLE = `#version 300 es
precision highp float;
uniform sampler2D u_source;
uniform vec2 u_resolution;
uniform float u_time;
in vec2 v_texCoord;
out vec4 fragColor;

float pseudoRandom(float seed) {
  return fract(sin(seed * 12.9898 + 78.233) * 43758.5453);
}

float hash2(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

float perlinNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = pseudoRandom(i.x + i.y * 157.0);
  float b = pseudoRandom(i.x + 1.0 + i.y * 157.0);
  float c = pseudoRandom(i.x + (i.y + 1.0) * 157.0);
  float d = pseudoRandom(i.x + 1.0 + (i.y + 1.0) * 157.0);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 2.0 - 1.0;
}

vec3 rgbToHsl(vec3 c) {
  float maxC = max(max(c.r, c.g), c.b);
  float minC = min(min(c.r, c.g), c.b);
  float l = (maxC + minC) * 0.5;
  float s = 0.0;
  float h = 0.0;
  if (maxC != minC) {
    float d = maxC - minC;
    s = l > 0.5 ? d / (2.0 - maxC - minC) : d / (maxC + minC);
    if (maxC == c.r)      h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
    else if (maxC == c.g) h = (c.b - c.r) / d + 2.0;
    else                  h = (c.r - c.g) / d + 4.0;
    h /= 6.0;
  }
  return vec3(h * 360.0, s, l);
}

float hueToRgbChannel(float p, float q, float t) {
  float tt = t;
  if (tt < 0.0) tt += 1.0;
  if (tt > 1.0) tt -= 1.0;
  if (tt < 1.0/6.0) return p + (q - p) * 6.0 * tt;
  if (tt < 0.5)     return q;
  if (tt < 2.0/3.0) return p + (q - p) * (2.0/3.0 - tt) * 6.0;
  return p;
}

vec3 hslToRgb(float h, float s, float l) {
  if (s == 0.0) return vec3(l);
  float q = l < 0.5 ? l * (1.0 + s) : l + s - l * s;
  float p = 2.0 * l - q;
  float hn = h / 360.0;
  return vec3(
    hueToRgbChannel(p, q, hn + 1.0/3.0),
    hueToRgbChannel(p, q, hn),
    hueToRgbChannel(p, q, hn - 1.0/3.0)
  );
}

vec4 sampleClamped(vec2 uv) {
  return texture(u_source, clamp(uv, 0.0, 1.0));
}
`;

export const PASSTHROUGH_FRAGMENT = `
void main() {
  fragColor = texture(u_source, v_texCoord);
}
`;

export function buildFragmentSrc(effectFragment: string): string {
  return FRAGMENT_PREAMBLE + "\n" + effectFragment;
}

export function compileShader(
  gl: WebGL2RenderingContext,
  type: GLenum,
  src: string,
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Failed to create shader object");
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile error:\n${log}`);
  }
  return shader;
}

export function createProgram(
  gl: WebGL2RenderingContext,
  vertSrc: string,
  fragSrc: string,
): WebGLProgram {
  const vert = compileShader(gl, gl.VERTEX_SHADER, vertSrc);
  const frag = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc);
  const program = gl.createProgram();
  if (!program) throw new Error("Failed to create program object");
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);
  gl.deleteShader(vert);
  gl.deleteShader(frag);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Program link error:\n${log}`);
  }
  return program;
}

const uniformLocationCache = new Map<WebGLProgram, Map<string, WebGLUniformLocation | null>>();

export function getUniformLocation(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  name: string
): WebGLUniformLocation | null {
  let programCache = uniformLocationCache.get(program);
  if (!programCache) {
    programCache = new Map();
    uniformLocationCache.set(program, programCache);
  }

  if (programCache.has(name)) {
    return programCache.get(name)!;
  }

  const loc = gl.getUniformLocation(program, name);
  programCache.set(name, loc);
  return loc;
}

export function clearUniformCache(program: WebGLProgram): void {
  uniformLocationCache.delete(program);
}

export function bindUniforms(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  resolution: [number, number],
  time: number,
  params: Record<string, unknown>,
  uniformTypes: Record<string, UniformType>,
): void {
  const resLoc = getUniformLocation(gl, program, "u_resolution");
  if (resLoc) gl.uniform2f(resLoc, resolution[0], resolution[1]);
  const timeLoc = getUniformLocation(gl, program, "u_time");
  if (timeLoc) gl.uniform1f(timeLoc, time);

  for (const [key, type] of Object.entries(uniformTypes)) {
    const loc = getUniformLocation(gl, program, `u_${key}`);
    if (!loc) continue;
    const raw = params[key];
    if (raw === undefined || raw === null) continue;
    switch (type) {
      case "float": gl.uniform1f(loc, raw as number); break;
      case "int":   gl.uniform1i(loc, raw as number); break;
      case "bool":  gl.uniform1i(loc, (raw as boolean) ? 1 : 0); break;
      case "vec2": { const v = raw as [number, number]; gl.uniform2f(loc, v[0], v[1]); break; }
      case "vec3": { const v = raw as [number, number, number]; gl.uniform3f(loc, v[0], v[1], v[2]); break; }
      case "vec4": { const v = raw as [number, number, number, number]; gl.uniform4f(loc, v[0], v[1], v[2], v[3]); break; }
    }
  }
}
