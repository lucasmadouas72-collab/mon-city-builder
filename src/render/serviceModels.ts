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
  ]);
}
