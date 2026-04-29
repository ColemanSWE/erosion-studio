import * as THREE from "three";

/**
 * Creates a simple procedural studio environment map for PBR materials.
 * Without an env map, MeshStandardMaterial with metalness > 0 reflects only
 * black (the transparent background), making metallic objects look dark.
 * This provides warm-neutral ambient reflections without needing an HDR file.
 */
export function createStudioEnvMap(renderer: THREE.WebGLRenderer): THREE.Texture {
  const w = 512, h = 256;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;

  // Sky band — soft off-white overhead light
  const sky = ctx.createLinearGradient(0, 0, 0, h * 0.55);
  sky.addColorStop(0, "#c8c8c8");
  sky.addColorStop(1, "#787878");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h * 0.55);

  // Ground band — dark warm shadow
  const ground = ctx.createLinearGradient(0, h * 0.55, 0, h);
  ground.addColorStop(0, "#404040");
  ground.addColorStop(1, "#181818");
  ctx.fillStyle = ground;
  ctx.fillRect(0, h * 0.55, w, h * 0.45);

  // Key light hot-spot — upper-left bright patch
  const key = ctx.createRadialGradient(w * 0.22, h * 0.18, 0, w * 0.22, h * 0.18, w * 0.45);
  key.addColorStop(0, "rgba(255,252,245,0.9)");
  key.addColorStop(0.4, "rgba(255,250,235,0.3)");
  key.addColorStop(1, "rgba(255,250,235,0)");
  ctx.fillStyle = key;
  ctx.fillRect(0, 0, w, h * 0.55);

  // Subtle fill light — right side, cool
  const fill = ctx.createRadialGradient(w * 0.82, h * 0.3, 0, w * 0.82, h * 0.3, w * 0.35);
  fill.addColorStop(0, "rgba(200,215,240,0.4)");
  fill.addColorStop(1, "rgba(200,215,240,0)");
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, w, h);

  const equiTex = new THREE.CanvasTexture(canvas);
  equiTex.mapping = THREE.EquirectangularReflectionMapping;
  equiTex.colorSpace = THREE.SRGBColorSpace;

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const envMap = pmrem.fromEquirectangular(equiTex).texture;
  pmrem.dispose();
  equiTex.dispose();

  return envMap;
}
