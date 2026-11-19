import * as THREE from 'three';
import type { Simulation } from '../sim/Simulation';

/** Noms des quartiers affichés au-dessus de leur centre. */
export class DistrictLabels {
  readonly group = new THREE.Group();

  constructor(private sim: Simulation) {
    this.rebuild();
  }

  private sprite(text: string, color: string): THREE.Sprite {
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d')!;
    ctx.font = '700 44px system-ui, sans-serif';
    const w = Math.ceil(ctx.measureText(text).width) + 48;
    c.width = w; c.height = 72;
    ctx.font = '700 44px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(15, 23, 32, 0.78)';
    ctx.beginPath();
    ctx.roundRect(0, 0, w, 72, 20);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.fillRect(18, 26, 14, 20);
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 40, 38);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    s.scale.set(w / 72 * 1.6, 1.6, 1);
    s.renderOrder = 50;
    return s;
  }

  rebuild(): void {
    for (const c of [...this.group.children]) {
      const s = c as THREE.Sprite;
      s.material.map?.dispose();
      s.material.dispose();
      this.group.remove(s);
    }
    const w = this.sim.world, n = w.size;
    const acc = new Map<number, [number, number, number]>();
    for (let k = 0; k < w.district.length; k++) {
      const id = w.district[k];
      if (!id) continue;
      const a = acc.get(id) ?? [0, 0, 0];
      a[0] += k % n; a[1] += Math.floor(k / n); a[2]++;
      acc.set(id, a);
    }
    for (const [id, [sx, sz, cnt]] of acc) {
      const d = this.sim.districts.get(id);
      if (!d) continue;
      const x = sx / cnt + 0.5, z = sz / cnt + 0.5;
      const s = this.sprite(d.name, d.color);
      s.position.set(x, w.heightAt(x, z) + 3.5, z);
      this.group.add(s);
    }
  }
}
