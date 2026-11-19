import './style.css';
import { GAME_NAME, MAP_SIZE } from './config';
import { CameraController } from './input/CameraController';
import { ToolManager } from './input/ToolManager';
import { SceneRenderer } from './render/SceneRenderer';
import { TrafficView } from './render/TrafficView';
import { DataView } from './render/DataView';
import { ServiceLayer } from './render/ServiceLayer';
import { TransitView } from './render/TransitView';
import { Atmosphere } from './render/Atmosphere';
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
const trafficView = new TrafficView(world, sim.traffic);
const dataView = new DataView(sim);
const services = new ServiceLayer(world, sim.utilities);
const transitView = new TransitView(world, sim.transit);
view.scene.add(trafficView.group, dataView.overlay.group, services.group, transitView.group);
tools.onDraft = (kind, tiles) => transitView.setDraft(kind, tiles);
const atmosphere = new Atmosphere(view, world);
view.scene.add(atmosphere.group);
sim.events.on('transitChanged', () => transitView.rebuild());
const hud = new Hud(document.getElementById('hud')!, sim, tools, dataView);
hud.focus = (x, z) => cam.focus(x, z);
tools.setTool('road');

sim.events.on('roadsChanged', () => {
  view.roads.rebuild();
  view.buildings.markChanged([]);
  services.rebuild();
  atmosphere.rebuildLamps();
});
sim.events.on('servicesChanged', () => { services.rebuild(); transitView.rebuild(); });
sim.events.on('firesChanged', () => services.refreshFires());
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
  trafficView.update();
  dataView.update(now / 1000);
  services.update(now / 1000);
  transitView.visible = dataView.mode === 'transport' || tools.tool === 'busline' || tools.tool === 'metroline' || tools.tool === 'busstop';
  atmosphere.update(sim.env, sim.monthIndex, Math.min(dt, 0.1), now / 1000);
  view.trees.setSeason(sim.env.season(sim.monthIndex));
  view.render(now / 1000);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
document.getElementById('loading')?.remove();

// Accès console pour le débogage
Object.assign(window, { game: { world, sim, view, cam, tools, trafficView, dataView, services, transitView, atmosphere } });
