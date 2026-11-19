import './style.css';
import { GAME_NAME, MAP_SIZE } from './config';
import { CameraController } from './input/CameraController';
import { ToolManager } from './input/ToolManager';
import { SceneRenderer } from './render/SceneRenderer';
import { Simulation } from './sim/Simulation';
import { World } from './sim/World';
import { Hud } from './ui/Hud';

document.title = GAME_NAME;

const container = document.getElementById('game')!;
const world = new World(1337);
const sim = new Simulation(world);
const view = new SceneRenderer(container, world);
const cam = new CameraController(view.camera, view.renderer.domElement, MAP_SIZE);
const tools = new ToolManager(sim, view, cam, view.renderer.domElement);
new Hud(document.getElementById('hud')!, sim, tools);
tools.setTool('road');

sim.events.on('roadsChanged', () => {
  view.roads.rebuild();
  view.buildings.markChanged([]);
});
sim.events.on('zonesChanged', () => view.refreshZones(world));
sim.events.on('buildingsChanged', ({ tiles }) => {
  view.buildings.markChanged(tiles);
  view.refreshZones(world);
});
sim.events.on('treesChanged', () => view.trees.rebuild());

// Boucle principale : simulation à pas fixe, rendu à chaque image
let last = performance.now();
function frame(now: number) {
  const dt = (now - last) / 1000;
  last = now;
  sim.update(dt);
  cam.update(dt);
  view.render(now / 1000);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
document.getElementById('loading')?.remove();

// Accès console pour le débogage
Object.assign(window, { game: { world, sim, view, cam, tools } });
