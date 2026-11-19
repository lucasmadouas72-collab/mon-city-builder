import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Traffic } from '../sim/Traffic';
import type { World } from '../sim/World';
import { patchEnv } from './envMaterials';

const MAX = 1600;

function part(geo: THREE.BufferGeometry, color: string, x: number, y: number, z: number): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  g.translate(x, y, z);
  const c = new THREE.Color(color);
  const arr = new Float32Array(g.attributes.position.count * 3);
  for (let k = 0; k < arr.length; k += 3) { arr[k] = c.r; arr[k + 1] = c.g; arr[k + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

/** Voiture : avant vers +z. La carrosserie est blanche pour être teintée par instance. */
function carGeometry(): THREE.BufferGeometry {
  const B = THREE.BoxGeometry;
  return mergeGeometries([
    part(new B(0.11, 0.045, 0.22), '#ffffff', 0, 0.035, 0),
    part(new B(0.096, 0.04, 0.11), '#ffffff', 0, 0.075, -0.012),
    part(new B(0.1, 0.03, 0.112), '#1d2733', 0, 0.072, -0.012), // vitres
    part(new B(0.115, 0.022, 0.04), '#141414', 0, 0.018, 0.065), // roues
    part(new B(0.115, 0.022, 0.04), '#141414', 0, 0.018, -0.065),
    part(new B(0.08, 0.012, 0.004), '#fff6c8', 0, 0.042, 0.111), // phares
  ])!;
}

function truckGeometry(): THREE.BufferGeometry {
  const B = THREE.BoxGeometry;
  return mergeGeometries([
    part(new B(0.12, 0.1, 0.22), '#ffffff', 0, 0.075, -0.05), // caisse
    part(new B(0.12, 0.07, 0.09), '#ffffff', 0, 0.06, 0.11), // cabine
    part(new B(0.122, 0.03, 0.06), '#1d2733', 0, 0.078, 0.125),
    part(new B(0.125, 0.024, 0.04), '#141414', 0, 0.02, 0.11),
    part(new B(0.125, 0.024, 0.05), '#141414', 0, 0.02, -0.1),
  ])!;
}

function busGeometry(): THREE.BufferGeometry {
  const B = THREE.BoxGeometry;
  return mergeGeometries([
    part(new B(0.13, 0.11, 0.36), '#ffffff', 0, 0.075, 0),
    part(new B(0.132, 0.04, 0.34), '#1d2733', 0, 0.1, 0), // vitres
    part(new B(0.12, 0.012, 0.3), '#f5f5f4', 0, 0.136, 0), // toit
    part(new B(0.135, 0.026, 0.05), '#141414', 0, 0.02, 0.12),
    part(new B(0.135, 0.026, 0.05), '#141414', 0, 0.02, -0.12),
    part(new B(0.1, 0.02, 0.004), '#fde047', 0, 0.12, 0.181), // girouette
  ])!;
}

function ambulanceGeometry(): THREE.BufferGeometry {
  const B = THREE.BoxGeometry;
  return mergeGeometries([
    part(new B(0.12, 0.1, 0.2), '#ffffff', 0, 0.07, -0.03),
    part(new B(0.12, 0.065, 0.08), '#ffffff', 0, 0.055, 0.1),
    part(new B(0.122, 0.028, 0.05), '#1d2733', 0, 0.075, 0.11),
    part(new B(0.123, 0.018, 0.2), '#e11d48', 0, 0.075, -0.03), // bande rouge
    part(new B(0.07, 0.02, 0.03), '#ff4d4d', 0, 0.13, 0.04), // gyrophare
    part(new B(0.125, 0.024, 0.04), '#141414', 0, 0.02, 0.09),
    part(new B(0.125, 0.024, 0.04), '#141414', 0, 0.02, -0.09),
  ])!;
}

function fireTruckGeometry(): THREE.BufferGeometry {
  const B = THREE.BoxGeometry;
  return mergeGeometries([
    part(new B(0.13, 0.1, 0.3), '#ffffff', 0, 0.07, -0.04),
    part(new B(0.13, 0.08, 0.1), '#ffffff', 0, 0.065, 0.15),
    part(new B(0.132, 0.03, 0.06), '#1d2733', 0, 0.085, 0.17),
    part(new B(0.04, 0.025, 0.28), '#d1d5db', 0, 0.135, -0.04), // échelle
    part(new B(0.08, 0.02, 0.03), '#ffd23f', 0, 0.115, 0.13),
    part(new B(0.135, 0.026, 0.05), '#141414', 0, 0.02, 0.13),
    part(new B(0.135, 0.026, 0.05), '#141414', 0, 0.02, -0.12),
  ])!;
}

function policeGeometry(): THREE.BufferGeometry {
  const B = THREE.BoxGeometry;
  return mergeGeometries([
    part(new B(0.11, 0.045, 0.22), '#ffffff', 0, 0.035, 0),
    part(new B(0.096, 0.04, 0.11), '#ffffff', 0, 0.075, -0.012),
    part(new B(0.1, 0.03, 0.112), '#1d2733', 0, 0.072, -0.012),
    part(new B(0.112, 0.016, 0.22), '#f8fafc', 0, 0.04, 0), // bande blanche
    part(new B(0.07, 0.016, 0.025), '#60a5fa', 0, 0.103, -0.01), // rampe lumineuse
    part(new B(0.115, 0.022, 0.04), '#141414', 0, 0.018, 0.065),
    part(new B(0.115, 0.022, 0.04), '#141414', 0, 0.018, -0.065),
  ])!;
}

function garbageGeometry(): THREE.BufferGeometry {
  const B = THREE.BoxGeometry;
  return mergeGeometries([
    part(new B(0.12, 0.11, 0.2), '#ffffff', 0, 0.08, -0.05), // benne (teintée)
    part(new B(0.11, 0.02, 0.05), '#3a3a3a', 0, 0.12, -0.15), // compacteur
    part(new B(0.12, 0.075, 0.08), '#e5e7eb', 0, 0.062, 0.1), // cabine
    part(new B(0.122, 0.03, 0.05), '#1d2733', 0, 0.08, 0.115),
    part(new B(0.06, 0.016, 0.02), '#f59e0b', 0, 0.108, 0.1), // feu orange
    part(new B(0.125, 0.024, 0.04), '#141414', 0, 0.02, 0.1),
    part(new B(0.125, 0.024, 0.05), '#141414', 0, 0.02, -0.1),
  ])!;
}

/** Rendu instancié des véhicules, synchronisé à chaque image sur la simulation. */
export class Vehicles {
  readonly group = new THREE.Group();
  private meshes: THREE.InstancedMesh[];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3(1, 1, 1);
  private c = new THREE.Color();

  constructor(private world: World, private traffic: Traffic) {
    const mat = patchEnv(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.25 }), { headlights: true, snow: true });
    this.meshes = [carGeometry(), truckGeometry(), busGeometry(), ambulanceGeometry(), fireTruckGeometry(), policeGeometry(), garbageGeometry()].map((g) => {
      const mesh = new THREE.InstancedMesh(g, mat, MAX);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.setColorAt(0, this.c.set('#ffffff'));
      this.group.add(mesh);
      return mesh;
    });
  }

  update(): void {
    const w = this.world;
    const counts = [0, 0, 0, 0, 0, 0, 0];
    const flash = Math.floor(performance.now() / 180) % 2 === 0;
    for (const v of this.traffic.vehicles) {
      const k = v.kind as number;
      const mesh = this.meshes[k];
      const id = counts[k]++;
      if (id >= MAX) continue;
      const y = w.roadY(v.x, v.z) + 0.04;
      // Inclinaison selon la pente
      const ahead = w.roadY(v.x + v.hx * 0.1, v.z + v.hz * 0.1);
      const behind = w.roadY(v.x - v.hx * 0.1, v.z - v.hz * 0.1);
      const pitch = -Math.atan2(ahead - behind, 0.2);
      this.e.set(pitch, Math.atan2(v.hx, v.hz), 0, 'YXZ');
      this.q.setFromEuler(this.e);
      this.p.set(v.x, y, v.z);
      mesh.setMatrixAt(id, this.m.compose(this.p, this.q, this.s));
      mesh.setColorAt(id, this.c.setHex(v.color));
      // Gyrophares : la teinte alterne pendant une intervention (pas au retour)
      if (k >= 3 && k <= 5 && v.mission > 0 && flash) this.c.offsetHSL(0, 0, k === 5 ? 0.25 : 0.12), mesh.setColorAt(id, this.c);
    }
    this.meshes.forEach((mesh, k) => {
      mesh.count = Math.min(counts[k], MAX);
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    });
  }
}
