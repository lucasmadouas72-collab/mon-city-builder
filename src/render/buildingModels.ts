import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng } from '../core/noise';
import { Zone, type ZoneType } from '../sim/zones';

/**
 * Modèles low-poly procéduraux des bâtiments. Chaque modèle est centré sur la case,
 * façade vers +z, sol du terrain à y = 0. Couleurs stockées dans les sommets.
 */

const FLOOR = 0.13;

class Builder {
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

  /** Toit à deux pans, faîtage selon l'axe x. */
  gable(w: number, h: number, d: number, x: number, y0: number, z: number, color: string, alongZ = false): this {
    const hw = w / 2, hd = d / 2;
    const v = [
      // pans
      -hw, 0, hd, hw, 0, hd, hw, h, 0, -hw, 0, hd, hw, h, 0, -hw, h, 0,
      hw, 0, -hd, -hw, 0, -hd, -hw, h, 0, hw, 0, -hd, -hw, h, 0, hw, h, 0,
      // pignons
      -hw, 0, -hd, -hw, 0, hd, -hw, h, 0,
      hw, 0, hd, hw, 0, -hd, hw, h, 0,
    ];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    g.computeVertexNormals();
    return this.add(g, color, x, y0, z, alongZ ? Math.PI / 2 : 0);
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

  build(): THREE.BufferGeometry {
    const g = mergeGeometries(this.parts)!;
    g.computeBoundingSphere();
    return g;
  }
}

const LOT: Record<ZoneType, string> = {
  [Zone.Residential]: '#93c062',
  [Zone.Commercial]: '#c9c4b8',
  [Zone.Industrial]: '#a29d92',
  [Zone.Office]: '#cfcac0',
};

function base(b: Builder, zone: ZoneType): Builder {
  b.box(0.9, 1.2, 0.9, 0, -1.2, 0, '#8d877b'); // fondation (cachée dans le relief)
  return b.box(0.94, 0.03, 0.94, 0, 0, 0, LOT[zone]);
}

const pick = <T,>(r: () => number, arr: T[]): T => arr[Math.floor(r() * arr.length)];

const WALLS_R = ['#f3ead8', '#ead2b6', '#dbe5ec', '#f1dcd6', '#e5ecd5', '#f5e6c4'];
const ROOFS = ['#b4523d', '#8b5a3c', '#5b6571', '#9e4536', '#6e4f45'];
const BRICK = ['#b8674c', '#c98f6b', '#d8c3a5', '#a7b7c4', '#e0d7c8'];
const GLASS = '#4f6f8c';
const GLASS_LIGHT = '#7fa6c4';
const SIGN = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#ec4899'];

function residential(level: number, r: () => number): THREE.BufferGeometry {
  const b = base(new Builder(), Zone.Residential);
  if (level === 1) {
    const wall = pick(r, WALLS_R), roof = pick(r, ROOFS);
    const w = 0.42 + r() * 0.12, d = 0.36 + r() * 0.08, h = 0.24;
    b.box(w, h, d, 0, 0.03, -0.06, wall);
    b.gable(w + 0.06, 0.17, d + 0.08, 0, 0.03 + h, -0.06, roof, r() < 0.5);
    b.box(0.08, 0.14, 0.01, w * 0.2, 0.03, -0.06 + d / 2 + 0.005, '#6b4a32'); // porte
    b.box(0.09, 0.07, 0.01, -w * 0.2, 0.12, -0.06 + d / 2 + 0.005, GLASS_LIGHT); // fenêtre
    b.box(0.05, 0.12, 0.05, w * 0.3, 0.03 + h + 0.05, -0.12, '#7a6a5e'); // cheminée
    b.box(0.86, 0.06, 0.04, 0, 0.03, 0.4, '#5f8f3c'); // haie
    if (r() < 0.6) b.add(new THREE.IcosahedronGeometry(0.09, 0), '#4f8d36', -0.3, 0.14, 0.28);
  } else if (level === 2) {
    const wall = pick(r, BRICK);
    const floors = 3 + Math.floor(r() * 2);
    b.tower(0.66, 0.56, floors, 0, 0.03, -0.04, wall, GLASS_LIGHT);
    const top = 0.03 + floors * FLOOR;
    b.box(0.7, 0.03, 0.6, 0, top, -0.04, '#7c7268'); // corniche
    if (r() < 0.5) b.gable(0.7, 0.16, 0.6, 0, top + 0.03, -0.04, pick(r, ROOFS));
    else b.box(0.16, 0.08, 0.14, 0.15, top + 0.03, -0.1, '#9a948a');
    for (let f = 1; f < floors; f++) b.box(0.5, 0.015, 0.06, 0, 0.03 + f * FLOOR, 0.27, '#8a8278'); // balcons
  } else {
    const wall = pick(r, ['#e9e4da', '#d7dde2', '#e4d6c4', '#cfd8cf']);
    const floors = 8 + Math.floor(r() * 6);
    b.tower(0.6, 0.6, floors, 0, 0.03, 0, wall, GLASS);
    const top = 0.03 + floors * FLOOR;
    b.box(0.64, 0.04, 0.64, 0, top, 0, '#8f8a82');
    b.box(0.22, 0.12, 0.2, -0.1, top + 0.04, 0.05, '#a8a39a');
    b.cyl(0.06, 0.1, 0.16, top + 0.04, -0.15, '#7c8794', 8); // réservoir
  }
  return b.build();
}

function commercial(level: number, r: () => number): THREE.BufferGeometry {
  const b = base(new Builder(), Zone.Commercial);
  const sign = pick(r, SIGN);
  if (level === 1) {
    const wall = pick(r, ['#f2efe8', '#e8dccb', '#dfe7ea']);
    b.box(0.66, 0.24, 0.5, 0, 0.03, -0.08, wall);
    b.box(0.6, 0.12, 0.01, 0, 0.05, 0.175, GLASS_LIGHT); // vitrine
    b.add(new THREE.BoxGeometry(0.66, 0.02, 0.14).rotateX(0.35), sign, 0, 0.22, 0.22); // auvent
    b.box(0.36, 0.08, 0.02, 0, 0.27, 0.16, sign); // enseigne
    b.box(0.2, 0.08, 0.16, -0.18, 0.27, -0.16, '#b7b2a8'); // clim
  } else if (level === 2) {
    const wall = pick(r, BRICK);
    const floors = 3 + Math.floor(r() * 2);
    b.tower(0.74, 0.62, floors, 0, 0.03, -0.04, wall, GLASS_LIGHT, '#9cc3dd');
    const top = 0.03 + floors * FLOOR;
    b.box(0.78, 0.03, 0.66, 0, top, -0.04, '#6f6a62');
    b.box(0.5, 0.1, 0.02, 0, top + 0.03, 0.26, sign);
  } else {
    const floors = 5 + Math.floor(r() * 4);
    b.box(0.86, FLOOR * 1.4, 0.8, 0, 0.03, 0, '#d9d4ca'); // socle commercial
    b.box(0.87, FLOOR * 0.8, 0.81, 0, 0.06, 0, '#8fbad6');
    b.tower(0.62, 0.56, floors, 0, 0.03 + FLOOR * 1.4, -0.04, '#c3ccd4', GLASS);
    const top = 0.03 + FLOOR * (1.4 + floors);
    b.box(0.4, 0.12, 0.02, 0, top - 0.2, 0.245, sign);
    b.box(0.3, 0.1, 0.3, 0, top, -0.04, '#9fa6ad');
  }
  return b.build();
}

function industrial(level: number, r: () => number): THREE.BufferGeometry {
  const b = base(new Builder(), Zone.Industrial);
  const wall = pick(r, ['#b9b3a6', '#a8afb5', '#c2b49c', '#9fa89a']);
  const roof = pick(r, ['#6d747c', '#7b6a5b', '#5d6a64']);
  if (level === 1) {
    b.box(0.72, 0.22, 0.52, 0, 0.03, -0.1, wall);
    b.gable(0.76, 0.1, 0.56, 0, 0.25, -0.1, roof);
    b.box(0.18, 0.15, 0.01, -0.16, 0.03, 0.165, '#5a5f66'); // porte de quai
    b.box(0.18, 0.15, 0.01, 0.16, 0.03, 0.165, '#5a5f66');
    for (let k = 0; k < 3; k++) b.box(0.08, 0.08, 0.08, -0.3 + k * 0.1, 0.03, 0.34, '#a87b4f'); // caisses
  } else if (level === 2) {
    b.box(0.6, 0.3, 0.5, -0.08, 0.03, -0.1, wall);
    for (let k = 0; k < 3; k++) {
      // toit en dents de scie
      b.add(new THREE.BoxGeometry(0.6, 0.02, 0.19).rotateX(-0.5), roof, -0.08, 0.37, -0.28 + k * 0.17);
      b.box(0.6, 0.08, 0.01, -0.08, 0.33, -0.2 + k * 0.17, GLASS_LIGHT);
    }
    b.cyl(0.05, 0.7, 0.3, 0.03, -0.25, '#9a5b45', 8); // cheminée
    b.cyl(0.058, 0.04, 0.3, 0.62, -0.25, '#e8e2d6', 8);
    b.cyl(0.11, 0.24, 0.28, 0.03, 0.2, '#c7ccd1', 12); // cuve
  } else {
    b.box(0.82, 0.36, 0.42, 0, 0.03, -0.2, wall);
    b.box(0.84, 0.03, 0.44, 0, 0.39, -0.2, roof);
    b.cyl(0.13, 0.5, -0.24, 0.03, 0.2, '#d6d9dc', 14); // silos
    b.cyl(0.13, 0.5, 0.04, 0.03, 0.2, '#d6d9dc', 14);
    b.add(new THREE.ConeGeometry(0.13, 0.08, 14), '#aab0b6', -0.24, 0.57, 0.2);
    b.add(new THREE.ConeGeometry(0.13, 0.08, 14), '#aab0b6', 0.04, 0.57, 0.2);
    b.cyl(0.055, 1.0, 0.3, 0.03, 0.22, '#b5513c', 8);
    b.cyl(0.06, 0.06, 0.3, 0.75, 0.22, '#f1ede6', 8);
    b.cyl(0.04, 0.8, 0.3, 0.39, -0.3, '#8c949b', 8);
    b.box(0.5, 0.03, 0.03, 0.05, 0.36, 0.03, '#6f767d'); // passerelle
  }
  return b.build();
}

function office(level: number, r: () => number): THREE.BufferGeometry {
  const b = base(new Builder(), Zone.Office);
  const glass = pick(r, ['#3f6585', '#4b7a8f', '#4a5f80', '#3d6f78']);
  const frame = pick(r, ['#d6dbe0', '#bfc7ce', '#e2ddd3']);
  const floors = level === 1 ? 4 + Math.floor(r() * 2) : level === 2 ? 8 + Math.floor(r() * 4) : 14 + Math.floor(r() * 7);
  const w = level === 3 ? 0.56 : 0.62;
  b.tower(w, w, floors, 0, 0.03, 0, frame, glass, GLASS_LIGHT);
  let top = 0.03 + floors * FLOOR;
  if (level >= 2) {
    // retrait au sommet
    const extra = 2 + Math.floor(r() * 3);
    b.tower(w * 0.7, w * 0.7, extra, 0, top, 0, frame, glass);
    top += extra * FLOOR;
  }
  b.box(w * 0.5, 0.05, w * 0.5, 0, top, 0, '#8d949b');
  if (level === 3) b.cyl(0.012, 0.35, 0, top + 0.05, 0, '#d5d9dd', 6); // antenne
  b.box(0.14, 0.18, 0.12, 0.32, 0.03, 0.32, '#58913a'); // massif
  return b.build();
}

/** Chantier : dalle, ossature, grue pour les niveaux élevés. */
function construction(level: number): THREE.BufferGeometry {
  const b = new Builder();
  b.box(0.9, 1.2, 0.9, 0, -1.2, 0, '#8d877b');
  b.box(0.94, 0.03, 0.94, 0, 0, 0, '#a58b6c');
  const h = 0.12 + level * 0.12;
  b.box(0.6, 0.04, 0.5, 0, 0.03, -0.04, '#b7b2a8');
  for (const [x, z] of [[-0.28, -0.27], [0.28, -0.27], [-0.28, 0.19], [0.28, 0.19]]) b.box(0.025, h, 0.025, x, 0.07, z, '#d08c3c');
  b.box(0.6, 0.02, 0.5, 0, 0.07 + h * 0.5, -0.04, '#d08c3c');
  b.box(0.12, 0.08, 0.1, 0.3, 0.03, 0.34, '#e9b949'); // engin
  if (level >= 2) {
    const ch = h + 0.5;
    b.box(0.03, ch, 0.03, -0.36, 0.03, 0.34, '#f2b630');
    b.box(0.6, 0.025, 0.025, -0.14, 0.03 + ch, 0.34, '#f2b630');
    b.box(0.05, 0.04, 0.05, 0.12, 0.03 + ch - 0.08, 0.34, '#4c5560');
  }
  return b.build();
}

export const VARIANTS = 4;

export interface ModelSet {
  /** key `${zone}-${level}-${variant}` */
  buildings: Map<string, THREE.BufferGeometry>;
  construction: THREE.BufferGeometry[]; // indexé par niveau 1-3 (0 inutilisé)
}

export function createModels(): ModelSet {
  const buildings = new Map<string, THREE.BufferGeometry>();
  const makers: Record<ZoneType, (l: number, r: () => number) => THREE.BufferGeometry> = {
    [Zone.Residential]: residential,
    [Zone.Commercial]: commercial,
    [Zone.Industrial]: industrial,
    [Zone.Office]: office,
  };
  for (const zone of [Zone.Residential, Zone.Commercial, Zone.Industrial, Zone.Office] as ZoneType[]) {
    for (let level = 1; level <= 3; level++) {
      for (let v = 0; v < VARIANTS; v++) {
        buildings.set(`${zone}-${level}-${v}`, makers[zone](level, rng(zone * 1000 + level * 100 + v * 7 + 3)));
      }
    }
  }
  const constructionModels = [construction(1), construction(1), construction(2), construction(3)];
  return { buildings, construction: constructionModels };
}
