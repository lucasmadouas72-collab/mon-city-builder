import { DISASTER_NAMES, type DisasterRecord } from '../sim/Disasters';
import type { Simulation } from '../sim/Simulation';

const fmt = (v: number) => `${Math.round(v).toLocaleString('fr-FR')} €`;

/** Alertes de catastrophe : annonce (évacuation possible), début, bilan. */
export class DisasterPanel {
  private wrap: HTMLElement;
  private resumeSpeed = 1;
  focus?: (tile: number) => void;

  constructor(root: HTMLElement, private sim: Simulation) {
    this.wrap = document.createElement('div');
    this.wrap.className = 'modal-wrap';
    this.wrap.hidden = true;
    root.appendChild(this.wrap);
    this.wrap.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      const act = t.closest<HTMLElement>('[data-act]');
      if (!act) return;
      const id = Number(act.dataset.id);
      const d = sim.disasters.list.find((x) => x.id === id);
      if (act.dataset.act === 'evacuate') sim.disasters.evacuate(id);
      if (act.dataset.act === 'show' && d) this.focus?.(d.tile);
      this.close();
    });
    sim.events.on('disaster', ({ id, phase }) => {
      const d = sim.disasters.list.find((x) => x.id === id);
      if (!d) return;
      if (phase === 'warning') this.warn(d);
      else if (phase === 'start' && d.status === 'active' && !d.warned) {
        sim.events.emit('notify', { text: `${DISASTER_NAMES[d.type]}${d.magnitude ? ` (magnitude ${d.magnitude})` : ''} !`, kind: 'error', tile: d.tile });
      } else if (phase === 'start' && d.warned) {
        sim.events.emit('notify', { text: `${DISASTER_NAMES[d.type]} en cours${d.evacuated ? ' : la zone a été évacuée' : ''}`, kind: 'error', tile: d.tile });
      } else if (phase === 'end') this.summary(d);
    });
  }

  private warn(d: DisasterRecord): void {
    this.resumeSpeed = this.sim.speedIndex || 1;
    this.sim.setSpeed(0);
    this.wrap.hidden = false;
    this.wrap.innerHTML = `<div class="modal panel disaster-modal">
      <div class="ms-kicker">Alerte du centre de surveillance</div>
      <h2>${DISASTER_NAMES[d.type]} annoncé(e)</h2>
      <p>Le phénomène est attendu d'ici <b>${d.countdown} jour(s)</b>. Évacuer la zone évite les victimes ; la préparation réduit aussi les dégâts.</p>
      <div class="actions"><button class="ghost" data-act="show" data-id="${d.id}">Voir la zone</button><button class="ghost" data-act="ignore" data-id="${d.id}">Ne rien faire</button><button class="primary" data-act="evacuate" data-id="${d.id}">Évacuer la zone</button></div>
    </div>`;
  }

  private summary(d: DisasterRecord): void {
    const parts = [
      d.damaged ? `${d.damaged} ${d.type === 'forestFire' ? 'case(s) de forêt touchée(s)' : 'bâtiment(s) touché(s)'}` : '',
      d.destroyed ? `${d.destroyed} détruit(s)` : '',
      d.casualties ? `${d.casualties} victime(s)` : d.evacuated ? 'aucune victime grâce à l’évacuation' : '',
      d.cost ? `dégâts estimés ${fmt(d.cost)}` : '',
      d.aid ? `aide régionale reçue ${fmt(d.aid)}` : '',
    ].filter(Boolean);
    this.sim.events.emit('notify', { text: `Fin : ${DISASTER_NAMES[d.type].toLowerCase()}. ${parts.join(', ') || 'Pas de dégâts.'}`, kind: 'info', tile: d.tile });
  }

  private close(): void {
    this.wrap.hidden = true;
    this.sim.setSpeed(this.resumeSpeed);
  }
}
