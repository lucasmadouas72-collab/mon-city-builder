import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Traffic } from '../sim/Traffic';
import { VehicleKind } from '../sim/Traffic';
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
    this.meshes = [carGeometry(), truckGeometry(), busGeometry()].map((g) => {
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
    const counts = [0, 0, 0];
    for (const v of this.traffic.vehicles) {
      const k = v.kind === VehicleKind.Bus ? 2 : v.kind === VehicleKind.Truck ? 1 : 0;
      const mesh = this.meshes[k];
      const id = counts[k]++;
      if (id >= MAX) continue;
      const y = w.heightAt(v.x, v.z) + 0.04;
      // Inclinaison selon la pente
      const ahead = w.heightAt(v.x + v.hx * 0.1, v.z + v.hz * 0.1);
      const behind = w.heightAt(v.x - v.hx * 0.1, v.z - v.hz * 0.1);
      const pitch = -Math.atan2(ahead - behind, 0.2);
      this.e.set(pitch, Math.atan2(v.hx, v.hz), 0, 'YXZ');
      this.q.setFromEuler(this.e);
      this.p.set(v.x, y, v.z);
      mesh.setMatrixAt(id, this.m.compose(this.p, this.q, this.s));
      mesh.setColorAt(id, this.c.setHex(v.color));
    }
    this.meshes.forEach((mesh, k) => {
      mesh.count = Math.min(counts[k], MAX);
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    });
  }
}
