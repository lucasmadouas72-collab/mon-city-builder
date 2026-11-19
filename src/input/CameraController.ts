import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';

/**
 * Caméra de jeu : clic droit = rotation, clic molette (ou clic gauche avec l'outil Sélection) = déplacement,
 * molette = zoom. Clavier : ZQSD/WASD/flèches pour se déplacer, A/E pour tourner, R/F pour incliner.
 */
export class CameraController {
  readonly controls: MapControls;
  private keys = new Set<string>();

  constructor(private camera: THREE.PerspectiveCamera, dom: HTMLElement, private mapSize: number) {
    const c = new MapControls(camera, dom);
    c.enableDamping = true;
    c.dampingFactor = 0.12;
    c.screenSpacePanning = false;
    c.minDistance = 6;
    c.maxDistance = 190;
    c.minPolarAngle = 0.25;
    c.maxPolarAngle = 1.25;
    c.zoomToCursor = true;
    c.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
    c.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
    this.controls = c;

    const mid = mapSize / 2;
    c.target.set(mid, 0, mid + 6);
    camera.position.set(mid - 38, 52, mid + 52);
    c.update();

    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  private focusTarget: THREE.Vector3 | null = null;

  /** Déplace doucement la caméra vers un point de la carte. */
  focus(x: number, z: number): void {
    this.focusTarget = new THREE.Vector3(x, 0, z);
  }

  setLeftPan(enabled: boolean): void {
    this.controls.mouseButtons.LEFT = enabled ? THREE.MOUSE.PAN : null;
  }

  update(dt: number): void {
    const c = this.controls;
    const k = this.keys;
    const dist = this.camera.position.distanceTo(c.target);
    const speed = dist * 1.1 * dt;

    const forward = new THREE.Vector3().subVectors(c.target, this.camera.position).setY(0).normalize();
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0));
    const move = new THREE.Vector3();
    if (k.has('KeyW') || k.has('ArrowUp')) move.add(forward);
    if (k.has('KeyS') || k.has('ArrowDown')) move.sub(forward);
    if (k.has('KeyD') || k.has('ArrowRight')) move.add(right);
    if (k.has('KeyA') || k.has('ArrowLeft')) move.sub(right);
    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(speed);
      c.target.add(move);
      this.camera.position.add(move);
    }

    // Rotation autour de la cible (Q/E sur AZERTY : A/E ; sur QWERTY : Q/E)
    let rot = 0;
    if (k.has('KeyQ')) rot += 1;
    if (k.has('KeyE')) rot -= 1;
    if (rot) {
      const off = new THREE.Vector3().subVectors(this.camera.position, c.target);
      off.applyAxisAngle(new THREE.Vector3(0, 1, 0), rot * 1.6 * dt);
      this.camera.position.copy(c.target).add(off);
    }

    if (this.focusTarget) {
      const step = this.focusTarget.clone().sub(c.target).multiplyScalar(Math.min(1, dt * 5));
      c.target.add(step);
      this.camera.position.add(step);
      if (c.target.distanceTo(this.focusTarget) < 0.05) this.focusTarget = null;
    }

    // Garder la cible au-dessus de la carte
    const before = c.target.clone();
    c.target.x = THREE.MathUtils.clamp(c.target.x, -4, this.mapSize + 4);
    c.target.z = THREE.MathUtils.clamp(c.target.z, -4, this.mapSize + 4);
    c.target.y = 0;
    this.camera.position.add(c.target.clone().sub(before));

    c.update(dt);
  }
}
