import * as THREE from "three";

interface MeshRendererState {
  renderer: THREE.WebGLRenderer | null;
  scene: THREE.Scene | null;
  camera: THREE.PerspectiveCamera | null;
  geometry: THREE.PlaneGeometry | null;
  mesh: THREE.Mesh | THREE.Points | null;
  texture: THREE.CanvasTexture | null;
  lastDensity: number;
  lastMode: string;
  canvas: HTMLCanvasElement | null;
}

const state: MeshRendererState = {
  renderer: null,
  scene: null,
  camera: null,
  geometry: null,
  mesh: null,
  texture: null,
  lastDensity: -1,
  lastMode: "",
  canvas: null,
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
  state.renderer.setClearColor(0x000000, 1);

  state.scene = new THREE.Scene();

  const aspect = width / height;
  state.camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 1000);
  state.camera.position.set(0, 0, 2.5);
  state.camera.lookAt(0, 0, 0);
}

function updateGeometry(
  sourceCanvas: HTMLCanvasElement,
  density: number,
  displacementScale: number
): void {
  if (!state.scene) return;

  const segments = Math.floor(density * 50);

  if (state.geometry && state.lastDensity === density) {
    updateVertexDisplacement(sourceCanvas, displacementScale);
    return;
  }

  if (state.mesh) {
    state.scene.remove(state.mesh);
    state.mesh.geometry.dispose();
    if (state.mesh instanceof THREE.Mesh) {
      (state.mesh.material as THREE.Material).dispose();
    } else if (state.mesh instanceof THREE.Points) {
      (state.mesh.material as THREE.Material).dispose();
    }
    state.mesh = null;
  }

  if (state.geometry) {
    state.geometry.dispose();
  }

  state.geometry = new THREE.PlaneGeometry(2, 2, segments, segments);
  state.lastDensity = density;

  updateVertexDisplacement(sourceCanvas, displacementScale);
}

function updateVertexDisplacement(
  sourceCanvas: HTMLCanvasElement,
  displacementScale: number
): void {
  if (!state.geometry) return;

  const ctx = sourceCanvas.getContext("2d");
  if (!ctx) return;

  const width = sourceCanvas.width;
  const height = sourceCanvas.height;
  const imageData = ctx.getImageData(0, 0, width, height);

  const positions = state.geometry.attributes.position;
  const vertex = new THREE.Vector3();

  for (let i = 0; i < positions.count; i++) {
    vertex.fromBufferAttribute(positions, i);

    const u = (vertex.x + 1) / 2;
    const v = 1 - (vertex.y + 1) / 2;

    const x = Math.floor(u * (width - 1));
    const y = Math.floor(v * (height - 1));
    const index = (y * width + x) * 4;

    const r = imageData.data[index];
    const g = imageData.data[index + 1];
    const b = imageData.data[index + 2];
    const brightness = (r + g + b) / 3 / 255;

    positions.setZ(i, brightness * displacementScale * 0.5);
  }

  positions.needsUpdate = true;
  state.geometry.computeVertexNormals();
}

function updateMaterial(
  mode: string,
  wireframe: boolean,
  pointSize: number
): void {
  if (!state.geometry || !state.scene || !state.texture) return;

  const needsRebuild = state.lastMode !== mode;
  state.lastMode = mode;

  if (state.mesh && needsRebuild) {
    state.scene.remove(state.mesh);
    if (state.mesh instanceof THREE.Mesh) {
      (state.mesh.material as THREE.Material).dispose();
    } else if (state.mesh instanceof THREE.Points) {
      (state.mesh.material as THREE.Material).dispose();
    }
    state.mesh = null;
  }

  if (!state.mesh) {
    if (mode === "points") {
      const material = new THREE.PointsMaterial({
        size: pointSize,
        map: state.texture,
        vertexColors: false,
        sizeAttenuation: true,
      });
      state.mesh = new THREE.Points(state.geometry, material);
    } else {
      const material = new THREE.MeshBasicMaterial({
        map: state.texture,
        wireframe: mode === "mesh" ? wireframe : false,
        side: THREE.DoubleSide,
      });
      state.mesh = new THREE.Mesh(state.geometry, material);
    }
    state.scene.add(state.mesh);
  } else {
    if (state.mesh instanceof THREE.Mesh) {
      const mat = state.mesh.material as THREE.MeshBasicMaterial;
      mat.wireframe = mode === "mesh" ? wireframe : false;
    } else if (state.mesh instanceof THREE.Points) {
      const mat = state.mesh.material as THREE.PointsMaterial;
      mat.size = pointSize;
    }
  }
}

export function renderMesh(
  sourceCanvas: HTMLCanvasElement,
  params: Record<string, unknown>,
  width: number,
  height: number
): HTMLCanvasElement {
  const density = (params.density as number) || 2;
  const displacementScale = (params.displacementScale as number) || 3;
  const wireframe = (params.wireframe as boolean) ?? true;
  const mode = (params.mode as string) || "mesh";
  const pointSize = (params.pointSize as number) || 0.08;

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
    state.texture.needsUpdate = true;
  } else {
    state.texture.image = sourceCanvas;
    state.texture.needsUpdate = true;
  }

  updateGeometry(sourceCanvas, density, displacementScale);
  updateMaterial(mode, wireframe, pointSize);

  state.renderer.render(state.scene, state.camera);

  return state.canvas;
}

export function disposeMeshRenderer(): void {
  if (state.mesh) {
    state.scene?.remove(state.mesh);
    state.mesh.geometry.dispose();
    if (state.mesh instanceof THREE.Mesh) {
      (state.mesh.material as THREE.Material).dispose();
    } else if (state.mesh instanceof THREE.Points) {
      (state.mesh.material as THREE.Material).dispose();
    }
  }
  if (state.geometry) {
    state.geometry.dispose();
  }
  if (state.texture) {
    state.texture.dispose();
  }
  if (state.renderer) {
    state.renderer.dispose();
  }

  state.renderer = null;
  state.scene = null;
  state.camera = null;
  state.geometry = null;
  state.mesh = null;
  state.texture = null;
  state.canvas = null;
  state.lastDensity = -1;
  state.lastMode = "";
}
