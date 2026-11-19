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
import { TrafficLights } from './render/TrafficLights';
import { Simulation } from './sim/Simulation';
import { World } from './sim/World';
import { UndoStack } from './sim/Undo';
import { applySave, parseSave, serialize, worldFromSave, type SaveFile } from './sim/save';
import { Hud } from './ui/Hud';
import * as roadGeometry from './sim/roadGeometry';
import { computeReach } from './sim/ServiceReach';
import { GameMenu, showMainMenu } from './ui/Menu';
import type { GameConfig } from './game/config';
import { readSave, setBoot, takeBoot, writeSave, type Boot } from './game/storage';

document.title = GAME_NAME;
const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

/** Recharge la page pour démarrer une autre partie (évite de garder deux jeux en mémoire). */
function restartWith(b: Boot): void {
  if (setBoot(b)) location.reload();
}

/** Lance une partie : nouvelle (config) ou chargée (sauvegarde). */
function startGame(config: GameConfig, file?: SaveFile): void {
  const container = document.getElementById('game')!;
  const world = file ? worldFromSave(file) : new World(config.seed, config.mapType);
  const sim = new Simulation(world);
  sim.applyConfig(config);
  if (file) applySave(sim, file);
  document.title = `${config.cityName} · ${GAME_NAME}`;

  const view = new SceneRenderer(container, world);
  const cam = new CameraController(view.camera, view.renderer.domElement, MAP_SIZE);
  if (file?.camera) {
    cam.controls.target.set(...file.camera.target);
    view.camera.position.set(...file.camera.position);
    cam.controls.update();
  }
  const tools = new ToolManager(sim, view, cam, view.renderer.domElement);
  const undo = new UndoStack(sim);
  tools.undo = undo;
  const trafficView = new TrafficView(world, sim.traffic);
  const dataView = new DataView(sim);
  const services = new ServiceLayer(world, sim.utilities);
  const transitView = new TransitView(world, sim.transit);
  const atmosphere = new Atmosphere(view, world);
  const lights = new TrafficLights(world, sim.traffic);
  view.scene.add(trafficView.group, dataView.overlay.group, services.group, transitView.group, atmosphere.group, lights.group);
  tools.onDraft = (kind, tiles) => transitView.setDraft(kind, tiles);

  const hud = new Hud(document.getElementById('hud')!, sim, tools, dataView);
  hud.focus = (x, z) => cam.focus(x, z);
  hud.bindUndo(undo);
  // Caméra : F = centrer sur la case survolée, V = vue de dessus, Retour arrière = vue précédente,
  // Alt + 1 à 4 = mémoriser une position, Maj + 1 à 4 = la rappeler
  window.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    if (e.code === 'KeyF' && tools.hovered) cam.focus(tools.hovered.i + 0.5, tools.hovered.j + 0.5);
    if (e.code === 'KeyV' && !e.ctrlKey) cam.toggleTopView();
    if (e.code === 'Backspace') { e.preventDefault(); cam.back(); }
    const m = /^Digit([1-4])$/.exec(e.code);
    if (m && e.altKey) { e.preventDefault(); cam.savePosition(Number(m[1]) - 1); sim.events.emit('notify', { text: `Position de caméra ${m[1]} mémorisée (Maj + ${m[1]} pour y revenir)`, kind: 'info' }); }
    if (m && e.shiftKey && !cam.recallPosition(Number(m[1]) - 1)) sim.events.emit('notify', { text: `Aucune position ${m[1]} : mémorisez-la avec Alt + ${m[1]}`, kind: 'warn' });
  });
  tools.setTool(file ? 'select' : 'road');

  // ----- Sauvegardes -----
  const cameraState = () => ({
    target: cam.controls.target.toArray() as [number, number, number],
    position: view.camera.position.toArray() as [number, number, number],
  });
  const save = async (slot: string) => {
    const d = sim.date;
    await writeSave({
      slot, city: slot === 'auto' ? config.cityName : slot, population: sim.stats.population, money: sim.money,
      date: `${d.day} ${MONTHS[d.month]} an ${d.year}`, savedAt: Date.now(),
    }, serialize(sim, config, cameraState()));
  };
  const menu = new GameMenu(document.getElementById('hud')!, {
    save: async (name) => { await save(name); sim.events.emit('notify', { text: `Partie « ${name} » enregistrée`, kind: 'info' }); },
    load: (slot) => restartWith({ type: 'load', slot }),
    newGame: (c) => restartWith({ type: 'new', config: c }),
    importData: (data) => {
      try { parseSave(data); restartWith({ type: 'data', data }); } catch (e) { sim.events.emit('notify', { text: (e as Error).message, kind: 'error' }); }
    },
    exportFile: () => {
      const data = serialize(sim, config, cameraState());
      const name = `${config.cityName.replace(/[^\p{L}\p{N}_-]+/gu, '_')}.neoville.json`;
      try {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      } catch { /* le téléchargement peut être bloqué */ }
      navigator.clipboard?.writeText(data).then(
        () => sim.events.emit('notify', { text: 'Ville exportée (fichier et presse-papiers)', kind: 'info' }),
        () => sim.events.emit('notify', { text: `Ville exportée dans le fichier ${name}`, kind: 'info' }),
      );
    },
    quit: async () => { await save('auto'); location.reload(); },
  }, () => config.cityName);
  hud.onMenu = () => menu.toggle();
  setInterval(() => { if (sim.speed > 0) save('auto'); }, 120_000);
  document.addEventListener('visibilitychange', () => { if (document.hidden) save('auto'); });

  // ----- Réactions aux changements de la simulation -----
  let terrainDirty = false;
  sim.events.on('terrainChanged', () => (terrainDirty = true));
  sim.events.on('transitChanged', () => transitView.rebuild());
  sim.events.on('roadsChanged', () => {
    view.roads.rebuild();
    view.buildings.markChanged([]);
    services.rebuild();
    atmosphere.rebuildLamps();
    lights.rebuild();
  });
  sim.events.on('servicesChanged', () => { services.rebuild(); transitView.rebuild(); });
  sim.events.on('firesChanged', () => services.refreshFires());
  sim.events.on('zonesChanged', () => view.refreshZones(world));
  sim.events.on('buildingsChanged', ({ tiles }) => {
    view.buildings.markChanged(tiles);
    view.refreshZones(world);
  });
  sim.events.on('treesChanged', () => view.trees.rebuild());

  // ----- Boucle principale -----
  let last = performance.now();
  let lastTerrain = 0;
  function frame(now: number) {
    const dt = (now - last) / 1000;
    last = now;
    sim.update(dt);
    cam.update(dt);
    if (terrainDirty && now - lastTerrain > 120) {
      terrainDirty = false;
      lastTerrain = now;
      view.rebuildTerrain(world);
      transitView.rebuild();
    }
    trafficView.update();
    lights.update();
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
  if (!file) sim.events.emit('notify', { text: `Bienvenue à ${config.cityName} ! Commencez par tracer une route.`, kind: 'info' });

  // Accès console pour le débogage
  Object.assign(window, { game: { world, sim, view, cam, tools, trafficView, dataView, services, transitView, atmosphere, undo }, __geo: roadGeometry, __reach: computeReach });
}

async function loadAndStart(data: string | null): Promise<boolean> {
  if (!data) return false;
  try {
    const file = parseSave(data);
    startGame(file.config, file);
    return true;
  } catch (e) {
    console.error(e);
    return false;
  }
}

async function boot(): Promise<void> {
  const b = takeBoot();
  if (b?.type === 'new') return startGame(b.config);
  if (b?.type === 'load' && (await loadAndStart(await readSave(b.slot)))) return;
  if (b?.type === 'data' && (await loadAndStart(b.data))) return;
  document.getElementById('loading')?.remove();
  await showMainMenu(document.body, {
    onNew: (c) => startGame(c),
    onLoad: async (slot) => { if (!(await loadAndStart(await readSave(slot)))) location.reload(); },
    onImport: async (data) => { if (!(await loadAndStart(data))) alertError(); },
  });
}

function alertError(): void {
  const el = document.createElement('div');
  el.className = 'toast k-error';
  el.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:40';
  el.textContent = "Ce fichier n'est pas une sauvegarde valide";
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

boot();
