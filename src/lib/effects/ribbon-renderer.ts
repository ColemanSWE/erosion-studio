import * as THREE from "three";

interface RibbonRendererState {
  renderer: THREE.WebGLRenderer | null;
  scene: THREE.Scene | null;
  camera: THREE.PerspectiveCamera | null;
  mesh: THREE.Mesh | null;
  texture: THREE.CanvasTexture | null;
  canvas: HTMLCanvasElement | null;
  lastSegments: number;
  lastMode: string;
  geometry: THREE.BufferGeometry | null;
  lastRoughness: number;
  lastMetalness: number;
}

const state: RibbonRendererState = {
  renderer: null,
  scene: null,
  camera: null,
  mesh: null,
  texture: null,
  canvas: null,
  lastSegments: -1,
  lastMode: "",
  geometry: null,
  lastRoughness: -1,
  lastMetalness: -1,
};

function initializeRenderer(width: number, height: number): void {
  if (state.renderer) return;

  state.canvas = document.createElement("canvas");
  state.renderer = new THREE.WebGLRenderer({
    canvas: state.canvas,
    alpha: true,
    antialias: true,
  });
  state.renderer.setSize(width, height);
  state.renderer.setClearColor(0x000000, 0);

  state.scene = new THREE.Scene();

  const ambient = new THREE.AmbientLight(0xffffff, 0.5);
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(3, 3, 5);
  const fill = new THREE.DirectionalLight(0x8899ff, 0.4);
  fill.position.set(-3, 0, 2);
  const rim = new THREE.DirectionalLight(0xffffff, 0.25);
  rim.position.set(0, -3, -2);
  state.scene.add(ambient, key, fill, rim);

  const aspect = width / height;
  state.camera = new THREE.PerspectiveCamera(50, aspect, 0.1, 1000);
  state.camera.position.set(0, 0, 3.5);
  state.camera.lookAt(0, 0, 0);
}

function buildRibbonGeometry(segments: number, mode: string): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const u = t;

    let px: number, py: number, pz: number;
    if (mode === "helix") {
      const angle = t * Math.PI * 4;
      px = Math.cos(angle) * 1.2;
      py = (t - 0.5) * 2.0;
      pz = Math.sin(angle) * 1.2;
    } else if (mode === "wave") {
      px = (t - 0.5) * 3.0;
      py = Math.sin(t * Math.PI * 3) * 0.6;
      pz = Math.cos(t * Math.PI * 2) * 0.4;
    } else {
      px = (t - 0.5) * 3.0;
      py = 0;
      pz = 0;
    }

    const twistAngle = t * Math.PI * 2;
    const wx = Math.cos(twistAngle) * 0.4;
    const wy = Math.sin(twistAngle) * 0.4;

    positions.push(px - wx, py - wy, pz);
    positions.push(px + wx, py + wy, pz);

    uvs.push(u, 0);
    uvs.push(u, 1);

    if (i < segments) {
      const base = i * 2;
      indices.push(base, base + 1, base + 2);
      indices.push(base + 1, base + 3, base + 2);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function updateRibbonGeometry(segments: number, mode: string, time: number, amplitude: number): void {
  if (!state.geometry) return;

  const positions = state.geometry.attributes.position as THREE.BufferAttribute;

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const vertexBase = i * 2;

    let px: number, py: number, pz: number;
    if (mode === "helix") {
      const angle = t * Math.PI * 4;
      px = Math.cos(angle) * 1.2;
      py = (t - 0.5) * 2.0;
      pz = Math.sin(angle) * 1.2;
    } else if (mode === "wave") {
      px = (t - 0.5) * 3.0;
      py = Math.sin(t * Math.PI * 3 + time) * 0.6 * amplitude;
      pz = Math.cos(t * Math.PI * 2 + time * 0.7) * 0.4;
    } else {
      px = (t - 0.5) * 3.0;
      py = Math.sin(t * Math.PI * 2 + time) * 0.3 * amplitude;
      pz = Math.cos(t * Math.PI * 1.5 + time * 0.8) * 0.2 * amplitude;
    }

    const twistAngle = t * Math.PI * 2 + time * 0.5;
    const wx = Math.cos(twistAngle) * 0.4;
    const wy = Math.sin(twistAngle) * 0.4;

    positions.setXYZ(vertexBase, px - wx, py - wy, pz);
    positions.setXYZ(vertexBase + 1, px + wx, py + wy, pz);
  }

  positions.needsUpdate = true;
  state.geometry.computeVertexNormals();
}

export function renderRibbon(
  sourceCanvas: HTMLCanvasElement,
  params: Record<string, unknown>,
  width: number,
  height: number
): HTMLCanvasElement {
  const twist = (params.twist as number) ?? 1.0;
  const amplitude = (params.amplitude as number) ?? 1.0;
  const speed = (params.speed as number) ?? 1.0;
  const segments = Math.round((params.segments as number) ?? 120);
  const mode = (params.mode as string) ?? "ribbon";
  const roughness = (params.roughness as number) ?? 0.3;
  const metalness = (params.metalness as number) ?? 0.2;

  initializeRenderer(width, height);

  if (!state.renderer || !state.scene || !state.camera || !state.canvas) {
    return sourceCanvas;
  }

  if (state.renderer.domElement.width !== width || state.renderer.domElement.height !== height) {
    state.renderer.setSize(width, height);
    state.camera.aspect = width / height;
    state.camera.updateProjectionMatrix();
  }

  if (!state.texture) {
    state.texture = new THREE.CanvasTexture(sourceCanvas);
  } else {
    state.texture.image = sourceCanvas;
    state.texture.needsUpdate = true;
  }

  const needsRebuild = state.lastSegments !== segments || state.lastMode !== mode;

  if (needsRebuild) {
    state.lastSegments = segments;
    state.lastMode = mode;

    if (state.mesh) {
      state.scene.remove(state.mesh);
      state.mesh.geometry.dispose();
      (state.mesh.material as THREE.Material).dispose();
      state.mesh = null;
    }
    if (state.geometry) {
      state.geometry.dispose();
    }

    state.geometry = buildRibbonGeometry(segments, mode);
    const mat = new THREE.MeshStandardMaterial({
      map: state.texture,
      roughness,
      metalness,
      side: THREE.DoubleSide,
    });
    state.mesh = new THREE.Mesh(state.geometry, mat);
    state.scene.add(state.mesh);
    state.lastRoughness = roughness;
    state.lastMetalness = metalness;
  } else if (state.mesh) {
    const mat = state.mesh.material as THREE.MeshStandardMaterial;
    mat.map = state.texture;
    if (roughness !== state.lastRoughness || metalness !== state.lastMetalness) {
      mat.roughness = roughness;
      mat.metalness = metalness;
      state.lastRoughness = roughness;
      state.lastMetalness = metalness;
    }
  }

  const time = (Date.now() % 1000000) / 1000 * speed;
  updateRibbonGeometry(segments, mode, time, amplitude);

  if (state.mesh) {
    state.mesh.rotation.y = time * 0.3 * twist;
  }

  state.renderer.render(state.scene, state.camera);
  return state.canvas;
}

export function disposeRibbonRenderer(): void {
  if (state.mesh) {
    state.scene?.remove(state.mesh);
    state.mesh.geometry.dispose();
    (state.mesh.material as THREE.Material).dispose();
  }
  if (state.geometry) state.geometry.dispose();
  if (state.texture) state.texture.dispose();
  if (state.renderer) state.renderer.dispose();

  state.renderer = null;
  state.scene = null;
  state.camera = null;
  state.mesh = null;
  state.texture = null;
  state.canvas = null;
  state.lastSegments = -1;
  state.lastMode = "";
  state.geometry = null;
  state.lastRoughness = -1;
  state.lastMetalness = -1;
}
