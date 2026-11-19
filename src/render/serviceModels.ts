import * as THREE from 'three';
import { Service } from '../sim/services';
import { Builder, FLOOR } from './buildingModels';

/** Modèles des équipements publics (façade vers +z, sol à y = 0). */

function lot(b: Builder, color: string): Builder {
  b.box(0.9, 1.2, 0.9, 0, -1.2, 0, '#b3a994');
  return b.box(0.96, 0.03, 0.96, 0, 0, 0, color);
}

const GLASS = '#7fa6c4';

function powerPlant(): THREE.BufferGeometry {
  const b = lot(new Builder(), '#a19c92');
  b.box(0.42, 0.26, 0.36, -0.2, 0.03, 0.12, '#c9c3b8');
  b.box(0.43, 0.05, 0.37, -0.2, 0.16, 0.12, '#8a9097');
  b.add(new THREE.CylinderGeometry(0.13, 0.19, 0.5, 14, 1, true), '#d9d6cf', 0.2, 0.28, -0.18); // tour de refroidissement
  b.add(new THREE.CylinderGeometry(0.135, 0.135, 0.02, 14), '#b8b4ad', 0.2, 0.53, -0.18);
  b.cyl(0.035, 0.85, -0.32, 0.03, -0.25, '#b5513c', 8);
  b.cyl(0.035, 0.85, -0.18, 0.03, -0.25, '#b5513c', 8);
  b.cyl(0.04, 0.05, -0.32, 0.88, -0.25, '#f1ede6', 8);
  b.cyl(0.04, 0.05, -0.18, 0.88, -0.25, '#f1ede6', 8);
  b.box(0.2, 0.1, 0.12, 0.25, 0.03, 0.3, '#facc15');
  return b.build();
}

function windTurbine(): THREE.BufferGeometry {
  const b = lot(new Builder(), '#8fbf5a');
  b.add(new THREE.CylinderGeometry(0.018, 0.035, 1.1, 8), '#f2f2f0', 0, 0.58, 0);
  b.box(0.06, 0.05, 0.12, 0, 1.12, -0.02, '#e6e6e2');
  for (let k = 0; k < 3; k++) {
    const blade = new THREE.BoxGeometry(0.03, 0.42, 0.012).translate(0, 0.21, 0).rotateZ((k * Math.PI * 2) / 3 + 0.3);
    b.add(blade, '#fafaf8', 0, 1.145, 0.05);
  }
  b.box(0.16, 0.06, 0.1, 0.25, 0.03, 0.28, '#c9c3b8');
  return b.build();
}

function waterPump(): THREE.BufferGeometry {
  const b = lot(new Builder(), '#b9b4aa');
  b.box(0.36, 0.2, 0.3, -0.18, 0.03, 0.15, '#e4e0d8');
  b.gable(0.4, 0.1, 0.34, -0.18, 0.23, 0.15, '#3d7fae');
  b.cyl(0.17, 0.26, 0.18, 0.03, -0.16, '#5aa9d6', 16);
  b.cyl(0.175, 0.02, 0.18, 0.29, -0.16, '#e8f4fb', 16);
  b.add(new THREE.CylinderGeometry(0.025, 0.025, 0.5, 8).rotateZ(Math.PI / 2), '#7c8794', 0.05, 0.1, -0.38);
  return b.build();
}

function sewage(): THREE.BufferGeometry {
  const b = lot(new Builder(), '#a8a294');
  for (const [x, z] of [[-0.2, -0.18], [0.2, -0.18], [0.2, 0.2]]) {
    b.cyl(0.17, 0.08, x, 0.03, z, '#b9b4aa', 16);
    b.cyl(0.15, 0.085, x, 0.03, z, '#6f8a5a', 16);
    b.box(0.3, 0.02, 0.02, x, 0.12, z, '#7c8794');
  }
  b.box(0.3, 0.18, 0.26, -0.22, 0.03, 0.22, '#d8d2c4');
  return b.build();
}

function landfill(): THREE.BufferGeometry {
  const b = lot(new Builder(), '#8a8170');
  b.add(new THREE.ConeGeometry(0.25, 0.2, 7), '#7a6a52', -0.16, 0.13, -0.14);
  b.add(new THREE.ConeGeometry(0.18, 0.14, 6), '#6b7a5a', 0.15, 0.1, -0.2);
  b.box(0.36, 0.2, 0.26, 0.18, 0.03, 0.22, '#c2cad0');
  b.box(0.37, 0.03, 0.27, 0.18, 0.23, 0.22, '#64748b');
  for (let k = 0; k < 3; k++) b.box(0.08, 0.07, 0.06, -0.32 + k * 0.1, 0.03, 0.3, ['#16a34a', '#2563eb', '#ca8a04'][k]);
  return b.build();
}

function clinic(): THREE.BufferGeometry {
  const b = lot(new Builder(), '#cfcac0');
  b.tower(0.66, 0.5, 3, 0, 0.03, -0.08, '#f5f5f2', GLASS);
  const top = 0.03 + 3 * FLOOR;
  b.box(0.7, 0.03, 0.54, 0, top, -0.08, '#c7ccd1');
  b.box(0.2, 0.06, 0.02, 0, top - 0.16, 0.18, '#ef4444');
  b.box(0.06, 0.2, 0.02, 0, top - 0.23, 0.18, '#ef4444');
  b.box(0.3, 0.02, 0.16, 0, 0.13, 0.26, '#e2e8f0'); // auvent urgences
  b.box(0.16, 0.06, 0.08, 0.3, 0.03, 0.34, '#ffffff'); // ambulance
  b.box(0.16, 0.012, 0.081, 0.3, 0.06, 0.34, '#ef4444');
  return b.build();
}

function school(): THREE.BufferGeometry {
  const b = lot(new Builder(), '#c9a978');
  b.tower(0.7, 0.34, 2, 0, 0.03, -0.24, '#e9c48f', GLASS);
  b.gable(0.74, 0.12, 0.38, 0, 0.03 + 2 * FLOOR, -0.24, '#a5492f');
  b.box(0.5, 0.012, 0.3, -0.1, 0.03, 0.2, '#5a9e4a'); // terrain de sport
  b.box(0.012, 0.012, 0.3, -0.1, 0.043, 0.2, '#f5f5f2');
  b.cyl(0.008, 0.4, 0.34, 0.03, 0.3, '#d1d5db', 6);
  b.box(0.1, 0.06, 0.005, 0.39, 0.36, 0.3, '#3b82f6');
  return b.build();
}

function police(): THREE.BufferGeometry {
  const b = lot(new Builder(), '#c8c6c0');
  b.tower(0.62, 0.46, 2, 0, 0.03, -0.1, '#e5e7eb', GLASS);
  b.box(0.66, 0.05, 0.5, 0, 0.03 + 2 * FLOOR, -0.1, '#1e40af');
  b.box(0.3, 0.06, 0.02, 0, 0.2, 0.135, '#1d4ed8');
  for (const x of [-0.2, 0.05]) {
    b.box(0.16, 0.05, 0.08, x, 0.03, 0.32, '#f8fafc');
    b.box(0.16, 0.025, 0.081, x, 0.05, 0.32, '#1e3a8a');
    b.box(0.04, 0.012, 0.02, x, 0.08, 0.32, '#60a5fa');
  }
  return b.build();
}

function fireStation(): THREE.BufferGeometry {
  const b = lot(new Builder(), '#bdb8ae');
  b.box(0.62, 0.26, 0.46, -0.06, 0.03, -0.08, '#c0392b');
  b.box(0.64, 0.03, 0.48, -0.06, 0.29, -0.08, '#7f1d1d');
  for (const x of [-0.24, -0.06, 0.12]) b.box(0.14, 0.17, 0.01, x, 0.03, 0.155, '#e5e7eb');
  b.box(0.12, 0.62, 0.12, 0.32, 0.03, -0.22, '#a93226'); // tour de séchage
  b.box(0.14, 0.04, 0.14, 0.32, 0.65, -0.22, '#7f1d1d');
  b.box(0.2, 0.08, 0.09, -0.12, 0.03, 0.34, '#dc2626');
  return b.build();
}

function park(): THREE.BufferGeometry {
  const b = lot(new Builder(), '#7fbf55');
  b.box(0.96, 0.012, 0.12, 0, 0.03, 0, '#d9c9a3'); // allées
  b.box(0.12, 0.012, 0.96, 0, 0.03, 0, '#d9c9a3');
  b.cyl(0.12, 0.05, 0, 0.03, 0, '#c9c3b8', 14); // fontaine
  b.cyl(0.09, 0.052, 0, 0.03, 0, '#5ab4e0', 14);
  b.cyl(0.015, 0.1, 0, 0.03, 0, '#e5e7eb', 6);
  for (const [x, z, s] of [[-0.3, -0.3, 1], [0.3, -0.28, 0.8], [-0.28, 0.3, 0.9], [0.32, 0.3, 1.1]]) {
    b.cyl(0.02, 0.12 * s, x, 0.03, z, '#6b4a32', 5);
    b.add(new THREE.IcosahedronGeometry(0.12 * s, 0), '#3f8f3a', x, 0.03 + 0.2 * s, z);
  }
  b.box(0.12, 0.03, 0.04, -0.2, 0.03, 0.1, '#8b5a3c'); // banc
  return b.build();
}

function metroStation(): THREE.BufferGeometry {
  const b = lot(new Builder(), '#c9c4b8');
  b.box(0.7, 0.03, 0.5, 0, 0.03, 0.05, '#9ca3af'); // parvis
  b.box(0.44, 0.2, 0.3, 0, 0.03, -0.12, '#e5e7eb');
  b.add(new THREE.CylinderGeometry(0.26, 0.26, 0.46, 12, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateY(Math.PI / 2).scale(1, 0.45, 1), '#a5b4fc', 0, 0.23, -0.12); // verrière
  b.box(0.2, 0.12, 0.02, 0, 0.03, 0.04, '#1f2937'); // bouche de métro
  b.box(0.06, 0.32, 0.06, 0.3, 0.03, 0.28, '#4b5563');
  b.box(0.14, 0.14, 0.03, 0.3, 0.35, 0.28, '#e879f9'); // totem M
  return b.build();
}

function levee(): THREE.BufferGeometry {
  const b = lot(new Builder(), '#8fbf5a');
  b.add(new THREE.BoxGeometry(0.96, 0.3, 0.4).translate(0, 0.15, 0.1), '#9a9387');
  b.box(0.96, 0.04, 0.42, 0, 0.3, 0.1, '#7c8794');
  b.add(new THREE.BoxGeometry(0.96, 0.2, 0.3).rotateX(-0.5).translate(0, 0.12, 0.38), '#7fa35a');
  return b.build();
}

function warningCenter(): THREE.BufferGeometry {
  const b = lot(new Builder(), '#c9c4b8');
  b.tower(0.5, 0.42, 2, -0.12, 0.03, 0.05, '#e5e7eb', '#7fa6c4');
  b.box(0.06, 0.8, 0.06, 0.3, 0.03, -0.25, '#9ca3af'); // mât
  b.add(new THREE.SphereGeometry(0.12, 12, 8), '#f8fafc', 0.3, 0.9, -0.25); // radar
  b.add(new THREE.ConeGeometry(0.07, 0.12, 8).rotateX(Math.PI), '#ef4444', -0.12, 0.38, 0.05); // sirène
  return b.build();
}

/** Tour de refroidissement en hyperboloïde (profil tourné). */
function coolingTower(b: Builder, x: number, z: number, h: number, r: number): void {
  const pts: THREE.Vector2[] = [];
  for (let k = 0; k <= 8; k++) { const t = k / 8; pts.push(new THREE.Vector2(r * (0.62 + 0.38 * Math.pow(Math.abs(t - 0.65) / 0.65, 1.6)), t * h)); }
  b.add(new THREE.LatheGeometry(pts, 16), '#e4e1da', x, 0.03, z);
  b.add(new THREE.CylinderGeometry(r * 0.75, r * 0.75, 0.01, 16), '#6b6b6b', x, 0.03 + h - 0.01, z);
}

function nuclearPlant(): THREE.BufferGeometry {
  const b = lot(new Builder(), '#9fa39a');
  coolingTower(b, -0.2, -0.18, 0.62, 0.2);
  coolingTower(b, 0.2, -0.22, 0.55, 0.17);
  b.cyl(0.13, 0.22, 0.22, 0.03, 0.22, '#d9dde1', 16); // enceinte du réacteur
  b.add(new THREE.SphereGeometry(0.13, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), '#cfd4d9', 0.22, 0.25, 0.22);
  b.box(0.3, 0.16, 0.2, -0.2, 0.03, 0.26, '#c9c3b8');
  b.box(0.31, 0.02, 0.21, -0.2, 0.19, 0.26, '#7c8794');
  return b.build();
}

function solarFarm(): THREE.BufferGeometry {
  const b = lot(new Builder(), '#9cbf6a');
  for (let r = 0; r < 4; r++) for (let c = 0; c < 2; c++) {
    b.add(new THREE.BoxGeometry(0.36, 0.012, 0.15).rotateX(-0.45), '#1e3a5f', -0.2 + c * 0.4, 0.1, -0.33 + r * 0.22);
    b.box(0.01, 0.07, 0.01, -0.2 + c * 0.4, 0.03, -0.33 + r * 0.22, '#9ca3af');
  }
  b.box(0.12, 0.09, 0.08, 0.38, 0.03, 0.4, '#e5e7eb'); // onduleur
  return b.build();
}

function hydroDam(): THREE.BufferGeometry {
  const b = lot(new Builder(), '#8f969a');
  b.add(new THREE.BoxGeometry(0.96, 0.5, 0.22).translate(0, 0.25, -0.2), '#c8c6bf'); // mur du barrage
  b.box(0.96, 0.04, 0.24, 0, 0.5, -0.2, '#9a9890');
  for (let k = 0; k < 3; k++) b.box(0.12, 0.3, 0.02, -0.3 + k * 0.3, 0.1, -0.08, '#5b8fb3'); // vannes
  b.box(0.5, 0.18, 0.24, 0.1, 0.03, 0.22, '#d8d2c4'); // salle des turbines
  b.box(0.52, 0.03, 0.26, 0.1, 0.21, 0.22, '#3d7fae');
  b.box(0.18, 0.02, 0.4, -0.35, 0.03, 0.2, '#6aa9d8'); // canal de fuite
  return b.build();
}

function substation(): THREE.BufferGeometry {
  const b = lot(new Builder(), '#b8b2a5');
  for (const [x, z] of [[-0.2, -0.15], [0.12, -0.15], [-0.2, 0.18]]) {
    b.box(0.16, 0.16, 0.14, x, 0.03, z, '#7d8790'); // transformateurs
    for (let k = 0; k < 3; k++) b.cyl(0.012, 0.08, x - 0.05 + k * 0.05, 0.19, z, '#e8e2d6', 6); // isolateurs
  }
  b.box(0.04, 0.5, 0.04, 0.32, 0.03, 0.25, '#9ca3af');
  b.box(0.3, 0.03, 0.03, 0.2, 0.5, 0.25, '#9ca3af');
  b.box(0.9, 0.08, 0.01, 0, 0.03, 0.45, '#8a8f94'); // clôture
  b.box(0.01, 0.08, 0.9, -0.45, 0.03, 0, '#8a8f94');
  b.box(0.01, 0.08, 0.9, 0.45, 0.03, 0, '#8a8f94');
  return b.build();
}

function interconnect(): THREE.BufferGeometry {
  const b = lot(new Builder(), '#a9b39a');
  // Grand pylône
  b.add(new THREE.CylinderGeometry(0.03, 0.14, 1.1, 4).rotateY(Math.PI / 4), '#9ca3af', -0.15, 0.58, -0.1);
  b.box(0.6, 0.03, 0.03, -0.15, 0.95, -0.1, '#9ca3af');
  b.box(0.45, 0.03, 0.03, -0.15, 0.78, -0.1, '#9ca3af');
  b.box(0.24, 0.14, 0.2, 0.25, 0.03, 0.22, '#d6d3cc'); // poste de commande
  b.cyl(0.11, 0.2, 0.25, 0.03, -0.25, '#5aa9d6', 14); // conduite d'eau
  b.add(new THREE.CylinderGeometry(0.035, 0.035, 0.6, 8).rotateZ(Math.PI / 2), '#5aa9d6', 0.2, 0.08, 0.0);
  return b.build();
}

function waterTreatment(): THREE.BufferGeometry {
  const b = lot(new Builder(), '#b3ada0');
  for (const [x, z] of [[-0.22, -0.2], [0.18, -0.2]]) { b.cyl(0.17, 0.08, x, 0.03, z, '#c9c4b8', 16); b.cyl(0.15, 0.085, x, 0.03, z, '#4fb3d9', 16); }
  b.box(0.36, 0.1, 0.2, -0.2, 0.03, 0.22, '#c9c4b8');
  b.box(0.34, 0.105, 0.18, -0.2, 0.03, 0.22, '#7dd3fc');
  b.box(0.26, 0.2, 0.24, 0.24, 0.03, 0.22, '#eef2f5');
  b.gable(0.3, 0.08, 0.28, 0.24, 0.23, 0.22, '#0e7490');
  return b.build();
}

function waterTower(): THREE.BufferGeometry {
  const b = lot(new Builder(), '#9cbf6a');
  for (const [x, z] of [[-0.12, -0.12], [0.12, -0.12], [-0.12, 0.12], [0.12, 0.12]]) b.box(0.03, 0.6, 0.03, x, 0.03, z, '#9ca3af');
  b.cyl(0.04, 0.6, 0, 0.03, 0, '#7c8794', 8);
  b.add(new THREE.SphereGeometry(0.22, 16, 10), '#7dd3fc', 0, 0.78, 0);
  b.cyl(0.18, 0.04, 0, 0.6, 0, '#9ca3af', 16);
  return b.build();
}

function incinerator(): THREE.BufferGeometry {
  const b = lot(new Builder(), '#9a958b');
  b.box(0.56, 0.32, 0.4, -0.12, 0.03, 0.1, '#b9b3a6');
  b.box(0.57, 0.04, 0.41, -0.12, 0.35, 0.1, '#5d6a64');
  b.cyl(0.05, 1.1, 0.3, 0.03, -0.25, '#d6d3cc', 10);
  b.box(0.11, 0.06, 0.11, 0.3, 0.95, -0.25, '#b5513c');
  b.box(0.2, 0.18, 0.02, -0.12, 0.03, 0.31, '#4b5563'); // fosse de déchargement
  return b.build();
}

function recycling(): THREE.BufferGeometry {
  const b = lot(new Builder(), '#b7b2a6');
  b.box(0.6, 0.24, 0.36, -0.1, 0.03, -0.16, '#d6dde2');
  b.add(new THREE.CylinderGeometry(0.18, 0.18, 0.6, 10, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).scale(1, 0.4, 1), '#10b981', -0.1, 0.27, -0.16);
  for (let k = 0; k < 4; k++) b.box(0.14, 0.12, 0.12, -0.32 + k * 0.18, 0.03, 0.3, ['#16a34a', '#2563eb', '#ca8a04', '#9ca3af'][k]);
  b.box(0.16, 0.08, 0.16, 0.34, 0.03, 0.05, '#8b9198'); // balles compactées
  return b.build();
}

function composting(): THREE.BufferGeometry {
  const b = lot(new Builder(), '#8f8a60');
  for (let k = 0; k < 4; k++) b.add(new THREE.CylinderGeometry(0.08, 0.08, 0.7, 6, 1, false, 0, Math.PI).rotateZ(Math.PI / 2), k % 2 ? '#5b4630' : '#6b5638', 0, 0.03, -0.33 + k * 0.2);
  b.box(0.18, 0.1, 0.14, 0.34, 0.03, 0.36, '#e3b341');
  return b.build();
}

function landfillSite(): THREE.BufferGeometry {
  const b = lot(new Builder(), '#7d7462');
  b.add(new THREE.ConeGeometry(0.42, 0.3, 8).scale(1, 1, 0.8), '#6f6450', -0.05, 0.18, -0.08);
  b.add(new THREE.ConeGeometry(0.25, 0.2, 7), '#7b8a5c', 0.25, 0.13, 0.22);
  for (let k = 0; k < 8; k++) b.box(0.04, 0.03, 0.05, -0.3 + (k % 4) * 0.12, 0.2 + Math.floor(k / 4) * 0.06, -0.15 + (k % 3) * 0.08, ['#d4d4d4', '#2563eb', '#ca8a04', '#a3a3a3'][k % 4]);
  b.box(0.1, 0.06, 0.16, -0.36, 0.03, 0.34, '#eab308'); // bulldozer
  b.box(0.96, 0.06, 0.01, 0, 0.03, 0.47, '#8a8f94');
  return b.build();
}

function depot(color: string, roof: string, rails = false): THREE.BufferGeometry {
  const b = lot(new Builder(), '#8f939a');
  b.box(0.8, 0.26, 0.5, 0, 0.03, -0.18, '#d1d5db');
  b.add(new THREE.CylinderGeometry(0.25, 0.25, 0.8, 12, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).scale(1, 0.35, 1), roof, 0, 0.29, -0.18);
  for (let k = 0; k < 3; k++) b.box(0.18, 0.2, 0.01, -0.26 + k * 0.26, 0.03, 0.075, '#4b5563');
  if (rails) for (let k = 0; k < 3; k++) for (const o of [-0.04, 0.04]) b.box(0.012, 0.01, 0.4, -0.26 + k * 0.26 + o, 0.03, 0.27, '#9ca3af');
  else for (let k = 0; k < 3; k++) b.box(0.12, 0.09, 0.28, -0.26 + k * 0.26, 0.03, 0.28, color);
  return b.build();
}

function trainStation(): THREE.BufferGeometry {
  const b = lot(new Builder(), '#b9b4aa');
  b.box(0.7, 0.26, 0.34, 0, 0.03, -0.2, '#e8dcc4'); // bâtiment voyageurs
  b.gable(0.74, 0.14, 0.38, 0, 0.29, -0.2, '#7c4a3a');
  b.box(0.12, 0.3, 0.12, 0.28, 0.29, -0.2, '#e8dcc4'); // horloge
  b.cyl(0.04, 0.01, 0.28, 0.5, -0.135, '#f8fafc', 12);
  b.box(0.9, 0.05, 0.18, 0, 0.03, 0.2, '#a8a29e'); // quai
  b.box(0.9, 0.02, 0.16, 0, 0.22, 0.2, '#9ca3af'); // marquise
  for (let k = 0; k < 4; k++) b.box(0.02, 0.17, 0.02, -0.4 + k * 0.27, 0.05, 0.2, '#6b7280');
  return b.build();
}

function ferryPier(): THREE.BufferGeometry {
  const b = lot(new Builder(), '#c2b8a3');
  b.box(0.36, 0.18, 0.3, -0.2, 0.03, -0.22, '#f1f5f9');
  b.gable(0.4, 0.1, 0.34, -0.2, 0.21, -0.22, '#0369a1');
  b.box(0.3, 0.04, 0.9, 0.25, 0.03, 0.05, '#8b6a4a'); // ponton
  for (let k = 0; k < 4; k++) b.cyl(0.02, 0.12, 0.38, -0.3 + k * 0.25, 0.03, '#5b4636', 6);
  return b.build();
}

function taxiDepot(): THREE.BufferGeometry {
  const b = lot(new Builder(), '#8f939a');
  b.box(0.36, 0.16, 0.28, -0.25, 0.03, -0.25, '#e5e7eb');
  b.box(0.2, 0.06, 0.02, -0.25, 0.14, -0.105, '#facc15');
  for (let k = 0; k < 4; k++) b.box(0.08, 0.05, 0.15, 0.0 + k * 0.12, 0.03, 0.15, '#facc15');
  return b.build();
}

function bikeStation(): THREE.BufferGeometry {
  const b = lot(new Builder(), '#c9c4b8');
  b.box(0.7, 0.02, 0.2, 0, 0.03, 0.1, '#4b5563');
  for (let k = 0; k < 7; k++) {
    b.box(0.015, 0.08, 0.14, -0.3 + k * 0.1, 0.05, 0.1, '#16a34a');
    b.add(new THREE.TorusGeometry(0.035, 0.008, 4, 10).rotateY(Math.PI / 2), '#111827', -0.3 + k * 0.1, 0.09, 0.05);
  }
  b.box(0.08, 0.22, 0.06, 0.38, 0.03, -0.1, '#22c55e'); // borne
  b.tree(-0.3, -0.25, 1);
  return b.build();
}

function parking(): THREE.BufferGeometry {
  const b = lot(new Builder(), '#8f939a');
  for (let f = 0; f < 3; f++) {
    b.box(0.86, 0.03, 0.8, 0, 0.03 + f * 0.14, -0.02, '#9ca3af');
    for (let k = 0; k < 4; k++) b.box(0.03, 0.11, 0.03, -0.4 + k * 0.27, 0.06 + f * 0.14, 0.35, '#6b7280');
    for (let k = 0; k < 5; k++) b.box(0.07, 0.04, 0.12, -0.32 + k * 0.16, 0.06 + f * 0.14, -0.2, ['#c0392b', '#2c3e50', '#ecf0f1', '#2980b9', '#7f8c8d'][(k + f) % 5]);
  }
  b.box(0.16, 0.16, 0.02, 0.32, 0.45, 0.4, '#2563eb'); // panneau P
  b.box(0.06, 0.08, 0.025, 0.32, 0.49, 0.405, '#f8fafc');
  return b.build();
}

/** Aéroport (5 × 3 cases) : piste, taxiway, terminal, tour de contrôle, avions. */
function airport(): THREE.BufferGeometry {
  const b = new Builder();
  b.box(4.9, 1.2, 2.9, 0, -1.2, 0, '#b3a994');
  b.box(4.96, 0.03, 2.96, 0, 0, 0, '#8fbf5a');
  b.box(4.8, 0.012, 0.5, 0, 0.03, -0.8, '#3f4349'); // piste
  for (let k = 0; k < 16; k++) b.box(0.15, 0.004, 0.03, -2.2 + k * 0.29, 0.043, -0.8, '#f8fafc');
  b.box(4.2, 0.01, 0.16, 0, 0.03, -0.25, '#4b5057'); // taxiway
  b.box(1.8, 0.01, 0.7, -0.6, 0.03, 0.45, '#6b7077'); // aire de stationnement
  b.box(1.6, 0.3, 0.45, -0.6, 0.03, 1.1, '#e2e8f0'); // terminal
  b.box(1.62, 0.12, 0.47, -0.6, 0.08, 1.1, '#7fb3d5');
  b.add(new THREE.CylinderGeometry(0.4, 0.4, 1.6, 16, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).scale(1, 0.25, 0.6), '#cbd5e1', -0.6, 0.33, 1.1);
  b.cyl(0.06, 0.9, 1.0, 0.03, 0.9, '#d1d5db', 8); // tour de contrôle
  b.cyl(0.13, 0.12, 1.0, 0.93, 0.9, '#7fb3d5', 10);
  b.box(0.9, 0.22, 0.5, 1.8, 0.03, 0.95, '#cbd5e1'); // hangar
  const plane = (x: number, z: number, r: number) => {
    b.add(new THREE.CylinderGeometry(0.05, 0.04, 0.6, 8).rotateX(Math.PI / 2).rotateY(r), '#f8fafc', x, 0.1, z);
    b.add(new THREE.BoxGeometry(0.7, 0.015, 0.14).rotateY(r), '#e2e8f0', x, 0.09, z);
    b.add(new THREE.BoxGeometry(0.24, 0.012, 0.07).rotateY(r), '#e2e8f0', x - Math.sin(r) * 0.26, 0.12, z - Math.cos(r) * 0.26);
  };
  plane(-1.1, 0.45, 0); plane(-0.2, 0.45, 0); plane(1.2, -0.8, Math.PI / 2);
  return b.build();
}

/** Port de commerce (3 × 2 cases) : quai, grues, conteneurs, entrepôt. */
function harbor(): THREE.BufferGeometry {
  const b = new Builder();
  b.box(2.9, 1.2, 1.9, 0, -1.2, 0, '#b3a994');
  b.box(2.96, 0.03, 1.96, 0, 0, 0, '#8a8f96');
  b.box(2.96, 0.06, 0.25, 0, 0.0, 0.86, '#6b7280'); // quai
  for (let k = 0; k < 2; k++) {
    const x = -0.7 + k * 1.3;
    for (const dx of [-0.15, 0.15]) b.box(0.04, 0.7, 0.04, x + dx, 0.03, 0.7, '#f97316');
    b.box(0.1, 0.06, 1.3, x, 0.73, 0.5, '#f97316'); // flèche de grue
    b.box(0.18, 0.12, 0.16, x, 0.6, 0.55, '#ea580c');
  }
  const colors = ['#c0392b', '#2980b9', '#27ae60', '#e67e22', '#8e44ad', '#16a085'];
  for (let k = 0; k < 18; k++) b.box(0.3, 0.1, 0.12, -1.1 + (k % 6) * 0.42, 0.03 + Math.floor(k / 6) * 0.1, -0.1 + (k % 2) * 0.14, colors[k % 6]);
  b.box(1.0, 0.28, 0.45, 0.8, 0.03, -0.65, '#cbd5e1');
  return b.build();
}

// ---------- Culture, sport, loisirs (§15) ----------

function columns(b: Builder, x0: number, x1: number, z: number, y0: number, h: number, count: number, color: string): void {
  for (let k = 0; k < count; k++) b.cyl(0.025, h, x0 + (k / (count - 1)) * (x1 - x0), y0, z, color, 8);
}

function museum(): THREE.BufferGeometry {
  const b = lot(new Builder(), '#d6d0c4');
  b.box(0.74, 0.06, 0.56, 0, 0.03, -0.06, '#e7e1d4'); // soubassement
  b.box(0.66, 0.3, 0.42, 0, 0.09, -0.12, '#f3efe6');
  columns(b, -0.3, 0.3, 0.13, 0.09, 0.28, 6, '#ffffff');
  b.gable(0.74, 0.12, 0.56, 0, 0.39, -0.06, '#d9d2c3');
  b.box(0.3, 0.02, 0.12, 0, 0.03, 0.32, '#cfc8ba'); // escalier
  return b.build();
}

function monument(): THREE.BufferGeometry {
  const b = lot(new Builder(), '#d9cdb3');
  b.cyl(0.38, 0.02, 0, 0.03, 0, '#cbbd9f', 20);
  b.box(0.24, 0.12, 0.24, 0, 0.05, 0, '#b8ab90');
  b.add(new THREE.CylinderGeometry(0.03, 0.08, 0.9, 4).rotateY(Math.PI / 4), '#e9e2d0', 0, 0.62, 0); // obélisque
  b.add(new THREE.ConeGeometry(0.035, 0.08, 4).rotateY(Math.PI / 4), '#d4af37', 0, 1.11, 0);
  for (const [x, z] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) b.tree(x, z, 0.8);
  return b.build();
}

function theater(): THREE.BufferGeometry {
  const b = lot(new Builder(), '#cfc8ba');
  b.box(0.72, 0.36, 0.5, 0, 0.03, -0.1, '#b4413c');
  b.box(0.74, 0.06, 0.52, 0, 0.39, -0.1, '#e8d8b0');
  b.add(new THREE.SphereGeometry(0.16, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), '#2f6d6a', 0, 0.45, -0.15); // coupole
  b.box(0.5, 0.18, 0.02, 0, 0.06, 0.16, '#f5d77a'); // marquise lumineuse
  b.box(0.6, 0.02, 0.14, 0, 0.25, 0.22, '#e8d8b0');
  return b.build();
}

function cinema(): THREE.BufferGeometry {
  const b = lot(new Builder(), '#9ca3af');
  b.box(0.78, 0.32, 0.56, 0, 0.03, -0.1, '#374151');
  b.box(0.6, 0.12, 0.02, 0, 0.22, 0.19, '#fde047'); // enseigne
  for (let k = 0; k < 4; k++) b.box(0.1, 0.14, 0.01, -0.24 + k * 0.16, 0.36, 0.181, ['#ef4444', '#3b82f6', '#22c55e', '#f97316'][k]); // affiches
  b.box(0.5, 0.14, 0.01, 0, 0.05, 0.181, '#9cc3dd');
  return b.build();
}

function concertHall(): THREE.BufferGeometry {
  const b = lot(new Builder(), '#cbd5e1');
  b.add(new THREE.CylinderGeometry(0.36, 0.42, 0.34, 18), '#e2e8f0', 0, 0.2, -0.05);
  b.add(new THREE.SphereGeometry(0.36, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.45, 1), '#94a3b8', 0, 0.37, -0.05);
  b.box(0.5, 0.16, 0.06, 0, 0.03, 0.36, '#7c3aed');
  return b.build();
}

function congressCenter(): THREE.BufferGeometry {
  const b = new Builder();
  b.box(1.9, 1.2, 1.9, 0, -1.2, 0, '#b3a994');
  b.box(1.96, 0.03, 1.96, 0, 0, 0, '#c9c4b8');
  b.box(1.5, 0.34, 1.1, 0, 0.03, -0.25, '#e2e8f0');
  b.box(1.52, 0.2, 1.12, 0, 0.12, -0.25, '#7fb3d5');
  b.add(new THREE.BoxGeometry(1.7, 0.03, 1.3).rotateX(0.06), '#64748b', 0, 0.4, -0.25); // toit en porte-à-faux
  b.box(0.8, 0.02, 0.5, 0, 0.03, 0.65, '#d6d3cc'); // parvis
  for (let k = 0; k < 4; k++) b.box(0.03, 0.4, 0.03, -0.6 + k * 0.4, 0.03, 0.62, '#94a3b8'); // mâts
  for (let k = 0; k < 4; k++) b.box(0.12, 0.08, 0.005, -0.54 + k * 0.4, 0.33, 0.62, ['#ef4444', '#3b82f6', '#22c55e', '#facc15'][k]);
  return b.build();
}

function stadium(): THREE.BufferGeometry {
  const b = new Builder();
  b.box(2.9, 1.2, 2.9, 0, -1.2, 0, '#b3a994');
  b.box(2.96, 0.03, 2.96, 0, 0, 0, '#9ca3af');
  // Tribunes en anneau (ellipse)
  const pts: THREE.Vector2[] = [new THREE.Vector2(0.95, 0), new THREE.Vector2(1.3, 0), new THREE.Vector2(1.3, 0.5), new THREE.Vector2(1.05, 0.42)];
  b.add(new THREE.LatheGeometry(pts, 32).scale(1, 1, 0.8), '#e5e7eb', 0, 0.03, 0);
  b.add(new THREE.LatheGeometry([new THREE.Vector2(0.97, 0.05), new THREE.Vector2(1.27, 0.45)], 32).scale(1, 1, 0.8), '#0891b2', 0, 0.03, 0);
  b.add(new THREE.CylinderGeometry(0.95, 0.95, 0.02, 32).scale(1, 1, 0.8), '#4ade80', 0, 0.04, 0); // pelouse
  b.box(1.0, 0.004, 0.012, 0, 0.055, 0, '#f8fafc');
  b.add(new THREE.TorusGeometry(0.5, 0.005, 4, 24).rotateX(Math.PI / 2).scale(1, 1, 0.8), '#f8fafc', 0, 0.055, 0);
  for (const [x, z] of [[-1.25, -1], [1.25, -1], [-1.25, 1], [1.25, 1]]) { b.box(0.04, 0.9, 0.04, x, 0.03, z, '#9ca3af'); b.box(0.2, 0.08, 0.04, x, 0.92, z, '#f8fafc'); } // projecteurs
  return b.build();
}

function arena(): THREE.BufferGeometry {
  const b = new Builder();
  b.box(1.9, 1.2, 1.9, 0, -1.2, 0, '#b3a994');
  b.box(1.96, 0.03, 1.96, 0, 0, 0, '#9ca3af');
  b.add(new THREE.CylinderGeometry(0.85, 0.9, 0.38, 24), '#cbd5e1', 0, 0.22, 0);
  b.add(new THREE.CylinderGeometry(0.87, 0.87, 0.12, 24), '#0e7490', 0, 0.28, 0);
  b.add(new THREE.SphereGeometry(0.85, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.25, 1), '#e2e8f0', 0, 0.41, 0);
  return b.build();
}

function gym(): THREE.BufferGeometry {
  const b = lot(new Builder(), '#c9c4b8');
  b.box(0.72, 0.28, 0.5, 0, 0.03, -0.1, '#e5e7eb');
  b.add(new THREE.CylinderGeometry(0.25, 0.25, 0.72, 10, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).scale(1, 0.3, 1), '#06b6d4', 0, 0.31, -0.1);
  b.box(0.3, 0.1, 0.01, 0, 0.12, 0.155, '#9cc3dd');
  return b.build();
}

function pool(): THREE.BufferGeometry {
  const b = lot(new Builder(), '#e2e8f0');
  b.box(0.4, 0.2, 0.3, -0.25, 0.03, -0.25, '#f8fafc');
  b.box(0.7, 0.015, 0.36, 0.05, 0.03, 0.15, '#38bdf8'); // bassin
  for (let k = 1; k < 5; k++) b.box(0.7, 0.004, 0.008, 0.05, 0.047, 0.15 - 0.18 + k * 0.072, '#f8fafc');
  b.add(new THREE.ConeGeometry(0.07, 0.1, 8), '#f97316', 0.35, 0.08, -0.25); // parasol
  return b.build();
}

function sportsField(): THREE.BufferGeometry {
  const b = lot(new Builder(), '#4ade80');
  b.box(0.86, 0.006, 0.6, 0, 0.03, 0, '#22a35a');
  b.box(0.86, 0.004, 0.01, 0, 0.037, 0, '#f8fafc');
  b.box(0.01, 0.004, 0.6, 0, 0.037, 0, '#f8fafc');
  for (const x of [-0.42, 0.42]) { b.box(0.01, 0.06, 0.16, x, 0.03, 0, '#f8fafc'); b.box(0.01, 0.01, 0.16, x, 0.09, 0, '#f8fafc'); }
  return b.build();
}

function iceRink(): THREE.BufferGeometry {
  const b = lot(new Builder(), '#c9c4b8');
  b.box(0.76, 0.26, 0.6, 0, 0.03, -0.05, '#dbeafe');
  b.add(new THREE.CylinderGeometry(0.3, 0.3, 0.76, 12, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).scale(1, 0.35, 1), '#bae6fd', 0, 0.29, -0.05);
  b.box(0.2, 0.1, 0.01, 0, 0.1, 0.255, '#1d4ed8');
  return b.build();
}

function zoo(): THREE.BufferGeometry {
  const b = new Builder();
  b.box(2.9, 1.2, 1.9, 0, -1.2, 0, '#b3a994');
  b.box(2.96, 0.03, 1.96, 0, 0, 0, '#7fae5a');
  b.add(new THREE.CylinderGeometry(0.35, 0.35, 0.012, 16).scale(1.4, 1, 1), '#38bdf8', -0.8, 0.03, -0.4); // bassin
  for (let k = 0; k < 14; k++) b.tree(-1.3 + (k % 7) * 0.42, k < 7 ? -0.8 : 0.7, 0.9 + (k % 3) * 0.2, k % 2 ? '#3f7d3a' : '#5a9e40');
  b.box(0.6, 0.02, 0.8, 0.7, 0.03, -0.1, '#c9a96e'); // savane
  for (let k = 0; k < 3; k++) { b.box(0.06, 0.05, 0.12, 0.55 + k * 0.15, 0.05, -0.2 + k * 0.1, '#e0b25a'); b.box(0.015, 0.12, 0.015, 0.55 + k * 0.15, 0.08, -0.25 + k * 0.1, '#e0b25a'); } // girafes
  b.box(0.5, 0.18, 0.3, 0, 0.03, 0.75, '#8b6a4a'); // entrée
  b.gable(0.56, 0.1, 0.34, 0, 0.21, 0.75, '#3f6f3a');
  return b.build();
}

function aquarium(): THREE.BufferGeometry {
  const b = lot(new Builder(), '#cbd5e1');
  b.box(0.7, 0.26, 0.5, 0, 0.03, -0.1, '#e0f2fe');
  b.box(0.72, 0.16, 0.52, 0, 0.08, -0.1, '#0ea5e9');
  b.add(new THREE.SphereGeometry(0.2, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), '#7dd3fc', 0.15, 0.29, -0.1);
  b.add(new THREE.ConeGeometry(0.06, 0.16, 3).rotateZ(Math.PI / 2), '#f97316', -0.2, 0.36, -0.1); // poisson
  return b.build();
}

function beach(): THREE.BufferGeometry {
  const b = lot(new Builder(), '#f5e3a3');
  const colors = ['#ef4444', '#3b82f6', '#facc15', '#22c55e', '#ec4899'];
  for (let k = 0; k < 6; k++) {
    const x = -0.32 + (k % 3) * 0.32, z = -0.2 + Math.floor(k / 3) * 0.35;
    b.cyl(0.006, 0.12, x, 0.03, z, '#6b7280', 4);
    b.add(new THREE.ConeGeometry(0.09, 0.05, 8), colors[k % 5], x, 0.16, z);
    b.box(0.07, 0.006, 0.12, x + 0.07, 0.035, z, colors[(k + 2) % 5]);
  }
  b.box(0.14, 0.12, 0.1, 0.35, 0.03, 0.38, '#f8fafc'); // poste de secours
  return b.build();
}

function promenade(): THREE.BufferGeometry {
  const b = lot(new Builder(), '#e8dcc0');
  b.box(0.96, 0.02, 0.4, 0, 0.03, 0.2, '#c9a87a'); // planches
  for (let k = 0; k < 5; k++) { b.cyl(0.008, 0.2, -0.4 + k * 0.2, 0.03, 0.35, '#374151', 6); b.add(new THREE.SphereGeometry(0.02, 6, 4), '#fde68a', -0.4 + k * 0.2, 0.24, 0.35); } // lampadaires
  for (let k = 0; k < 3; k++) b.box(0.14, 0.03, 0.04, -0.3 + k * 0.3, 0.05, 0.1, '#7c5a3a'); // bancs
  for (let k = 0; k < 3; k++) b.tree(-0.35 + k * 0.35, -0.25, 1);
  return b.build();
}

function amusementPark(): THREE.BufferGeometry {
  const b = new Builder();
  b.box(2.9, 1.2, 2.9, 0, -1.2, 0, '#b3a994');
  b.box(2.96, 0.03, 2.96, 0, 0, 0, '#a3c47a');
  // Grande roue
  b.add(new THREE.TorusGeometry(0.55, 0.02, 6, 28), '#f8fafc', -0.7, 0.8, -0.8);
  for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; b.box(0.08, 0.06, 0.06, -0.7 + Math.cos(a) * 0.55, 0.8 + Math.sin(a) * 0.55, -0.8, ['#ef4444', '#3b82f6', '#facc15', '#22c55e'][k % 4]); }
  b.box(0.04, 0.8, 0.04, -0.85, 0.03, -0.8, '#9ca3af'); b.box(0.04, 0.8, 0.04, -0.55, 0.03, -0.8, '#9ca3af');
  // Montagnes russes
  for (let k = 0; k < 10; k++) { const x = 0.1 + k * 0.12, h = 0.2 + Math.abs(Math.sin(k * 0.8)) * 0.4; b.box(0.02, h, 0.02, x, 0.03, 0.2, '#e5e7eb'); b.box(0.13, 0.02, 0.06, x, 0.03 + h, 0.2, '#dc2626'); }
  // Carrousel et chapiteau
  b.cyl(0.25, 0.1, -0.6, 0.03, 0.6, '#fbbf24', 16); b.add(new THREE.ConeGeometry(0.28, 0.2, 16), '#ef4444', -0.6, 0.23, 0.6);
  b.add(new THREE.ConeGeometry(0.4, 0.35, 12), '#7c3aed', 0.7, 0.2, -0.8);
  b.box(0.6, 0.16, 0.2, 0.2, 0.03, 1.25, '#f97316'); // entrée
  return b.build();
}

function touristInfo(): THREE.BufferGeometry {
  const b = lot(new Builder(), '#d6d0c4');
  b.box(0.4, 0.2, 0.3, -0.1, 0.03, -0.1, '#f8fafc');
  b.box(0.42, 0.04, 0.32, -0.1, 0.23, -0.1, '#f59e0b');
  b.box(0.06, 0.3, 0.06, 0.3, 0.03, 0.25, '#f59e0b');
  b.box(0.16, 0.16, 0.02, 0.3, 0.3, 0.25, '#2563eb');
  b.box(0.03, 0.1, 0.025, 0.3, 0.33, 0.255, '#f8fafc'); // « i »
  return b.build();
}

export function createServiceModels(): Map<Service, THREE.BufferGeometry> {
  return new Map<Service, THREE.BufferGeometry>([
    [Service.PowerPlant, powerPlant()],
    [Service.WindTurbine, windTurbine()],
    [Service.WaterPump, waterPump()],
    [Service.Sewage, sewage()],
    [Service.Landfill, landfill()],
    [Service.Clinic, clinic()],
    [Service.School, school()],
    [Service.Police, police()],
    [Service.FireStation, fireStation()],
    [Service.Park, park()],
    [Service.MetroStation, metroStation()],
    [Service.Levee, levee()],
    [Service.WarningCenter, warningCenter()],
    [Service.NuclearPlant, nuclearPlant()],
    [Service.SolarFarm, solarFarm()],
    [Service.HydroDam, hydroDam()],
    [Service.Substation, substation()],
    [Service.Interconnect, interconnect()],
    [Service.WaterTreatment, waterTreatment()],
    [Service.WaterTower, waterTower()],
    [Service.Incinerator, incinerator()],
    [Service.Recycling, recycling()],
    [Service.Composting, composting()],
    [Service.LandfillSite, landfillSite()],
    [Service.BusDepot, depot('#22c55e', '#15803d')],
    [Service.TramDepot, depot('#f59e0b', '#b45309', true)],
    [Service.MetroDepot, depot('#c026d3', '#86198f', true)],
    [Service.TrainStation, trainStation()],
    [Service.FerryPier, ferryPier()],
    [Service.TaxiDepot, taxiDepot()],
    [Service.BikeStation, bikeStation()],
    [Service.Parking, parking()],
    [Service.Airport, airport()],
    [Service.Harbor, harbor()],
    [Service.Museum, museum()],
    [Service.Monument, monument()],
    [Service.Theater, theater()],
    [Service.Cinema, cinema()],
    [Service.ConcertHall, concertHall()],
    [Service.CongressCenter, congressCenter()],
    [Service.Stadium, stadium()],
    [Service.Arena, arena()],
    [Service.Gym, gym()],
    [Service.Pool, pool()],
    [Service.SportsField, sportsField()],
    [Service.IceRink, iceRink()],
    [Service.Zoo, zoo()],
    [Service.Aquarium, aquarium()],
    [Service.Beach, beach()],
    [Service.Promenade, promenade()],
    [Service.AmusementPark, amusementPark()],
    [Service.TouristInfo, touristInfo()],
  ]);
}
