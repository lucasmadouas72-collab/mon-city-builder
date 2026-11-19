import { GAME_NAME } from '../config';
import { DIFFICULTY, defaultConfig, type Difficulty, type GameConfig, type GameMode } from '../game/config';
import { deleteSave, listSaves, type SaveMeta } from '../game/storage';
import { MAP_TYPES, type MapType } from '../sim/World';

const MAP_COLORS: Record<MapType, [string, string]> = {
  river: ['#6fad45', '#3f9fc4'], plain: ['#8cc152', '#a7d36b'], hills: ['#6fad45', '#58913a'], valley: ['#58913a', '#3f9fc4'],
  mountain: ['#948b7d', '#58913a'], coast: ['#8cc152', '#2f86ab'], island: ['#2f86ab', '#8cc152'], archipelago: ['#2f86ab', '#dccb94'],
  forest: ['#2f6b3a', '#447f3c'], desert: ['#e3c58c', '#b98a55'],
};

const SEASONS: Array<[number, string]> = [[2, 'Printemps'], [5, 'Été'], [8, 'Automne'], [11, 'Hiver']];

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const fmtMoney = (v: number) => (Number.isFinite(v) ? `${Math.round(v).toLocaleString('fr-FR')} €` : '∞');
const ago = (t: number) => new Date(t).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

export interface MenuActions {
  onNew: (c: GameConfig) => void;
  onLoad: (slot: string) => void;
  onImport: (data: string) => void;
}

function saveList(saves: SaveMeta[], withDelete: boolean): string {
  if (!saves.length) return '<p class="hint">Aucune partie sauvegardée.</p>';
  return `<div class="saves">${saves.map((s) => `
    <div class="save-row">
      <button class="save-load" data-load="${esc(s.slot)}">
        <b>${esc(s.city)}</b>${s.slot === 'auto' ? '<em>auto</em>' : ''}
        <small>${s.population.toLocaleString('fr-FR')} hab. · ${fmtMoney(s.money)} · ${esc(s.date)} · enregistrée le ${ago(s.savedAt)}</small>
      </button>
      ${withDelete ? `<button class="ghost danger" data-del="${esc(s.slot)}">Supprimer</button>` : ''}
    </div>`).join('')}</div>`;
}

/** Formulaire de nouvelle partie. */
function newGameForm(): string {
  const c = defaultConfig();
  return `
    <form class="newgame" id="newgame">
      <div class="fields">
        <label>Nom de la ville<input id="ng-city" maxlength="28" value="${esc(c.cityName)}" required></label>
        <label>Nom du maire<input id="ng-mayor" maxlength="28" placeholder="Vous"></label>
        <label>Région<input id="ng-region" maxlength="28" value="${esc(c.region)}"></label>
        <label>Graine de la carte<span class="seed"><input id="ng-seed" type="number" value="${c.seed}"><button type="button" class="ghost" id="ng-dice">Au hasard</button></span></label>
      </div>
      <h3>Carte</h3>
      <div class="maps">${MAP_TYPES.map(([id, name, desc]) => `
        <label class="map ${id === c.mapType ? 'on' : ''}" style="--a:${MAP_COLORS[id][0]};--b:${MAP_COLORS[id][1]}">
          <input type="radio" name="map" value="${id}" ${id === c.mapType ? 'checked' : ''}>
          <i></i><b>${name}</b><small>${desc}</small></label>`).join('')}</div>
      <div class="fields three">
        <label>Difficulté<select id="ng-diff">${(Object.keys(DIFFICULTY) as Difficulty[]).map((d) => `<option value="${d}" ${d === 'normal' ? 'selected' : ''}>${DIFFICULTY[d].name} · ${fmtMoney(DIFFICULTY[d].money)}</option>`).join('')}</select></label>
        <label>Mode de jeu<select id="ng-mode"><option value="classic">Classique</option><option value="sandbox">Bac à sable (argent illimité, tout débloqué)</option></select></label>
        <label>Saison de départ<select id="ng-season">${SEASONS.map(([m, n]) => `<option value="${m}" ${m === 2 ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      </div>
      <label class="check"><input type="checkbox" id="ng-weather" checked> Météo variable (pluie, neige, orages, canicules)</label>
      <div class="actions"><button type="button" class="ghost" data-back>Retour</button><button class="primary" type="submit">Fonder la ville</button></div>
    </form>`;
}

function readForm(root: HTMLElement): GameConfig {
  const v = (id: string) => (root.querySelector(`#${id}`) as HTMLInputElement).value;
  return {
    cityName: v('ng-city').trim() || 'Néoville',
    mayor: v('ng-mayor').trim(),
    region: v('ng-region').trim(),
    mapType: (root.querySelector('input[name="map"]:checked') as HTMLInputElement).value as MapType,
    seed: Math.floor(Number(v('ng-seed'))) || 1,
    difficulty: v('ng-diff') as Difficulty,
    mode: v('ng-mode') as GameMode,
    startMonth: Number(v('ng-season')),
    weather: (root.querySelector('#ng-weather') as HTMLInputElement).checked,
  };
}

function bindForm(root: HTMLElement, onSubmit: (c: GameConfig) => void): void {
  root.querySelector('#ng-dice')?.addEventListener('click', () => {
    (root.querySelector('#ng-seed') as HTMLInputElement).value = String(Math.floor(Math.random() * 99999) + 1);
  });
  root.querySelectorAll<HTMLInputElement>('input[name="map"]').forEach((r) => r.addEventListener('change', () => {
    root.querySelectorAll('.map').forEach((m) => m.classList.toggle('on', (m.querySelector('input') as HTMLInputElement).checked));
  }));
  root.querySelector('#newgame')?.addEventListener('submit', (e) => { e.preventDefault(); onSubmit(readForm(root)); });
}

function readFile(input: HTMLInputElement, cb: (text: string) => void): void {
  const f = input.files?.[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => cb(String(r.result));
  r.readAsText(f);
}

/** Écran d'accueil : continuer, nouvelle partie, charger, importer. */
export async function showMainMenu(root: HTMLElement, a: MenuActions): Promise<void> {
  const wrap = document.createElement('div');
  wrap.className = 'main-menu';
  root.appendChild(wrap);
  const home = async () => {
    const saves = await listSaves();
    wrap.innerHTML = `
      <div class="menu-card panel">
        <div class="menu-brand"><span class="logo big"></span><h1>${GAME_NAME}</h1></div>
        <p class="tagline">Bâtissez votre ville, du premier hameau à la mégapole.</p>
        <div class="menu-buttons">
          ${saves[0] ? `<button class="primary" data-load="${esc(saves[0].slot)}">Continuer · ${esc(saves[0].city)}</button>` : ''}
          <button class="${saves[0] ? 'ghost big' : 'primary'}" data-go="new">Nouvelle partie</button>
          <button class="ghost big" data-go="load" ${saves.length ? '' : 'disabled'}>Charger une partie</button>
          <label class="ghost big file">Importer un fichier de ville<input type="file" accept=".json,application/json" id="mm-import" hidden></label>
        </div>
      </div>`;
    wrap.querySelector('#mm-import')?.addEventListener('change', (e) => readFile(e.target as HTMLInputElement, a.onImport));
  };
  wrap.addEventListener('click', async (e) => {
    const t = e.target as HTMLElement;
    const load = t.closest<HTMLElement>('[data-load]');
    if (load) { wrap.remove(); a.onLoad(load.dataset.load!); return; }
    const del = t.closest<HTMLElement>('[data-del]');
    if (del) { await deleteSave(del.dataset.del!); wrap.querySelector('[data-go="load"]') ? home() : showLoad(); return; }
    if (t.closest('[data-back]')) { home(); return; }
    const go = t.closest<HTMLElement>('[data-go]')?.dataset.go;
    if (go === 'new') {
      wrap.innerHTML = `<div class="menu-card panel wide"><h2>Nouvelle ville</h2>${newGameForm()}</div>`;
      bindForm(wrap, (c) => { wrap.remove(); a.onNew(c); });
    }
    if (go === 'load') showLoad();
  });
  const showLoad = async () => {
    wrap.innerHTML = `<div class="menu-card panel wide"><h2>Charger une partie</h2>${saveList(await listSaves(), true)}<div class="actions"><button class="ghost" data-back>Retour</button></div></div>`;
  };
  await home();
}

export interface GameMenuActions {
  save: (name: string) => Promise<void>;
  load: (slot: string) => void;
  newGame: (c: GameConfig) => void;
  exportFile: () => void;
  importData: (data: string) => void;
  quit: () => void;
}

/** Menu en cours de partie. */
export class GameMenu {
  private wrap: HTMLElement;

  constructor(root: HTMLElement, private a: GameMenuActions, private cityName: () => string) {
    this.wrap = document.createElement('div');
    this.wrap.className = 'modal-wrap';
    this.wrap.hidden = true;
    root.appendChild(this.wrap);
    this.wrap.addEventListener('click', async (e) => {
      const t = e.target as HTMLElement;
      if (t === this.wrap || t.closest('[data-close]')) { this.toggle(false); return; }
      const act = t.closest<HTMLElement>('[data-act]')?.dataset.act;
      if (act === 'save') {
        const name = (this.wrap.querySelector('#gm-name') as HTMLInputElement).value.trim() || this.cityName();
        await a.save(name);
        this.home('Partie enregistrée.');
      }
      if (act === 'load') this.loadList();
      if (act === 'new') {
        this.wrap.innerHTML = `<div class="modal panel menu-modal wide"><h2>Nouvelle ville</h2>${newGameForm()}</div>`;
        bindForm(this.wrap, (c) => a.newGame(c));
      }
      if (act === 'export') a.exportFile();
      if (act === 'quit') a.quit();
      const load = t.closest<HTMLElement>('[data-load]');
      if (load) a.load(load.dataset.load!);
      const del = t.closest<HTMLElement>('[data-del]');
      if (del) { await deleteSave(del.dataset.del!); this.loadList(); }
      if (t.closest('[data-back]')) this.home();
    });
    window.addEventListener('keydown', (e) => { if (e.code === 'F10' || (e.code === 'Escape' && !this.wrap.hidden)) { e.preventDefault(); this.toggle(); } });
  }

  toggle(force?: boolean): void {
    this.wrap.hidden = !(force ?? this.wrap.hidden);
    if (!this.wrap.hidden) this.home();
  }

  private home(message = ''): void {
    this.wrap.innerHTML = `
      <div class="modal panel menu-modal">
        <header><h2>Menu</h2><button class="close" data-close aria-label="Fermer">×</button></header>
        ${message ? `<p class="ok-msg">${message}</p>` : ''}
        <h3>Sauvegarder</h3>
        <div class="save-line"><input id="gm-name" maxlength="40" value="${esc(this.cityName())}"><button class="primary" data-act="save">Enregistrer</button></div>
        <p class="hint">La partie est aussi enregistrée automatiquement toutes les 2 minutes (emplacement « auto »).</p>
        <div class="menu-buttons">
          <button class="ghost big" data-act="load">Charger une partie</button>
          <button class="ghost big" data-act="new">Nouvelle partie</button>
          <button class="ghost big" data-act="export">Exporter la ville (fichier)</button>
          <label class="ghost big file">Importer une ville<input type="file" accept=".json,application/json" id="gm-import" hidden></label>
          <button class="ghost big" data-act="quit">Menu principal</button>
        </div>
      </div>`;
    this.wrap.querySelector('#gm-import')?.addEventListener('change', (e) => readFile(e.target as HTMLInputElement, this.a.importData));
  }

  private async loadList(): Promise<void> {
    this.wrap.innerHTML = `<div class="modal panel menu-modal wide"><header><h2>Charger une partie</h2><button class="close" data-close aria-label="Fermer">×</button></header>
      ${saveList(await listSaves(), true)}<div class="actions"><button class="ghost" data-back>Retour</button></div></div>`;
  }
}
