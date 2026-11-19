import { diagnose, SEVERITY_NAMES, type Issue, type Severity } from '../sim/Advisor';
import type { Simulation } from '../sim/Simulation';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Panneau du conseiller : problèmes classés par gravité, causes probables et actions possibles. */
export class AdvisorPanel {
  private box: HTMLElement;
  private issues: Issue[] = [];
  private known = new Set<string>();
  /** Centrer la caméra sur une case et afficher une carte de données. */
  onShow?: (tile: number | undefined, view: string | undefined) => void;
  onBadge?: (worst: Severity, count: number) => void;

  constructor(root: HTMLElement, private sim: Simulation) {
    this.box = document.createElement('aside');
    this.box.className = 'advisor panel';
    this.box.hidden = true;
    root.appendChild(this.box);
    this.box.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-close]')) this.toggle(false);
      const show = t.closest<HTMLElement>('[data-show]');
      if (show) {
        const issue = this.issues.find((i) => i.id === show.dataset.show);
        if (issue) this.onShow?.(issue.tile, issue.view);
      }
    });
    setInterval(() => this.refresh(), 2500);
    sim.events.on('statsChanged', () => { if (!this.box.hidden) this.render(); });
  }

  toggle(force?: boolean): void {
    this.box.hidden = !(force ?? this.box.hidden);
    if (!this.box.hidden) this.refresh();
  }

  private refresh(): void {
    this.issues = diagnose(this.sim);
    const problems = this.issues.filter((i) => i.severity !== 'good');
    this.onBadge?.(this.issues[0]?.severity ?? 'good', problems.length);
    // Nouvelle alerte critique : notification cliquable
    for (const i of problems) {
      if ((i.severity === 'critical' || i.severity === 'serious') && !this.known.has(i.id)) {
        this.sim.events.emit('notify', { text: `Conseiller : ${i.title}`, kind: i.severity === 'critical' ? 'error' : 'warn', tile: i.tile });
      }
    }
    this.known = new Set(problems.filter((i) => i.severity === 'critical' || i.severity === 'serious').map((i) => i.id));
    if (!this.box.hidden) this.render();
  }

  private render(): void {
    this.box.innerHTML = `
      <div class="adv-head"><b>Conseiller municipal</b><button data-close aria-label="Fermer">×</button></div>
      <div class="adv-list">${this.issues.map((i) => `
        <article class="issue sev-${i.severity}">
          <div class="issue-top"><span class="sev"><i></i>${SEVERITY_NAMES[i.severity]}</span>
            ${i.tile !== undefined || i.view ? `<button class="ghost small" data-show="${i.id}">Voir sur la carte</button>` : ''}</div>
          <h4>${esc(i.title)}</h4>
          ${i.causes.length ? `<div class="lbl">Causes probables</div><ul>${i.causes.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}
          <div class="lbl">Que faire</div><ul class="acts">${i.actions.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>
        </article>`).join('')}</div>`;
  }
}
