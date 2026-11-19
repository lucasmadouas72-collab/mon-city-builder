import * as THREE from 'three';
import type { Environment, Weather } from '../sim/Environment';
import type { World } from '../sim/World';
import type { SceneRenderer } from './SceneRenderer';
import { ENV } from './envMaterials';

const C = (h: string) => new THREE.Color(h);
const SKY = {
  day: [C('#4f93d6'), C('#cfe6f5')],
  dusk: [C('#35507e'), C('#f2a36b')],
  night: [C('#070d1c'), C('#16233d')],
  grey: [C('#7d8a96'), C('#c3ccd3')],
};
const TINTS = [C('#ffffff'), C('#ffffff'), C('#f4e2b0'), C('#d9dccf')];

function particleTexture(kind: 'rain' | 'snow' | 'glow'): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  if (kind === 'rain') {
    const grad = g.createLinearGradient(16, 0, 16, 32);
    grad.addColorStop(0, 'rgba(200,220,255,0)');
    grad.addColorStop(1, 'rgba(200,220,255,0.9)');
    g.fillStyle = grad;
    g.fillRect(15, 0, 2, 32);
  } else {
    const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, kind === 'snow' ? 'rgba(255,255,255,1)' : 'rgba(255,214,150,1)');
    grad.addColorStop(kind === 'snow' ? 0.5 : 0.25, kind === 'snow' ? 'rgba(255,255,255,0.8)' : 'rgba(255,190,110,0.5)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 32, 32);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const PARTICLES = 7000;
const BOX = 60;

/** Ciel, soleil et lune, brouillard, pluie, neige, éclairs et éclairage public. */
export class Atmosphere {
  readonly group = new THREE.Group();
  private precip: THREE.Points;
  private precipMat: THREE.PointsMaterial;
  private seeds: Float32Array;
  private lamps: THREE.Points;
  private lampMat: THREE.PointsMaterial;
  private flash = 0;
  private snowCover = 0;
  private wet = 0;
  private texRain = particleTexture('rain');
  private texSnow = particleTexture('snow');

  constructor(private view: SceneRenderer, private world: World) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(PARTICLES * 3);
    this.seeds = new Float32Array(PARTICLES * 3);
    for (let k = 0; k < PARTICLES * 3; k++) this.seeds[k] = Math.random();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.precipMat = new THREE.PointsMaterial({ size: 0.35, map: this.texRain, transparent: true, depthWrite: false, opacity: 0.8 });
    this.precip = new THREE.Points(geo, this.precipMat);
    this.precip.frustumCulled = false;
    this.precip.visible = false;

    this.lampMat = new THREE.PointsMaterial({ size: 1.3, map: particleTexture('glow'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
    this.lamps = new THREE.Points(new THREE.BufferGeometry(), this.lampMat);
    this.lamps.frustumCulled = false;
    this.group.add(this.precip, this.lamps);
    this.rebuildLamps();
  }

  /** Un lampadaire par case de route, au coin du trottoir. */
  rebuildLamps(): void {
    const w = this.world;
    const pts: number[] = [];
    for (let k = 0; k < w.tiles.length; k++) {
      if (w.tiles[k] !== 1) continue;
      const i = k % w.size, j = Math.floor(k / w.size);
      if ((i + j) % 2) continue;
      const x = i + 0.1, z = j + 0.1;
      pts.push(x, w.roadY(x, z) + 0.32, z);
    }
    this.lamps.geometry.dispose();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.lamps.geometry = g;
  }

  update(env: Environment, month: number, dt: number, time: number): void {
    const v = this.view;
    const n = this.world.size;
    const night = env.night;
    const w: Weather = env.weather;
    const overcast = w === 'clouds' ? 0.5 : w === 'rain' || w === 'snow' ? 0.75 : w === 'storm' ? 0.95 : w === 'fog' ? 0.6 : 0;

    // Soleil (ou lune) selon l'heure
    const h = env.hour;
    const dayAngle = ((h - 6) / 14) * Math.PI; // lever 6 h, coucher 20 h
    const elev = Math.sin(dayAngle);
    const sunUp = elev > -0.05;
    const az = dayAngle;
    const dist = 110;
    if (sunUp) {
      v.sun.position.set(n / 2 - Math.cos(az) * dist, Math.max(8, elev * 100), n / 2 - 40 + Math.sin(az) * 15);
    } else {
      const moon = ((h + 24 - 20) % 24) / 10 * Math.PI;
      v.sun.position.set(n / 2 + Math.cos(moon) * dist, 60 + Math.sin(moon) * 40, n / 2 + 30);
    }
    const dusk = Math.max(0, 1 - Math.abs(elev) * 4) * (sunUp ? 1 : 0);
    const sunColor = C('#fff3dd').lerp(C('#ff9a55'), dusk * 0.8).lerp(C('#9fb4ff'), night);
    v.sun.color.copy(sunColor);
    v.sun.intensity = (sunUp ? 0.4 + 2.2 * Math.max(0, elev) ** 0.5 : 0.35) * (1 - overcast * 0.65) * (1 - night * 0.55);
    v.hemi.intensity = (1.1 - night * 0.75) * (1 - overcast * 0.2);
    v.hemi.color.copy(C('#dceeff').lerp(C('#5468a0'), night));

    // Ciel
    const top = SKY.day[0].clone().lerp(SKY.dusk[0], dusk).lerp(SKY.night[0], night).lerp(SKY.grey[0], overcast * (1 - night) * 0.8);
    const hor = SKY.day[1].clone().lerp(SKY.dusk[1], dusk).lerp(SKY.night[1], night).lerp(SKY.grey[1], overcast * (1 - night) * 0.8);
    if (this.flash > 0) { top.lerp(C('#ffffff'), this.flash * 0.6); hor.lerp(C('#ffffff'), this.flash * 0.6); }
    const skyMat = v.sky.material as THREE.ShaderMaterial;
    skyMat.uniforms.top.value.copy(top);
    skyMat.uniforms.horizon.value.copy(hor);
    skyMat.uniforms.bottom.value.copy(hor);
    const fog = v.scene.fog as THREE.Fog;
    fog.color.copy(hor);
    const fogNear = w === 'fog' ? 12 : w === 'snow' || w === 'storm' ? 60 : w === 'rain' ? 90 : 180;
    const fogFar = w === 'fog' ? 90 : w === 'snow' || w === 'storm' ? 220 : w === 'rain' ? 300 : 520;
    fog.near += (fogNear - fog.near) * Math.min(1, dt * 0.8);
    fog.far += (fogFar - fog.far) * Math.min(1, dt * 0.8);
    (v.ground.material as THREE.MeshStandardMaterial).color.copy(hor).lerp(C('#d9e2e4'), 0.4);
    v.renderer.toneMappingExposure = 1.05 - night * 0.15 + this.flash * 0.8;

    // Éclairs pendant les orages
    if (w === 'storm' && Math.random() < dt * 0.25) this.flash = 1;
    this.flash = Math.max(0, this.flash - dt * 4);
    v.hemi.intensity += this.flash * 2;

    // Neige au sol et routes mouillées : transitions progressives
    const season = env.season(month);
    const snowTarget = w === 'snow' ? 1 : w === 'frost' ? 0.55 : season === 3 ? 0.25 : 0;
    this.snowCover += (snowTarget - this.snowCover) * Math.min(1, dt * 0.15);
    this.wet += ((w === 'rain' || w === 'storm' ? 1 : 0) - this.wet) * Math.min(1, dt * 0.3);
    ENV.uSnow.value = this.snowCover;
    ENV.uWet.value = this.wet;
    ENV.uNight.value = night;
    ENV.uTint.value.lerp(TINTS[season], Math.min(1, dt * 0.2));

    // Éclairage public
    this.lampMat.opacity = night * 0.9;
    this.lamps.visible = night > 0.02;

    // Pluie et neige autour de la caméra
    const raining = w === 'rain' || w === 'storm';
    const snowing = w === 'snow';
    this.precip.visible = raining || snowing;
    if (this.precip.visible) {
      this.precipMat.map = snowing ? this.texSnow : this.texRain;
      this.precipMat.size = snowing ? 0.28 : 0.45;
      this.precipMat.opacity = snowing ? 0.95 : 0.6;
      const target = v.camera.position;
      const arr = this.precip.geometry.attributes.position.array as Float32Array;
      const fall = snowing ? 2.2 : 24;
      const count = w === 'storm' ? PARTICLES : snowing ? PARTICLES * 0.8 : PARTICLES * 0.6;
      for (let k = 0; k < PARTICLES; k++) {
        const o = k * 3;
        if (k >= count) { arr[o + 1] = -999; continue; }
        const sx = this.seeds[o], sy = this.seeds[o + 1], sz = this.seeds[o + 2];
        const y = ((sy * 40 - time * fall * (0.8 + sx * 0.4)) % 40 + 40) % 40;
        const sway = snowing ? Math.sin(time * 1.3 + sx * 20) * 0.6 : 0;
        arr[o] = target.x + (sx - 0.5) * BOX + sway;
        arr[o + 1] = target.y - 25 + y;
        arr[o + 2] = target.z + (sz - 0.5) * BOX;
      }
      this.precip.geometry.attributes.position.needsUpdate = true;
    }
  }
}
