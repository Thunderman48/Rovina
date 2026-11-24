// The Tech tree screen: the side's whole tree in columns by tier (1 / 2 / 3) and rows by where it is
// researched (the HQ, each tech building, the doctrines), with lines from every prerequisite.
// Node states: done, researching, queued, available, locked (with the reason), excluded (the other
// doctrine). Tap an available node to queue it at the building that researches it. Mixed into Game.
import { BUILDINGS, FACTIONS } from '../data/units.js';
import { techsOf, TECH } from '../data/tech.js';
import { icon } from './iconset.js';
import { sfx } from '../audio/sfx.js';

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const LANES = { kingdom: ['hq', 'forge', 'chapel', 'doctrine'], undead: ['hq', 'pit', 'sanctum', 'doctrine'] };

export const TechTreeUI = {
  openTechTree() {
    if (!this.state) return;
    let el = document.getElementById('techtree');
    if (!el) {
      el = document.createElement('div');
      el.id = 'techtree'; el.className = 'overlay';
      el.innerHTML = '<div class="card tt-card"><div class="help-head"><h2>Tech tree</h2><button class="ib" id="tt-close">✕</button></div><div class="tt-sub" id="tt-sub"></div><div class="tt-scroll"><div class="tt-grid" id="tt-grid"></div><svg class="tt-lines" id="tt-lines"></svg></div></div>';
      document.body.appendChild(el);
      el.querySelector('#tt-close').onclick = () => this.closeTechTree();
      el.addEventListener('pointerdown', e => { if (e.target === el) this.closeTechTree(); });
    }
    el.classList.remove('hidden');
    this.techOpen = true;
    this.renderTechTree();
  },
  closeTechTree() { document.getElementById('techtree')?.classList.add('hidden'); this.techOpen = false; },
  renderTechTree() {
    const el = document.getElementById('techtree');
    if (!el || el.classList.contains('hidden') || !this.state) return;
    const fac = this.faction(this.me), all = techsOf(fac), lanes = LANES[fac] || ['hq'];
    const laneOf = t => t.doctrine ? 'doctrine' : t.at;
    const laneName = l => l === 'doctrine' ? 'Doctrines · pick one of each pair' : l === 'hq' ? BUILDINGS.hq.name[fac] + ' · tiers and economy' : BUILDINGS[l].name[fac];
    el.querySelector('#tt-sub').innerHTML = `${esc(FACTIONS[fac].name)} · tap a research to queue it at its building · it is paid when it starts and the building does nothing else meanwhile`;
    let h = '<div class="tt-corner"></div>' + [1, 2, 3].map(t => `<div class="tt-col">Tier ${t}</div>`).join('');
    for (const l of lanes) {
      h += `<div class="tt-lane">${l === 'doctrine' ? '⚖' : icon(l === 'hq' ? 'goal' : BUILDINGS[l].icon, 16)}<span>${esc(laneName(l))}</span></div>`;
      for (const tier of [1, 2, 3]) {
        const items = all.filter(t => laneOf(t) === l && t.tier === tier);
        let cell = '';
        items.forEach((t, i) => {
          if (t.doctrine && i % 2 === 1) cell += '<div class="tt-or">or</div>';
          const k = this.techState(t);
          cell += `<button class="tt-node ${k.st}${t.hqTier ? ' tier' : ''}" data-tt="${t.id}" title="${esc(t.desc)}">${icon(t.icon, 16)}<b>${esc(t.name)}</b><small>${esc(k.st === 'done' ? '✓ Researched' : k.why)}</small></button>`;
        });
        h += `<div class="tt-cell">${cell}</div>`;
      }
    }
    const grid = el.querySelector('#tt-grid');
    grid.innerHTML = h;
    grid.querySelectorAll('[data-tt]').forEach(n => n.onclick = () => {
      const t = TECH[n.dataset.tt], k = this.techState(t);
      if (k.st !== 'ok') { this.toast(k.st === 'done' ? `${t.name}: already researched` : `${t.name}: ${k.why}`, k.st !== 'done'); return; }
      if (this.planner.queueTrain(k.at, 'tech:' + t.id)) { sfx('confirm'); this.toast(`Queued research: ${t.name} (${BUILDINGS[t.at].name[fac]})`); this.changed(); this.renderTechTree(); }
    });
    // prerequisite lines, drawn after layout
    requestAnimationFrame(() => {
      const svg = el.querySelector('#tt-lines'), box = grid.getBoundingClientRect();
      svg.setAttribute('width', grid.scrollWidth); svg.setAttribute('height', grid.scrollHeight);
      let lines = '';
      for (const t of all) for (const n of t.needs || []) {
        const a = grid.querySelector(`[data-tt="${n}"]`), b = grid.querySelector(`[data-tt="${t.id}"]`);
        if (!a || !b) continue;
        const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
        const x1 = ra.right - box.left, y1 = ra.top + ra.height / 2 - box.top, x2 = rb.left - box.left, y2 = rb.top + rb.height / 2 - box.top;
        const same = Math.abs(ra.left - rb.left) < 4;   // same column: a short elbow on the left
        const d = same ? `M${ra.left - box.left} ${y1} h-8 V${y2} h8` : `M${x1} ${y1} C${x1 + 24} ${y1} ${x2 - 24} ${y2} ${x2} ${y2}`;
        lines += `<path d="${d}" class="${b.classList.contains('done') ? 'done' : ''}"/>`;
      }
      svg.innerHTML = lines;
    });
  },
};
