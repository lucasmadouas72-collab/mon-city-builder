import type { World } from './World';

/** Transforme un tracé libre (droite ou courbe) en suite de cases reliées (8 directions). */

export type Pt = [number, number];

export function sampleLine(a: Pt, b: Pt): Pt[] {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const n = Math.max(1, Math.ceil(len / 0.2));
  const out: Pt[] = [];
  for (let k = 0; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  return out;
}

/** Courbe de Bézier quadratique (départ, point de contrôle, arrivée). */
export function sampleCurve(a: Pt, c: Pt, b: Pt): Pt[] {
  const len = Math.hypot(c[0] - a[0], c[1] - a[1]) + Math.hypot(b[0] - c[0], b[1] - c[1]);
  const n = Math.max(2, Math.ceil(len / 0.15));
  const out: Pt[] = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n, u = 1 - t;
    out.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]);
  }
  return out;
}

/**
 * Cases traversées par le tracé, chacune voisine de la précédente (diagonales comprises).
 * Une diagonale qui croiserait une autre diagonale existante passe par une case commune,
 * pour que les deux routes forment un vrai carrefour.
 */
export function rasterize(points: Pt[], world: World): number[] {
  const n = world.size;
  const clamp = (v: number) => Math.max(0, Math.min(n - 1, Math.floor(v)));
  const out: number[] = [];
  let ci = clamp(points[0][0]), cj = clamp(points[0][1]);
  out.push(cj * n + ci);
  for (const [x, z] of points) {
    const ti = clamp(x), tj = clamp(z);
    let guard = 0;
    while ((ci !== ti || cj !== tj) && guard++ < 4 * n) {
      let dx = Math.sign(ti - ci), dz = Math.sign(tj - cj);
      if (dx && dz) {
        // Croisement d'une diagonale existante : passer par une case commune
        const a = cj * n + ci + dx, b = (cj + dz) * n + ci;
        if (world.neighbors(a).includes(b)) dz = 0;
      }
      ci += dx; cj += dz;
      const k = cj * n + ci;
      if (out[out.length - 1] !== k) out.push(k);
    }
  }
  return out;
}

/** Tracé en L (axe dominant puis l'autre), comme sur une grille. */
export function gridPath(a: Pt, b: Pt, world: World): number[] {
  const n = world.size;
  const ai = Math.floor(a[0]), aj = Math.floor(a[1]), bi = Math.floor(b[0]), bj = Math.floor(b[1]);
  const out: number[] = [aj * n + ai];
  let i = ai, j = aj;
  const sx = Math.sign(bi - ai), sz = Math.sign(bj - aj);
  const stepX = () => { while (i !== bi) { i += sx; out.push(j * n + i); } };
  const stepZ = () => { while (j !== bj) { j += sz; out.push(j * n + i); } };
  if (Math.abs(bi - ai) >= Math.abs(bj - aj)) { stepX(); stepZ(); } else { stepZ(); stepX(); }
  return out;
}
