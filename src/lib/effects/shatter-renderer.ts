import * as THREE from "three";

interface ShardData {
  vertices: [number, number, number, number, number, number];
  uvs: [number, number, number, number, number, number];
  centroid: THREE.Vector3;
  velocity: THREE.Vector3;
  angularVel: THREE.Euler;
  phase: number;
}

interface ShatterRendererState {
  renderer: THREE.WebGLRenderer | null;
  scene: THREE.Scene | null;
  camera: THREE.PerspectiveCamera | null;
  canvas: HTMLCanvasElement | null;
  shards: ShardData[];
  meshGroup: THREE.Group | null;
  texture: THREE.CanvasTexture | null;
  lastFragments: number;
  lastMode: string;
  lastRoughness: number;
  lastMetalness: number;
}

const state: ShatterRendererState = {
  renderer: null,
  scene: null,
  camera: null,
  canvas: null,
  shards: [],
  meshGroup: null,
  texture: null,
  lastFragments: -1,
  lastMode: "",
  lastRoughness: -1,
  lastMetalness: -1,
};

function pseudoRandom(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function generateShards(fragments: number): ShardData[] {
  const shards: ShardData[] = [];

  const gridSize = Math.ceil(Math.sqrt(fragments));
  for (let gy = 0; gy < gridSize; gy++) {
    for (let gx = 0; gx < gridSize; gx++) {
      const noise = 0.4 / gridSize;
      const x0 = gx / gridSize + pseudoRandom(gy * 100 + gx * 7) * noise;
      const y0 = gy / gridSize + pseudoRandom(gy * 100 + gx * 13) * noise;
      const x1 = (gx + 1) / gridSize + pseudoRandom(gy * 100 + gx * 7 + 1) * noise;
      const y1 = (gy + 1) / gridSize + pseudoRandom(gy * 100 + gx * 13 + 1) * noise;

      const ax = x0 * 2 - 1, ay = y0 * 2 - 1;
      const bx = x1 * 2 - 1, by = y0 * 2 - 1;
      const cx = x1 * 2 - 1, cy = y1 * 2 - 1;
      const dx = x0 * 2 - 1, dy = y1 * 2 - 1;

      const centroid1 = new THREE.Vector3((ax + bx + cx) / 3, (ay + by + cy) / 3, 0);
      shards.push({
        vertices: [ax, ay, 0, bx, by, 0],
        uvs: [x0, 1 - y0, x1, 1 - y0, x1, 1 - y1],
        centroid: centroid1,
        velocity: new THREE.Vector3(
          centroid1.x * (0.8 + pseudoRandom(gy * 100 + gx) * 0.4),
          centroid1.y * (0.8 + pseudoRandom(gy * 100 + gx + 50) * 0.4),
          pseudoRandom(gy * 100 + gx + 99) * 0.5,
        ),
        angularVel: new THREE.Euler(
          (pseudoRandom(gy * 100 + gx + 200) - 0.5) * 2,
          (pseudoRandom(gy * 100 + gx + 300) - 0.5) * 2,
          (pseudoRandom(gy * 100 + gx + 400) - 0.5) * 3,
        ),
        phase: pseudoRandom(gy * 100 + gx + 500),
      });

      const centroid2 = new THREE.Vector3((ax + cx + dx) / 3, (ay + cy + dy) / 3, 0);
      shards.push({
        vertices: [ax, ay, 0, cx, cy, 0],
        uvs: [x0, 1 - y0, x1, 1 - y1, x0, 1 - y1],
        centroid: centroid2,
        velocity: new THREE.Vector3(
          centroid2.x * (0.8 + pseudoRandom(gy * 200 + gx) * 0.4),
          centroid2.y * (0.8 + pseudoRandom(gy * 200 + gx + 50) * 0.4),
          pseudoRandom(gy * 200 + gx + 99) * 0.5,
        ),
        angularVel: new THREE.Euler(
          (pseudoRandom(gy * 200 + gx + 200) - 0.5) * 2,
          (pseudoRandom(gy * 200 + gx + 300) - 0.5) * 2,
          (pseudoRandom(gy * 200 + gx + 400) - 0.5) * 3,
        ),
        phase: pseudoRandom(gy * 200 + gx + 500),
      });
    }
  }

  return shards;
}

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
  state.camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 1000);
  state.camera.position.set(0, 0, 2.5);
  state.camera.lookAt(0, 0, 0);
}

export function renderShatter(
  sourceCanvas: HTMLCanvasElement,
  params: Record<string, unknown>,
  width: number,
  height: number
): HTMLCanvasElement {
  const fragments = Math.round((params.fragments as number) ?? 6);
  const force = (params.force as number) ?? 1.0;
  const progress = (params.progress as number) ?? 0.5;
  const rotateShards = (params.rotateShards as boolean) ?? true;
  const mode = (params.mode as string) ?? "explode";
  const roughness = (params.roughness as number) ?? 0.3;
  const metalness = (params.metalness as number) ?? 0.5;

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

  if (state.lastFragments !== fragments || state.lastMode !== mode) {
    state.lastFragments = fragments;
    state.lastMode = mode;
    state.shards = generateShards(fragments);

    if (state.meshGroup) {
      state.scene.remove(state.meshGroup);
      state.meshGroup.children.forEach((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          (child.material as THREE.Material).dispose();
        }
      });
    }
    state.meshGroup = new THREE.Group();
    state.scene.add(state.meshGroup);

    for (const shard of state.shards) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute([
        shard.vertices[0] - shard.centroid.x, shard.vertices[1] - shard.centroid.y, 0,
        shard.vertices[2] - shard.centroid.x, shard.vertices[3] - shard.centroid.y, 0,
        shard.vertices[4] - shard.centroid.x, shard.vertices[5] - shard.centroid.y, 0,
      ], 3));
      geo.setAttribute("uv", new THREE.Float32BufferAttribute(shard.uvs, 2));
      geo.computeVertexNormals();
      const mat = new THREE.MeshStandardMaterial({
        map: state.texture,
        roughness,
        metalness,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(shard.centroid);
      state.meshGroup.add(mesh);
    }
    state.lastRoughness = roughness;
    state.lastMetalness = metalness;
  } else if (state.meshGroup) {
    const needsMaterialUpdate =
      roughness !== state.lastRoughness || metalness !== state.lastMetalness;

    state.meshGroup.children.forEach((child) => {
      if (child instanceof THREE.Mesh) {
        const mat = child.material as THREE.MeshStandardMaterial;
        mat.map = state.texture;
        if (needsMaterialUpdate) {
          mat.roughness = roughness;
          mat.metalness = metalness;
        }
      }
    });

    if (needsMaterialUpdate) {
      state.lastRoughness = roughness;
      state.lastMetalness = metalness;
    }
  }

  if (state.meshGroup) {
    const t = mode === "implode"
      ? 1 - progress
      : mode === "float"
        ? Math.sin(progress * Math.PI * 2) * 0.5 + 0.5
        : progress;
    const eased = t * t * (3 - 2 * t);

    state.shards.forEach((shard, idx) => {
      const child = state.meshGroup!.children[idx] as THREE.Mesh;
      if (!child) return;

      const delay = shard.phase * 0.3;
      const localT = Math.max(0, Math.min(1, (eased - delay) / (1 - delay)));

      child.position.set(
        shard.centroid.x + shard.velocity.x * force * localT * 1.5,
        shard.centroid.y + shard.velocity.y * force * localT * 1.5,
        shard.centroid.z + shard.velocity.z * force * localT,
      );

      if (rotateShards) {
        child.rotation.x = shard.angularVel.x * localT * force;
        child.rotation.y = shard.angularVel.y * localT * force;
        child.rotation.z = shard.angularVel.z * localT * force;
      }
    });
  }

  state.renderer.render(state.scene, state.camera);
  return state.canvas;
}

export function disposeShatterRenderer(): void {
  if (state.meshGroup) {
    state.meshGroup.children.forEach((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
    });
    state.scene?.remove(state.meshGroup);
  }
  if (state.texture) state.texture.dispose();
  if (state.renderer) state.renderer.dispose();

  state.renderer = null;
  state.scene = null;
  state.camera = null;
  state.canvas = null;
  state.shards = [];
  state.meshGroup = null;
  state.texture = null;
  state.lastFragments = -1;
  state.lastMode = "";
  state.lastRoughness = -1;
  state.lastMetalness = -1;
}
