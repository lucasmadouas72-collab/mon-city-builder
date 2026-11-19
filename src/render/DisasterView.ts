import * as THREE from 'three';
import type { Simulation } from '../sim/Simulation';
import { Overlay } from './Overlay';

/** Eau de crue sur les cases inondées et tornade animée. */
export class DisasterView {
  readonly group = new THREE.Group();
  private flood: Overlay;
  private blue = new THREE.Color('#3b82c4');
  private funnel: THREE.Group;
  private debris: THREE.Points;

  constructor(private sim: Simulation) {
    this.flood = new Overlay(sim.world, { lift: 0.16, opacity: 0.72, pulse: false, inset: -0.02 });
    this.group.add(this.flood.group);

    // Entonnoir de tornade : cônes superposés semi-transparents
    this.funnel = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: '#6b7280', transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide });
    for (let k = 0; k < 5; k++) {
      const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.5 + k * 0.45, 0.12 + k * 0.3, 1.6, 14, 1, true), mat);
      cone.position.y = 0.8 + k * 1.5;
      this.funnel.add(cone);
    }
    const pts = new Float32Array(300 * 3);
    for (let k = 0; k < 300; k++) { const a = Math.random() * Math.PI * 2, r = 0.5 + Math.random() * 2.5; pts.set([Math.cos(a) * r, Math.random() * 4, Math.sin(a) * r], k * 3); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    this.debris = new THREE.Points(g, new THREE.PointsMaterial({ color: '#4b3a2a', size: 0.12 }));
    this.funnel.add(this.debris);
    this.funnel.visible = false;
    this.group.add(this.funnel);
    sim.events.on('floodChanged', () => this.refreshFlood());
  }

  refreshFlood(): void {
    const w = this.sim.world;
    const tiles: number[] = [];
    for (let k = 0; k < w.flooded.length; k++) if (w.flooded[k]) tiles.push(k);
    if (tiles.length) this.flood.set([[tiles, this.blue]]); else this.flood.clear();
  }

  update(time: number): void {
    const t = this.sim.disasters.active.find((d) => d.type === 'tornado' && d.status === 'active' && d.path && d.path.left > 0);
    this.funnel.visible = !!t;
    if (!t || !t.path) return;
    const w = this.sim.world;
    this.funnel.position.set(t.path.x, w.heightAt(t.path.x, t.path.z), t.path.z);
    this.funnel.children.forEach((c, k) => { c.rotation.y = time * (4 + k); c.position.x = Math.sin(time * 2 + k) * 0.15 * k; });
    this.debris.rotation.y = -time * 6;
  }
}
