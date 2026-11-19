import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng } from '../core/noise';
import { Zone } from '../sim/zones';

/**
 * Bibliothèque procédurale des bâtiments (§6). Chaque modèle est centré sur sa parcelle,
 * façade vers +z, largeur (façade) selon x, profondeur selon z, sol du terrain à y = 0.
 * Les modèles varient selon la zone, le niveau, la variante, le style architectural
 * (classique, moderne, méditerranéen, montagnard) et la taille de parcelle (1×1 à 3×3).
 * Ils sont créés à la demande puis gardés en cache.
 */

export const FLOOR = 0.13;

export class Builder {
  parts: THREE.BufferGeometry[] = [];

  add(geo: THREE.BufferGeometry, color: string, x = 0, y = 0, z = 0, ry = 0): this {
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.deleteAttribute('uv');
    if (ry) g.rotateY(ry);
    g.translate(x, y, z);
    const c = new THREE.Color(color);
    const arr = new Float32Array(g.attributes.position.count * 3);
    for (let k = 0; k < arr.length; k += 3) { arr[k] = c.r; arr[k + 1] = c.g; arr[k + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    if (!g.attributes.normal) g.computeVertexNormals();
    this.parts.push(g);
    return this;
  }

  /** Boîte posée sur y0 (et non centrée). */
  box(w: number, h: number, d: number, x: number, y0: number, z: number, color: string): this {
    return this.add(new THREE.BoxGeometry(w, h, d), color, x, y0 + h / 2, z);
  }

  cyl(r: number, h: number, x: number, y0: number, z: number, color: string, seg = 10): this {
    return this.add(new THREE.CylinderGeometry(r, r, h, seg), color, x, y0 + h / 2, z);
  }

  /** Toit à deux pans, faîtage selon l'axe x (ou z). */
  gable(w: number, h: number, d: number, x: number, y0: number, z: number, color: string, alongZ = false): this {
    if (alongZ) [w, d] = [d, w];
    const hw = w / 2, hd = d / 2;
    const v = [
      -hw, 0, hd, hw, 0, hd, hw, h, 0, -hw, 0, hd, hw, h, 0, -hw, h, 0,
      hw, 0, -hd, -hw, 0, -hd, -hw, h, 0, hw, 0, -hd, -hw, h, 0, hw, h, 0,
      -hw, 0, -hd, -hw, 0, hd, -hw, h, 0,
      hw, 0, hd, hw, 0, -hd, hw, h, 0,
    ];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    g.computeVertexNormals();
    return this.add(g, color, x, y0, z, alongZ ? Math.PI / 2 : 0);
  }

  /** Toit en croupe (4 pans). */
  hip(w: number, h: number, d: number, x: number, y0: number, z: number, color: string): this {
    const g = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1).rotateY(Math.PI / 4);
    g.scale(w, h, d);
    return this.add(g, color, x, y0 + h / 2, z);
  }

  /** Corps de bâtiment avec bandeaux de fenêtres à chaque étage. */
  tower(w: number, d: number, floors: number, x: number, y0: number, z: number, wall: string, glass: string, ground?: string): this {
    const h = floors * FLOOR;
    this.box(w, h, d, x, y0, z, wall);
    for (let f = 0; f < floors; f++) {
      const isGround = f === 0 && ground;
      const bh = isGround ? FLOOR * 0.62 : FLOOR * 0.46;
      this.box(w + 0.012, bh, d + 0.012, x, y0 + f * FLOOR + FLOOR * (isGround ? 0.12 : 0.3), z, isGround ? ground! : glass);
    }
    return this;
  }

  tree(x: number, z: number, s = 1, color = '#4f8d36'): this {
    this.cyl(0.015 * s, 0.08 * s, x, 0.03, z, '#6b4a32', 5);
    return this.add(new THREE.IcosahedronGeometry(0.075 * s, 0), color, x, 0.03 + 0.12 * s, z);
  }

  build(): THREE.BufferGeometry {
    const g = mergeGeometries(this.parts)!;
    g.computeBoundingSphere();
    return g;
  }
}

const pick = <T,>(r: () => number, arr: T[]): T => arr[Math.floor(r() * arr.length)];

// ---------- Styles architecturaux ----------

interface Style {
  walls: string[];
  brick: string[];
  roof: string[];
  glass: string;
  frame: string;
  /** Toit pentu (true) ou terrasse (false) pour les immeubles bas. */
  pitched: boolean;
  /** Hauteur relative du toit pentu. */
  pitch: number;
  ground: string;
  accent: string;
}

const STYLES: Style[] = [
  { // Classique européen
    walls: ['#f3ead8', '#ead2b6', '#dbe5ec', '#f1dcd6', '#e5ecd5', '#f5e6c4'], brick: ['#b8674c', '#c98f6b', '#d8c3a5', '#a7b7c4', '#e0d7c8'],
    roof: ['#b4523d', '#8b5a3c', '#5b6571', '#9e4536', '#6e4f45'], glass: '#7fa6c4', frame: '#d6d0c4', pitched: true, pitch: 0.17, ground: '#93c062', accent: '#6b4a32',
  },
  { // Moderne
    walls: ['#f4f4f2', '#e3e6e8', '#d1d5d8', '#eceae4', '#cfd6d4'], brick: ['#e3e6e8', '#bfc7ce', '#9aa4ad', '#f0eee9', '#7d8790'],
    roof: ['#7d8790', '#5f6870', '#9aa4ad'], glass: '#4f7690', frame: '#3b4248', pitched: false, pitch: 0.06, ground: '#8fb86a', accent: '#2f3a44',
  },
  { // Méditerranéen
    walls: ['#f6efe0', '#f0d9b5', '#e9c48f', '#f4e3cf', '#ffffff', '#e7b98a'], brick: ['#e9c48f', '#d9a46b', '#f0d9b5', '#c98f6b', '#f6efe0'],
    roof: ['#c8643c', '#b5552f', '#d4794f'], glass: '#6d97b0', frame: '#8a5a3a', pitched: true, pitch: 0.09, ground: '#b9b36a', accent: '#2f6d8c',
  },
  { // Montagnard
    walls: ['#7a5a40', '#8b6a4a', '#d8cfc0', '#6b4a32', '#c9b9a0'], brick: ['#9a8f84', '#8a8178', '#b0a597', '#7a6a5e', '#c9bfb2'],
    roof: ['#3f4650', '#4a3b33', '#5a5f66'], glass: '#8fb1c9', frame: '#4a3b33', pitched: true, pitch: 0.3, ground: '#7fae5a', accent: '#a7423a',
  },
];

const SIGN = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#ec4899', '#8b5cf6'];

/** Contexte de construction d'un modèle. */
interface Ctx {
  b: Builder;
  r: () => number;
  st: Style;
  si: number;
  /** Largeur (façade) et profondeur utiles en unités. */
  W: number;
  D: number;
  f: number;
  d: number;
  level: number;
}

/** Fondation cachée et sol de la parcelle. */
function base(c: Ctx, color: string): void {
  c.b.box(c.W - 0.04, 1.2, c.D - 0.04, 0, -1.2, 0, '#b3a994');
  c.b.box(c.W, 0.03, c.D, 0, 0, 0, color);
}

/** Toit selon le style. */
function roof(c: Ctx, w: number, d: number, x: number, y: number, z: number, forceFlat = false): void {
  const { b, st, r } = c;
  if (st.pitched && !forceFlat) {
    const h = st.pitch * Math.min(1.6, Math.max(0.7, Math.min(w, d) / 0.4));
    if (c.si === 2 && r() < 0.5) b.hip(w + 0.04, h, d + 0.04, x, y, z, pick(r, st.roof));
    else b.gable(w + (c.si === 3 ? 0.1 : 0.05), h, d + 0.07, x, y, z, pick(r, st.roof), w < d);
  } else {
    b.box(w + 0.02, 0.025, d + 0.02, x, y, z, '#8f8a82');
    if (r() < 0.6) b.box(Math.min(0.18, w * 0.4), 0.07, Math.min(0.14, d * 0.4), x + w * 0.2, y + 0.025, z - d * 0.15, '#a8a39a');
    if (c.si === 1 && r() < 0.5) b.box(w * 0.5, 0.012, d * 0.4, x - w * 0.15, y + 0.025, z + d * 0.1, '#2b3b55'); // panneaux solaires
    if (c.si === 2) b.box(w * 0.3, 0.06, 0.01, x, y + 0.025, z + d / 2, '#f6efe0'); // muret de terrasse
  }
}

// ---------- Logements ----------

function house(c: Ctx, x: number, z: number, w: number, d: number, floors: number): void {
  const { b, r, st } = c;
  const wall = pick(r, st.walls);
  const h = 0.12 * floors + 0.02;
  if (c.si === 3) b.box(w + 0.01, 0.06, d + 0.01, x, 0.03, z, '#8a8178'); // soubassement en pierre
  b.box(w, h, d, x, 0.03, z, wall);
  roof(c, w, d, x, 0.03 + h, z);
  b.box(0.07, 0.12, 0.01, x + w * 0.22, 0.03, z + d / 2 + 0.005, st.accent); // porte
  for (let f = 0; f < floors; f++) {
    b.box(0.08, 0.06, 0.01, x - w * 0.2, 0.08 + f * 0.12, z + d / 2 + 0.005, st.glass);
    if (w > 0.4) b.box(0.08, 0.06, 0.01, x + w * 0.05, 0.08 + f * 0.12 + (f === 0 ? 0.06 : 0), z + d / 2 + 0.005, st.glass);
  }
  if (st.pitched && c.si !== 2) b.box(0.04, 0.1, 0.04, x + w * 0.3, 0.03 + h + 0.03, z - d * 0.2, '#7a6a5e'); // cheminée
}

function residentialLow(c: Ctx): void {
  const { b, r, W, D, level } = c;
  base(c, c.st.ground);
  const n = c.f; // une maison par case de façade, ou une grande villa
  if (level === 3 && c.f >= 2) {
    house(c, -W * 0.15, -D * 0.12, W * 0.5, D * 0.42, 2);
    house(c, W * 0.22, -D * 0.18, W * 0.28, D * 0.3, 1);
    b.box(W * 0.3, 0.012, D * 0.22, W * 0.2, 0.03, D * 0.24, '#4fb3d9'); // piscine
  } else {
    for (let k = 0; k < n; k++) {
      const x = -W / 2 + (k + 0.5) * (W / n);
      const w = 0.4 + level * 0.06 + r() * 0.08, d = 0.32 + r() * 0.08;
      house(c, x - 0.04, -0.08 * D, w, d, level === 1 ? 1 : 2);
      if (level >= 2) b.box(0.18, 0.1, 0.2, x + w / 2 + 0.06 - 0.04, 0.03, -0.08 * D, pick(r, c.st.walls)); // garage
      if (level === 3) b.box(0.22, 0.012, 0.12, x - 0.1, 0.03, D * 0.3, '#4fb3d9');
    }
  }
  b.box(W - 0.08, 0.05, 0.035, 0, 0.03, D / 2 - 0.04, '#5f8f3c'); // haie
  for (let k = 0; k < c.f; k++) if (r() < 0.7) b.tree(-W / 2 + (k + 0.2) * (W / c.f), D * 0.28, 1 + r() * 0.4);
}

function residentialMid(c: Ctx): void {
  const { b, r, st, W, D, level } = c;
  base(c, c.st.ground);
  if (level === 1) {
    // Maisons mitoyennes en bande
    const units = Math.max(2, Math.round(W / 0.3));
    const uw = (W - 0.1) / units;
    const wall = pick(r, st.walls);
    for (let k = 0; k < units; k++) {
      const x = -W / 2 + 0.05 + (k + 0.5) * uw;
      const col = k % 2 ? wall : pick(r, st.walls);
      b.box(uw - 0.01, 0.26, D * 0.5, x, 0.03, -D * 0.1, col);
      b.box(0.06, 0.12, 0.01, x, 0.03, -D * 0.1 + D * 0.25 + 0.005, st.accent);
      b.box(0.07, 0.06, 0.01, x, 0.19, -D * 0.1 + D * 0.25 + 0.005, st.glass);
    }
    roof(c, W - 0.1, D * 0.5, 0, 0.29, -D * 0.1);
    if (D > 1) for (let k = 0; k < units; k++) b.tree(-W / 2 + (k + 0.5) * uw, D * 0.3, 1);
  } else {
    const floors = (level === 2 ? 3 : 5) + Math.floor(r() * 2);
    const wall = pick(r, st.brick);
    const bw = W * 0.72, bd = Math.min(D * 0.62, 0.6 + (c.d - 1) * 0.5);
    if (c.f >= 2 && c.d >= 2) {
      // Îlot en U autour d'une cour
      b.tower(bw, 0.3, floors, 0, 0.03, -D / 2 + 0.25, wall, st.glass);
      b.tower(0.3, D * 0.6, floors, -bw / 2 + 0.15, 0.03, 0, wall, st.glass);
      b.tower(0.3, D * 0.6, floors, bw / 2 - 0.15, 0.03, 0, wall, st.glass);
      roof(c, bw, 0.3, 0, 0.03 + floors * FLOOR, -D / 2 + 0.25, !st.pitched);
      b.tree(0, 0, 1.5);
    } else {
      b.tower(bw, bd, floors, 0, 0.03, -0.04, wall, st.glass);
      const top = 0.03 + floors * FLOOR;
      b.box(bw + 0.04, 0.03, bd + 0.04, 0, top, -0.04, '#7c7268');
      roof(c, bw, bd, 0, top + 0.03, -0.04);
      for (let f = 1; f < floors; f++) b.box(bw * 0.75, 0.015, 0.06, 0, 0.03 + f * FLOOR, -0.04 + bd / 2 + 0.03, c.si === 2 ? '#2f6d8c' : '#8a8278'); // balcons
    }
  }
}

function residentialHigh(c: Ctx): void {
  const { b, r, st, W, D, level } = c;
  base(c, '#a9b49a');
  const towers = c.f * c.d >= 4 ? 2 : 1;
  const floorsBase = level === 1 ? 7 : level === 2 ? 12 : 18;
  if (c.f * c.d > 1) b.box(W * 0.85, FLOOR * 1.2, D * 0.7, 0, 0.03, 0, pick(r, st.brick)); // socle
  const y0 = c.f * c.d > 1 ? 0.03 + FLOOR * 1.2 : 0.03;
  for (let k = 0; k < towers; k++) {
    const floors = floorsBase + Math.floor(r() * 5) + k * 2;
    const tw = Math.min(0.62, W / towers - 0.12), td = Math.min(0.62, D * 0.6);
    const x = towers === 1 ? 0 : (k === 0 ? -1 : 1) * W * 0.22;
    const z = towers === 1 ? 0 : (k === 0 ? -1 : 1) * D * 0.12;
    const wall = st === STYLES[1] ? '#e9ecef' : pick(r, ['#e9e4da', '#d7dde2', '#e4d6c4', '#cfd8cf']);
    b.tower(tw, td, floors, x, y0, z, wall, st.glass === '#7fa6c4' ? '#4f6f8c' : st.glass);
    const top = y0 + floors * FLOOR;
    b.box(tw + 0.04, 0.04, td + 0.04, x, top, z, '#8f8a82');
    if (c.si === 3) b.gable(tw + 0.06, 0.16, td + 0.06, x, top + 0.04, z, pick(r, st.roof));
    else { b.box(0.2, 0.12, 0.18, x - 0.08, top + 0.04, z + 0.04, '#a8a39a'); b.cyl(0.05, 0.1, x + 0.14, top + 0.04, z - 0.12, '#7c8794', 8); }
  }
  if (c.f * c.d > 1) for (let k = 0; k < 3; k++) b.tree(-W / 2 + 0.15 + k * 0.3, D / 2 - 0.12, 1.1);
}

function mixed(c: Ctx): void {
  const { b, r, st, W, D, level } = c;
  base(c, '#c9c4b8');
  const floors = (level === 1 ? 2 : level === 2 ? 4 : 6) + Math.floor(r() * 2);
  const bw = W - 0.12, bd = Math.min(D * 0.7, 0.66);
  const wall = pick(r, st.brick);
  b.box(bw, FLOOR, bd, 0, 0.03, -0.04, '#d9d4ca'); // rez-de-chaussée commercial
  b.box(bw + 0.012, FLOOR * 0.66, bd + 0.012, 0, 0.045, -0.04, '#9cc3dd'); // vitrines
  const shops = Math.max(1, Math.round(W / 0.45));
  for (let k = 0; k < shops; k++) {
    const x = -bw / 2 + (k + 0.5) * (bw / shops);
    b.add(new THREE.BoxGeometry(bw / shops - 0.04, 0.015, 0.1).rotateX(0.35), pick(r, SIGN), x, 0.03 + FLOOR * 0.95, -0.04 + bd / 2 + 0.05); // auvents
  }
  b.tower(bw, bd, floors, 0, 0.03 + FLOOR, -0.04, wall, st.glass);
  const top = 0.03 + FLOOR * (floors + 1);
  for (let f = 2; f <= floors; f++) b.box(bw * 0.8, 0.015, 0.06, 0, 0.03 + f * FLOOR, -0.04 + bd / 2 + 0.03, '#8a8278');
  roof(c, bw, bd, 0, top, -0.04);
  if (r() < 0.6) b.box(0.06, 0.12, 0.06, -W / 2 + 0.08, 0.03, D / 2 - 0.08, '#3f6f3a'); // bac planté
}

// ---------- Commerces ----------

function shop(c: Ctx, x: number, w: number, d: number, floors: number): void {
  const { b, r, st } = c;
  const sign = pick(r, SIGN);
  const z = -c.D / 2 + d / 2 + 0.06;
  const wall = pick(r, floors > 1 ? st.brick : st.walls);
  if (floors > 1) b.tower(w, d, floors, x, 0.03, z, wall, st.glass, '#9cc3dd');
  else {
    b.box(w, 0.24, d, x, 0.03, z, wall);
    b.box(w - 0.06, 0.12, 0.01, x, 0.05, z + d / 2 + 0.005, '#9cc3dd');
  }
  const top = 0.03 + Math.max(0.24, floors * FLOOR);
  b.add(new THREE.BoxGeometry(w, 0.02, 0.13).rotateX(0.35), sign, x, 0.22, z + d / 2 + 0.06); // auvent
  b.box(w * 0.55, 0.08, 0.02, x, top - 0.02, z + d / 2 + 0.01, sign); // enseigne
  if (st.pitched && floors > 1 && c.si !== 1) roof(c, w, d, x, top, z);
  else b.box(Math.min(0.2, w * 0.3), 0.07, 0.14, x - w * 0.2, top, z - d * 0.2, '#b7b2a8');
}

function commercialLocal(c: Ctx): void {
  const { b, r, W, D, level } = c;
  base(c, '#c9c4b8');
  const n = c.f;
  const d = Math.min(D - 0.3, 0.5 + level * 0.06);
  for (let k = 0; k < n; k++) {
    const x = -W / 2 + (k + 0.5) * (W / n);
    shop(c, x, W / n - 0.1, d, level === 1 ? 1 : level === 2 ? 3 : 4);
  }
  // Terrasse de café
  if (r() < 0.6) for (let k = 0; k < 2; k++) {
    const x = -W / 2 + 0.2 + k * 0.22;
    b.cyl(0.006, 0.12, x, 0.03, D / 2 - 0.12, '#555', 4);
    b.add(new THREE.ConeGeometry(0.09, 0.04, 8), pick(r, SIGN), x, 0.17, D / 2 - 0.12);
  }
}

function parking(c: Ctx, w: number, d: number, x: number, z: number): void {
  const { b, r } = c;
  b.box(w, 0.006, d, x, 0.03, z, '#5c6066');
  const cars = Math.floor(w / 0.16);
  for (let k = 0; k < cars; k++) {
    b.box(0.004, 0.002, d * 0.4, x - w / 2 + (k + 1) * (w / (cars + 1)) - 0.08, 0.037, z, '#e8e8e0');
    if (r() < 0.65) b.box(0.07, 0.04, 0.12, x - w / 2 + (k + 0.5) * (w / (cars + 0.5)), 0.036, z + (r() < 0.5 ? -1 : 1) * d * 0.2, pick(r, ['#c0392b', '#2c3e50', '#ecf0f1', '#2980b9', '#7f8c8d', '#f1c40f']));
  }
}

function commercialDense(c: Ctx): void {
  const { b, r, st, W, D, level } = c;
  base(c, '#b8b3a9');
  const sign = pick(r, SIGN);
  const bd = D * (c.d === 1 ? 0.62 : 0.55);
  const z = -D / 2 + bd / 2 + 0.05;
  const h = FLOOR * (level === 1 ? 1.6 : level === 2 ? 2.4 : 2.8);
  const wall = c.si === 2 ? '#f0d9b5' : c.si === 3 ? '#9a8f84' : '#d9d4ca';
  b.box(W * 0.9, h, bd, 0, 0.03, z, wall);
  b.box(W * 0.9 + 0.012, h * 0.45, bd + 0.012, 0, 0.06, z, '#8fbad6');
  b.box(W * 0.5, 0.12, 0.02, 0, 0.03 + h - 0.15, z + bd / 2 + 0.01, sign);
  if (level >= 2) {
    // Verrière centrale
    b.box(W * 0.3, 0.12, bd * 0.6, 0, 0.03 + h, z, '#9cc8e4');
    b.box(W * 0.2, 0.08, bd * 0.3, -W * 0.3, 0.03 + h, z - bd * 0.15, '#9fa6ad');
  }
  if (level === 3) {
    const floors = 8 + Math.floor(r() * 5);
    b.tower(Math.min(0.6, W * 0.3), Math.min(0.5, bd * 0.6), floors, W * 0.25, 0.03 + h, z - bd * 0.1, '#c3ccd4', st.glass === '#7fa6c4' ? '#4f6f8c' : st.glass);
  }
  parking(c, W * 0.9, D - bd - 0.15, 0, z + bd / 2 + (D - bd - 0.15) / 2 + 0.05);
}

// ---------- Bureaux, recherche ----------

function officeTower(c: Ctx, x: number, z: number, w: number, d: number, floors: number): void {
  const { b, r, level } = c;
  const glass = c.si === 1 ? pick(r, ['#3f6585', '#2f4f6a', '#4a5f80']) : pick(r, ['#3f6585', '#4b7a8f', '#4a5f80', '#3d6f78']);
  const frame = c.si === 2 ? '#e9dcc4' : c.si === 3 ? '#b0a597' : pick(r, ['#d6dbe0', '#bfc7ce', '#e2ddd3']);
  b.tower(w, d, floors, x, 0.03, z, frame, glass, '#7fa6c4');
  let top = 0.03 + floors * FLOOR;
  if (level >= 2) {
    const extra = 2 + Math.floor(r() * 3);
    b.tower(w * 0.7, d * 0.7, extra, x, top, z, frame, glass);
    top += extra * FLOOR;
  }
  b.box(w * 0.5, 0.05, d * 0.5, x, top, z, '#8d949b');
  if (level === 3) b.cyl(0.012, 0.35, x, top + 0.05, z, '#d5d9dd', 6);
}

function office(c: Ctx): void {
  const { b, r, W, D, level } = c;
  base(c, '#cfcac0');
  const floors = level === 1 ? 4 + Math.floor(r() * 2) : level === 2 ? 8 + Math.floor(r() * 4) : 14 + Math.floor(r() * 7);
  if (c.f * c.d >= 4) {
    officeTower(c, -W * 0.2, -D * 0.15, 0.6, 0.6, floors);
    officeTower(c, W * 0.22, D * 0.12, 0.5, 0.5, Math.max(3, floors - 3));
    b.box(W * 0.3, 0.012, 0.3, -W * 0.15, 0.03, D * 0.3, '#7fb3d0'); // bassin
  } else if (c.f === 2) {
    officeTower(c, -W * 0.2, 0, 0.6, 0.56, floors);
    officeTower(c, W * 0.25, 0, 0.42, 0.42, Math.max(3, Math.round(floors * 0.6)));
  } else officeTower(c, 0, 0, level === 3 ? 0.56 : 0.62, level === 3 ? 0.56 : 0.62, floors);
  b.box(0.14, 0.12, 0.12, W / 2 - 0.12, 0.03, D / 2 - 0.12, '#58913a');
}

function research(c: Ctx): void {
  const { b, r, W, D, level } = c;
  base(c, c.st.ground);
  const blocks = c.f * c.d >= 4 ? 3 : c.f >= 2 ? 2 : 1;
  for (let k = 0; k < blocks; k++) {
    const x = blocks === 1 ? 0 : -W / 2 + (k + 0.5) * (W / blocks);
    const floors = 2 + level + Math.floor(r() * 2);
    b.tower(Math.min(0.5, W / blocks - 0.12), D * 0.4, floors, x, 0.03, -D * 0.15, '#f2f4f5', '#5a8fb0', '#9cc3dd');
    b.box(Math.min(0.5, W / blocks - 0.12) + 0.03, 0.03, D * 0.4 + 0.03, x, 0.03 + floors * FLOOR, -D * 0.15, '#9aa4ad');
  }
  // Dôme d'observation et antenne parabolique
  b.add(new THREE.SphereGeometry(0.13, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), '#e8ecef', W * 0.25, 0.03, D * 0.25);
  b.cyl(0.13, 0.08, W * 0.25, 0.03, D * 0.25, '#cfd6db', 12);
  if (level >= 2) {
    b.cyl(0.015, 0.2, -W * 0.3, 0.03, D * 0.28, '#8d949b', 6);
    b.add(new THREE.SphereGeometry(0.1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 3).rotateX(-0.9), '#f0f2f4', -W * 0.3, 0.27, D * 0.28);
  }
  for (let k = 0; k < c.f * 2; k++) b.tree(-W / 2 + 0.12 + k * ((W - 0.24) / Math.max(1, c.f * 2 - 1)), D / 2 - 0.08, 0.9);
}

// ---------- Industrie, logistique, agriculture ----------

function factory(c: Ctx, x: number, z: number, w: number, d: number): void {
  const { b, r, level } = c;
  const wall = pick(r, ['#b9b3a6', '#a8afb5', '#c2b49c', '#9fa89a']);
  const rf = pick(r, ['#6d747c', '#7b6a5b', '#5d6a64']);
  if (level === 1) {
    b.box(w, 0.22, d, x, 0.03, z, wall);
    b.gable(w + 0.04, 0.1, d + 0.04, x, 0.25, z, rf);
    b.box(0.16, 0.15, 0.01, x - w * 0.22, 0.03, z + d / 2 + 0.005, '#5a5f66');
    b.box(0.16, 0.15, 0.01, x + w * 0.22, 0.03, z + d / 2 + 0.005, '#5a5f66');
  } else if (level === 2) {
    b.box(w, 0.3, d, x, 0.03, z, wall);
    const teeth = Math.max(2, Math.round(d / 0.17));
    for (let k = 0; k < teeth; k++) {
      b.add(new THREE.BoxGeometry(w, 0.02, d / teeth + 0.02).rotateX(-0.5), rf, x, 0.37, z - d / 2 + (k + 0.5) * (d / teeth));
      b.box(w, 0.08, 0.01, x, 0.33, z - d / 2 + (k + 0.9) * (d / teeth), '#7fa6c4');
    }
    b.cyl(0.05, 0.7, x + w / 2 - 0.06, 0.03, z - d / 2 + 0.06, '#9a5b45', 8);
    b.cyl(0.058, 0.04, x + w / 2 - 0.06, 0.62, z - d / 2 + 0.06, '#e8e2d6', 8);
  } else {
    b.box(w, 0.36, d, x, 0.03, z, wall);
    b.box(w + 0.02, 0.03, d + 0.02, x, 0.39, z, rf);
    b.cyl(0.055, 1.0, x + w / 2 - 0.08, 0.03, z, '#b5513c', 8);
    b.cyl(0.06, 0.06, x + w / 2 - 0.08, 0.75, z, '#f1ede6', 8);
    b.cyl(0.04, 0.8, x - w / 2 + 0.08, 0.39, z - d * 0.2, '#8c949b', 8);
  }
}

function industrial(c: Ctx): void {
  const { b, r, W, D, level } = c;
  base(c, '#a29d92');
  if (c.f * c.d === 1) {
    factory(c, 0, -0.1, 0.72, 0.5);
    if (level >= 2) b.cyl(0.11, 0.24, 0.28, 0.03, 0.25, '#c7ccd1', 12);
    else for (let k = 0; k < 3; k++) b.box(0.08, 0.08, 0.08, -0.3 + k * 0.1, 0.03, 0.34, '#a87b4f');
    return;
  }
  factory(c, -W * 0.12, -D * 0.12, W * 0.62, D * 0.55);
  // Silos et cuves
  const silos = level + 1;
  for (let k = 0; k < silos; k++) {
    const x = W * 0.3, z = -D / 2 + 0.2 + k * Math.min(0.3, (D - 0.3) / silos);
    b.cyl(0.11, 0.3 + level * 0.12, x, 0.03, z, '#d6d9dc', 12);
    b.add(new THREE.ConeGeometry(0.11, 0.07, 12), '#aab0b6', x, 0.03 + 0.3 + level * 0.12 + 0.035, z);
  }
  for (let k = 0; k < 4; k++) b.box(0.09, 0.08, 0.09, -W / 2 + 0.15 + k * 0.12, 0.03, D / 2 - 0.15, pick(r, ['#a87b4f', '#8a6a4a']));
}

function warehouse(c: Ctx, x: number, z: number, w: number, d: number, h: number): void {
  const { b, r } = c;
  const wall = pick(r, ['#c8cdd2', '#b9c0c6', '#d5d0c4', '#9aa7b0']);
  b.box(w, h, d, x, 0.03, z, wall);
  b.add(new THREE.CylinderGeometry(d / 2, d / 2, w, 10, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).scale(1, 0.25, 1), '#7d868e', x, 0.03 + h, z);
  const docks = Math.max(2, Math.round(w / 0.16));
  for (let k = 0; k < docks; k++) b.box(0.09, h * 0.6, 0.01, x - w / 2 + (k + 0.5) * (w / docks), 0.03, z + d / 2 + 0.005, '#4f565d');
}

function logistics(c: Ctx): void {
  const { b, r, W, D, level } = c;
  base(c, '#8f9399');
  const h = 0.18 + level * 0.05;
  warehouse(c, 0, -D * 0.15, W * 0.86, D * 0.5, h);
  // Camions à quai
  const trucks = Math.max(2, c.f * 2);
  for (let k = 0; k < trucks; k++) {
    if (r() < 0.25) continue;
    const x = -W * 0.4 + k * (W * 0.8 / Math.max(1, trucks - 1));
    b.box(0.06, 0.06, 0.2, x, 0.03, D * 0.2, '#e8e8e0');
    b.box(0.06, 0.05, 0.06, x, 0.03, D * 0.2 + 0.13, pick(r, SIGN));
  }
  // Conteneurs empilés
  for (let k = 0; k < level * 2; k++) {
    b.box(0.2, 0.07, 0.08, -W / 2 + 0.15 + (k % 3) * 0.22, 0.03 + Math.floor(k / 3) * 0.07, D / 2 - 0.1, pick(r, ['#c0392b', '#2980b9', '#27ae60', '#e67e22', '#8e44ad']));
  }
}

function agriculture(c: Ctx): void {
  const { b, r, st, W, D, level } = c;
  // Champs en sillons de couleurs variées
  b.box(W - 0.04, 1.2, D - 0.04, 0, -1.2, 0, '#b3a994');
  const crops = ['#c9b458', '#7fa94a', '#a8c060', '#d9c27a', '#6e9e3e', '#b5893f'];
  const plots = Math.max(1, c.f * c.d - 1);
  const farmW = c.f * c.d > 1 ? Math.min(0.9, W * 0.45) : W;
  b.box(W, 0.02, D, 0, 0, 0, '#8a7a55');
  const fieldW = W - (c.f * c.d > 1 ? farmW : 0);
  for (let k = 0; k < plots; k++) {
    const col = pick(r, crops);
    const fz = -D / 2 + (k + 0.5) * (D / plots);
    const fx = c.f * c.d > 1 ? farmW / 2 : 0;
    const rows = Math.max(3, Math.round(fieldW / 0.07));
    for (let s = 0; s < rows; s++) b.box(fieldW / rows * 0.6, 0.02, D / plots - 0.06, fx - fieldW / 2 + (s + 0.5) * (fieldW / rows), 0.02, fz, col);
  }
  // Ferme, grange, silo, serres
  const fx = c.f * c.d > 1 ? -W / 2 + farmW / 2 : 0, fz = c.f * c.d > 1 ? 0 : -0.15;
  const s = c.f * c.d > 1 ? 1 : 0.7;
  b.box(0.3 * s, 0.16 * s, 0.24 * s, fx - 0.12 * s, 0.03, fz - 0.15 * s, c.si === 3 ? '#7a5a40' : '#a7423a'); // grange
  b.gable(0.34 * s, 0.12 * s, 0.28 * s, fx - 0.12 * s, 0.03 + 0.16 * s, fz - 0.15 * s, c.si === 2 ? '#c8643c' : '#5b4a40');
  b.box(0.2 * s, 0.12 * s, 0.16 * s, fx + 0.16 * s, 0.03, fz + 0.12 * s, pick(r, st.walls)); // maison
  roof(c, 0.2 * s, 0.16 * s, fx + 0.16 * s, 0.03 + 0.12 * s, fz + 0.12 * s);
  b.cyl(0.06 * s, 0.34 * s, fx + 0.2 * s, 0.03, fz - 0.2 * s, '#d6d9dc', 10);
  b.add(new THREE.SphereGeometry(0.06 * s, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), '#aab0b6', fx + 0.2 * s, 0.03 + 0.34 * s, fz - 0.2 * s);
  if (level >= 2) for (let k = 0; k < level; k++) {
    // Serres
    const gx = c.f * c.d > 1 ? farmW / 2 - W * 0.3 + k * 0.28 : -0.3 + k * 0.2, gz = D / 2 - 0.18;
    b.add(new THREE.CylinderGeometry(0.08, 0.08, 0.32, 8, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateY(Math.PI / 2), '#cfe8ef', gx, 0.03, gz);
  }
  if (r() < 0.7) b.tree(fx - 0.3 * s, fz + 0.3 * s, 1.2);
}

function forestry(c: Ctx): void {
  const { b, r, W, D, level } = c;
  b.box(W - 0.04, 1.2, D - 0.04, 0, -1.2, 0, '#b3a994');
  b.box(W, 0.02, D, 0, 0, 0, '#6d7a3e');
  // Plantations en rangs
  const rows = Math.max(2, c.d * 2), cols = Math.max(2, c.f * 3 - 1);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    if (i < 2 && j >= rows - 2) continue; // place de la scierie
    if (r() < 0.15) continue;
    b.tree(-W / 2 + (i + 0.5) * (W / cols), -D / 2 + (j + 0.5) * ((D - 0.1) / rows), 0.7 + r() * 0.5 + level * 0.1, r() < 0.5 ? '#2f6b34' : '#3f7d3a');
  }
  // Scierie et grumes
  const sx = -W / 2 + 0.3, sz = D / 2 - 0.25;
  b.box(0.36, 0.16, 0.24, sx, 0.03, sz, '#8b6a4a');
  b.gable(0.4, 0.1, 0.28, sx, 0.19, sz, '#5b5f66');
  for (let k = 0; k < 2 + level; k++) b.add(new THREE.CylinderGeometry(0.025, 0.025, 0.3, 6).rotateZ(Math.PI / 2), '#a0764a', sx + 0.36, 0.055 + Math.floor(k / 2) * 0.05, sz - 0.08 + (k % 2) * 0.06);
}

function mining(c: Ctx): void {
  const { b, r, W, D, level } = c;
  base(c, '#857b6c');
  // Chevalement
  const hx = -W * 0.2, hz = -D * 0.15, h = 0.5 + level * 0.15;
  for (const [x, z] of [[-0.08, -0.08], [0.08, -0.08], [-0.08, 0.08], [0.08, 0.08]]) b.box(0.02, h, 0.02, hx + x, 0.03, hz + z, '#6b7280');
  b.add(new THREE.CylinderGeometry(0.07, 0.07, 0.02, 12).rotateX(Math.PI / 2), '#374151', hx, 0.03 + h, hz);
  b.box(0.3, 0.16, 0.22, hx + 0.12, 0.03, hz + 0.2, '#9a8f84');
  // Terrils et minerai
  b.add(new THREE.ConeGeometry(0.22 + level * 0.04, 0.22 + level * 0.06, 7), '#4b4540', W * 0.25, 0.14 + level * 0.03, -D * 0.2);
  b.add(new THREE.ConeGeometry(0.14, 0.12, 6), pick(r, ['#8b5a3c', '#7a7a80', '#a0522d']), W * 0.2, 0.09, D * 0.25);
  b.add(new THREE.BoxGeometry(0.04, 0.02, 0.5).rotateX(-0.4), '#52525b', W * 0.05, 0.16, 0); // convoyeur
  if (c.f * c.d > 1) b.box(0.08, 0.06, 0.18, -W * 0.35, 0.03, D * 0.3, '#eab308'); // tombereau
}

// ---------- Tourisme ----------

function tourism(c: Ctx): void {
  const { b, r, st, W, D, level } = c;
  base(c, c.st.ground);
  const sign = pick(r, SIGN);
  if (level === 1) {
    // Auberge
    const w = W * 0.7, d = Math.min(0.5, D * 0.55);
    b.box(w, 0.3, d, 0, 0.03, -D * 0.1, pick(r, st.walls));
    for (let f = 0; f < 2; f++) for (let k = 0; k < 3; k++) b.box(0.07, 0.06, 0.01, -w / 3 + k * (w / 3), 0.08 + f * 0.13, -D * 0.1 + d / 2 + 0.005, st.glass);
    roof(c, w, d, 0, 0.33, -D * 0.1);
    b.box(0.3, 0.07, 0.02, 0, 0.26, -D * 0.1 + d / 2 + 0.01, sign);
  } else {
    const floors = level === 2 ? 6 + Math.floor(r() * 2) : 11 + Math.floor(r() * 5);
    const w = Math.min(W * 0.7, 0.7 + (c.f - 1) * 0.6), d = Math.min(D * 0.5, 0.45);
    b.box(W * 0.85, FLOOR, D * 0.6, 0, 0.03, -D * 0.05, '#e8e2d6'); // hall
    b.tower(w, d, floors, 0, 0.03 + FLOOR, -D * 0.12, pick(r, st.brick), st.glass === '#7fa6c4' ? '#5d86a8' : st.glass);
    const top = 0.03 + FLOOR * (floors + 1);
    b.box(w * 0.6, 0.12, 0.02, 0, top - 0.18, -D * 0.12 + d / 2 + 0.01, sign);
    roof(c, w, d, 0, top, -D * 0.12, true);
    b.box(W * 0.4, 0.012, D * 0.2, -W * 0.15, 0.03 + FLOOR, D * 0.15, '#4fb3d9'); // piscine sur le toit du hall
    b.add(new THREE.BoxGeometry(W * 0.5, 0.015, 0.12).rotateX(0.2), sign, 0, 0.03 + FLOOR * 0.9, D * 0.25 + 0.06); // marquise
  }
  for (let k = 0; k < c.f + 1; k++) b.tree(-W / 2 + 0.1 + k * ((W - 0.2) / Math.max(1, c.f)), D / 2 - 0.08, 0.9, c.si === 2 ? '#6e9e3e' : '#4f8d36');
}

// ---------- Chantiers et ruines ----------

/** Chantier : dalle, ossature, grue pour les niveaux élevés. */
function construction(level: number, f: number, d: number): THREE.BufferGeometry {
  const b = new Builder();
  const W = f - 0.06, D = d - 0.06;
  b.box(W - 0.04, 1.2, D - 0.04, 0, -1.2, 0, '#b3a994');
  b.box(W, 0.03, D, 0, 0, 0, '#a58b6c');
  const h = 0.12 + level * 0.12;
  const sw = W * 0.65, sd = D * 0.55;
  b.box(sw, 0.04, sd, 0, 0.03, -0.04, '#b7b2a8');
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.box(0.025, h, 0.025, x * sw * 0.47, 0.07, -0.04 + z * sd * 0.47, '#d08c3c');
  b.box(sw, 0.02, sd, 0, 0.07 + h * 0.5, -0.04, '#d08c3c');
  b.box(0.12, 0.08, 0.1, W / 2 - 0.12, 0.03, D / 2 - 0.1, '#e9b949');
  if (level >= 2 || f * d > 1) {
    const ch = h + 0.5;
    b.box(0.03, ch, 0.03, -W / 2 + 0.1, 0.03, D / 2 - 0.12, '#f2b630');
    b.box(0.6 + (f - 1) * 0.3, 0.025, 0.025, -W / 2 + 0.36 + (f - 1) * 0.15, 0.03 + ch, D / 2 - 0.12, '#f2b630');
    b.box(0.05, 0.04, 0.05, -W / 2 + 0.6, 0.03 + ch - 0.08, D / 2 - 0.12, '#4c5560');
  }
  b.box(W, 0.06, 0.012, 0, 0.03, D / 2 - 0.01, '#e2e2dc'); // palissade
  return b.build();
}

/** Gravats d'un bâtiment détruit. */
function rubble(): THREE.BufferGeometry {
  const b = new Builder();
  b.box(0.9, 1.2, 0.9, 0, -1.2, 0, '#b3a994');
  b.box(0.94, 0.03, 0.94, 0, 0, 0, '#8a8278');
  b.add(new THREE.ConeGeometry(0.28, 0.16, 6), '#7d756b', -0.12, 0.11, -0.05);
  b.add(new THREE.ConeGeometry(0.2, 0.12, 5), '#5f5a54', 0.18, 0.09, 0.12);
  b.add(new THREE.BoxGeometry(0.22, 0.05, 0.06).rotateY(0.6).rotateZ(0.3), '#6b4a32', 0.1, 0.08, -0.2);
  b.add(new THREE.BoxGeometry(0.18, 0.04, 0.05).rotateY(-0.8), '#9aa1a8', -0.22, 0.06, 0.2);
  b.box(0.06, 0.18, 0.06, 0.28, 0.03, -0.28, '#8f8a82');
  return b.build();
}

export const VARIANTS = 4;

const MAKERS: Record<number, (c: Ctx) => void> = {
  [Zone.ResidentialLow]: residentialLow,
  [Zone.Residential]: residentialMid,
  [Zone.ResidentialHigh]: residentialHigh,
  [Zone.Commercial]: commercialLocal,
  [Zone.CommercialDense]: commercialDense,
  [Zone.Office]: office,
  [Zone.Industrial]: industrial,
  [Zone.Mixed]: mixed,
  [Zone.Agriculture]: agriculture,
  [Zone.Logistics]: logistics,
  [Zone.Research]: research,
  [Zone.Tourism]: tourism,
  [Zone.Forestry]: forestry,
  [Zone.Mining]: mining,
};

/** Bibliothèque de modèles, créés à la demande. */
export class ModelSet {
  private cache = new Map<string, THREE.BufferGeometry>();
  readonly rubble = rubble();

  /** Clé : `${zone}-${level}-${variant}-${style}-${façade}x${profondeur}`. */
  building(key: string): THREE.BufferGeometry {
    let g = this.cache.get(key);
    if (g) return g;
    const [zone, level, variant, style, size] = key.split('-');
    const [f, d] = size.split('x').map(Number);
    const r = rng(Number(zone) * 1000 + Number(level) * 100 + Number(variant) * 7 + Number(style) * 13 + f * 31 + d * 37 + 3);
    const b = new Builder();
    const si = Number(style) % STYLES.length;
    const c: Ctx = { b, r, st: STYLES[si], si, W: f - 0.06, D: d - 0.06, f, d, level: Number(level) };
    (MAKERS[Number(zone)] ?? residentialMid)(c);
    g = b.build();
    this.cache.set(key, g);
    return g;
  }

  construction(level: number, f: number, d: number): THREE.BufferGeometry {
    const key = `c-${level}-${f}x${d}`;
    let g = this.cache.get(key);
    if (!g) this.cache.set(key, (g = construction(level, f, d)));
    return g;
  }
}

export function createModels(): ModelSet {
  return new ModelSet();
}
