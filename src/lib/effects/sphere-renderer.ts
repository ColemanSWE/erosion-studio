import * as THREE from "three";
import { createStudioEnvMap } from "./renderer-utils";

interface SphereRendererState {
  renderer: THREE.WebGLRenderer | null;
  scene: THREE.Scene | null;
  camera: THREE.PerspectiveCamera | null;
  mesh: THREE.Mesh | THREE.Points | null;
  texture: THREE.CanvasTexture | null;
  canvas: HTMLCanvasElement | null;
  envMap: THREE.Texture | null;
  lastMode: string;
  rotation: number;
  lastRoughness: number;
  lastMetalness: number;
}

const state: SphereRendererState = {
  renderer: null,
  scene: null,
  camera: null,
  mesh: null,
  texture: null,
  canvas: null,
  envMap: null,
  lastMode: "",
  rotation: 0,
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

  state.envMap = createStudioEnvMap(state.renderer);
  state.scene.environment = state.envMap;

  const aspect = width / height;
  state.camera = new THREE.PerspectiveCamera(50, aspect, 0.1, 1000);
  state.camera.position.set(0, 0, 2.8);
  state.camera.lookAt(0, 0, 0);
}

export function renderSphere(
  sourceCanvas: HTMLCanvasElement,
  params: Record<string, unknown>,
  width: number,
  height: number
): HTMLCanvasElement {
  const rotationSpeed = (params.rotationSpeed as number) ?? 0.5;
  const tilt = ((params.tilt as number) ?? 15) * (Math.PI / 180);
  const mode = (params.mode as string) ?? "solid";
  const zoom = (params.zoom as number) ?? 1.0;
  const roughness = (params.roughness as number) ?? 0.4;
  const metalness = (params.metalness as number) ?? 0.1;

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

  const needsRebuild = state.lastMode !== mode;
  state.lastMode = mode;

  if (state.mesh && needsRebuild) {
    state.scene.remove(state.mesh);
    if (state.mesh instanceof THREE.Mesh) {
      (state.mesh.material as THREE.Material).dispose();
    } else if (state.mesh instanceof THREE.Points) {
      (state.mesh.material as THREE.Material).dispose();
    }
    state.mesh.geometry.dispose();
    state.mesh = null;
  }

  if (!state.mesh) {
    const geometry = new THREE.SphereGeometry(1, 64, 64);

    if (mode === "points") {
      const mat = new THREE.PointsMaterial({
        size: 0.03,
        map: state.texture,
        sizeAttenuation: true,
      });
      state.mesh = new THREE.Points(geometry, mat);
    } else {
      const mat = new THREE.MeshStandardMaterial({
        map: state.texture,
        roughness,
        metalness,
        wireframe: mode === "wireframe",
        side: THREE.FrontSide,
      });
      state.mesh = new THREE.Mesh(geometry, mat);
    }
    state.scene.add(state.mesh);
    state.lastRoughness = roughness;
    state.lastMetalness = metalness;
  } else if (state.mesh instanceof THREE.Mesh) {
    const mat = state.mesh.material as THREE.MeshStandardMaterial;
    mat.map = state.texture;
    mat.wireframe = mode === "wireframe";
    if (roughness !== state.lastRoughness || metalness !== state.lastMetalness) {
      mat.roughness = roughness;
      mat.metalness = metalness;
      state.lastRoughness = roughness;
      state.lastMetalness = metalness;
    }
  } else if (state.mesh instanceof THREE.Points) {
    const mat = state.mesh.material as THREE.PointsMaterial;
    mat.map = state.texture;
    mat.needsUpdate = true;
  }

  state.rotation += rotationSpeed * 0.02;
  state.mesh.rotation.y = state.rotation;
  state.mesh.rotation.x = tilt;

  state.camera.position.z = 2.8 / zoom;
  state.camera.updateProjectionMatrix();

  state.renderer.render(state.scene, state.camera);
  return state.canvas;
}

export function disposeSphereRenderer(): void {
  if (state.mesh) {
    state.scene?.remove(state.mesh);
    state.mesh.geometry.dispose();
    if (state.mesh instanceof THREE.Mesh) {
      (state.mesh.material as THREE.Material).dispose();
    } else if (state.mesh instanceof THREE.Points) {
      (state.mesh.material as THREE.Material).dispose();
    }
  }
  if (state.envMap) state.envMap.dispose();
  if (state.texture) state.texture.dispose();
  if (state.renderer) state.renderer.dispose();

  state.renderer = null;
  state.scene = null;
  state.camera = null;
  state.mesh = null;
  state.texture = null;
  state.canvas = null;
  state.envMap = null;
  state.lastMode = "";
  state.rotation = 0;
  state.lastRoughness = -1;
  state.lastMetalness = -1;
}
