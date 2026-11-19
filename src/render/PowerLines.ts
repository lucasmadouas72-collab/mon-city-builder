import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { World } from '../sim/World';

const HEIGHT = 0.9;

/** Pylône en treillis stylisé. */
function pylonGeometry(): THREE.BufferGeometry {
  const mast = new THREE.CylinderGeometry(0.02, 0.09, HEIGHT, 4, 1, true).rotateY(Math.PI / 4).translate(0, HEIGHT / 2, 0);
  const arm = new THREE.BoxGeometry(0.42, 0.025, 0.025).translate(0, HEIGHT - 0.06, 0);
  const arm2 = new THREE.BoxGeometry(0.3, 0.02, 0.02).translate(0, HEIGHT - 0.2, 0);
  return mergeGeometries([mast.toNonIndexed(), arm.toNonIndexed(), arm2.toNonIndexed()])!;
}

/** Lignes haute tension : pylônes et câbles entre les cases reliées. */
export class PowerLines {
  readonly group = new THREE.Group();
  private pylons: THREE.InstancedMesh;
  private wires: THREE.LineSegments;

  constructor(private world: World) {
    this.pylons = new THREE.InstancedMesh(pylonGeometry(), new THREE.MeshStandardMaterial({ color: '#9aa1a8', roughness: 0.6, metalness: 0.4 }), 4096);
    this.pylons.castShadow = true;
    this.pylons.count = 0;
    this.pylons.frustumCulled = false;
    this.wires = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#3a3f45', transparent: true, opacity: 0.85 }));
    this.wires.frustumCulled = false;
    this.group.add(this.pylons, this.wires);
    this.rebuild();
  }

  rebuild(): void {
    const w = this.world, n = w.size;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
    const top = (k: number) => Math.max(w.heightAt((k % n) + 0.5, Math.floor(k / n) + 0.5), 0.3) + HEIGHT - 0.06;
    const pos: number[] = [];
    let count = 0;
    const has = (i: number, j: number) => w.inBounds(i, j) && w.powerLine[j * n + i] === 1;
    for (let k = 0; k < w.powerLine.length; k++) {
      if (!w.powerLine[k]) continue;
      const i = k % n, j = (k - i) / n;
      // Câbles vers les voisins (une seule fois par paire)
      let dirX = 0, dirZ = 0, links = 0;
      for (const [dx, dz] of [[1, 0], [0, 1], [1, 1], [-1, 1], [-1, 0], [0, -1], [-1, -1], [1, -1]]) {
        if (!has(i + dx, j + dz)) continue;
        links++;
        dirX += dx; dirZ += dz;
        if (dz < 0 || (dz === 0 && dx < 0)) continue;
        const q2 = (j + dz) * n + i + dx;
        for (const off of [-0.16, 0.16]) {
          const ox = -dz * off / Math.hypot(dx, dz), oz = dx * off / Math.hypot(dx, dz);
          pos.push(i + 0.5 + ox, top(k), j + 0.5 + oz, i + dx + 0.5 + ox, top(q2), j + dz + 0.5 + oz);
        }
      }
      // Un pylône toutes les deux cases, aux extrémités et aux virages
      if (count < 4096 && (links !== 2 || (i + j) % 2 === 0)) {
        const angle = Math.atan2(dirX, dirZ) + Math.PI / 2;
        q.setFromAxisAngle(up, links ? angle : 0);
        m.compose(new THREE.Vector3(i + 0.5, Math.max(w.heightAt(i + 0.5, j + 0.5), 0.3), j + 0.5), q, one);
        this.pylons.setMatrixAt(count++, m);
      }
    }
    this.pylons.count = count;
    this.pylons.instanceMatrix.needsUpdate = true;
    this.wires.geometry.dispose();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.wires.geometry = g;
  }
}
