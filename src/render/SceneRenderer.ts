import * as THREE from 'three';
import type { World } from '../sim/World';
import { RoadMesh } from './RoadMesh';
import { createTerrainMesh, createWater } from './TerrainMesh';
import { Trees } from './Trees';
import { Overlay } from './Overlay';
import { Buildings } from './Buildings';
import { BuildState, ZONE_INFO, type ZoneType } from '../sim/zones';

function createSky(): THREE.Mesh {
  const geo = new THREE.SphereGeometry(900, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color('#4f93d6') },
      horizon: { value: new THREE.Color('#cfe6f5') },
      bottom: { value: new THREE.Color('#e9eef0') },
    },
    vertexShader: `varying vec3 vPos; void main(){ vPos = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; varying vec3 vPos;
      void main(){ float h = vPos.y; vec3 c = h > 0.0 ? mix(horizon, top, pow(h, 0.6)) : mix(horizon, bottom, min(1.0, -h * 4.0));
      gl_FragColor = vec4(c, 1.0); }`,
  });
  const sky = new THREE.Mesh(geo, mat);
  sky.frustumCulled = false;
  return sky;
}

/** Scène 3D : lumières, ciel, terrain, eau, routes, arbres et surcouches. */
export class SceneRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly terrain: THREE.Mesh;
  readonly roads: RoadMesh;
  readonly trees: Trees;
  readonly overlay: Overlay;
  readonly zoneOverlay: Overlay;
  readonly buildings: Buildings;
  private zoneColors = new Map<number, THREE.Color>();
  water: ReturnType<typeof createWater>;
  readonly sun: THREE.DirectionalLight;
  readonly sky: THREE.Mesh;
  readonly hemi: THREE.HemisphereLight;
  readonly ground: THREE.Mesh;

  constructor(container: HTMLElement, world: World) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(40, container.clientWidth / container.clientHeight, 0.5, 2000);

    const n = world.size;
    this.scene.fog = new THREE.Fog('#cfe3ef', 180, 520);
    this.sky = createSky();
    this.scene.add(this.sky);

    // Lumières
    this.hemi = new THREE.HemisphereLight('#dceeff', '#6f6a55', 1.1);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#fff3dd', 2.4);
    this.sun.position.set(n / 2 - 60, 90, n / 2 - 40);
    this.sun.target.position.set(n / 2, 0, n / 2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    const sc = this.sun.shadow.camera;
    sc.left = -n * 0.78; sc.right = n * 0.78; sc.top = n * 0.78; sc.bottom = -n * 0.78;
    sc.near = 10; sc.far = 300;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target);

    // Monde
    this.terrain = createTerrainMesh(world);
    this.water = createWater(world);
    this.roads = new RoadMesh(world);
    this.trees = new Trees(world);
    this.overlay = new Overlay(world);
    this.zoneOverlay = new Overlay(world, { lift: 0.04, opacity: 0.32, pulse: false, inset: 0.06 });
    this.buildings = new Buildings(world);
    this.scene.add(this.terrain, this.water.mesh, this.roads.mesh, this.trees.group, this.zoneOverlay.group, this.buildings.group, this.overlay.group);
    this.refreshZones(world);

    // Sol lointain sous la maquette
    const ground = this.ground = new THREE.Mesh(
      new THREE.CircleGeometry(1200, 48).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: '#d9e2e4', roughness: 1 }),
    );
    ground.position.set(n / 2, -4.05, n / 2);
    ground.receiveShadow = true;
    this.scene.add(ground);

    window.addEventListener('resize', () => this.resize(container));
  }

  /** Teinte les cases zonées encore vides. */
  refreshZones(world: World): void {
    const layers = new Map<number, number[]>();
    for (let k = 0; k < world.zones.length; k++) {
      const z = world.zones[k];
      if (!z || world.bState[k] !== BuildState.Empty) continue;
      let l = layers.get(z);
      if (!l) layers.set(z, (l = []));
      l.push(k);
    }
    this.zoneOverlay.set([...layers].map(([z, tiles]) => {
      let c = this.zoneColors.get(z);
      if (!c) this.zoneColors.set(z, (c = new THREE.Color(ZONE_INFO[z as ZoneType].color)));
      return [tiles, c] as [number[], THREE.Color];
    }));
  }

  private resize(container: HTMLElement): void {
    this.camera.aspect = container.clientWidth / container.clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(container.clientWidth, container.clientHeight);
  }

  render(time: number): void {
    this.water.update(time);
    this.overlay.update(time);
    this.buildings.update(time);
    this.sky.position.copy(this.camera.position);
    this.renderer.render(this.scene, this.camera);
  }
}
