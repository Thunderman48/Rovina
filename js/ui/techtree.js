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
      el.innerHTML = '<div class="card tt-card"><div class="help-head"><h2>Tech tree</h2><button class="ib" id="tt-close">✕</button></div><div class="tt-sub" id="tt-sub"></div><div class="tt-body"><div class="tt-scroll"><div class="tt-grid" id="tt-grid"></div><svg class="tt-lines" id="tt-lines"></svg></div><div class="tt-detail" id="tt-detail"></div></div></div>';
      document.body.appendChild(el);
      el.querySelector('#tt-close').onclick = () => this.closeTechTree();
      el.addEventListener('pointerdown', e => { if (e.target === el) this.closeTechTree(); });
    }
    el.classList.remove('hidden');
    this.techOpen = true;
    this.renderTechTree();
  },
  renderTechDetail(fac) {
    const box = document.getElementById('tt-detail');
    const t = this.ttSel && TECH[this.ttSel];
    if (!t || t.faction !== fac) { box.innerHTML = '<p class="tt-hint">Tap a research to see what it does.</p>'; box.classList.remove('on'); return; }
    const k = this.techState(t), at = t.at === 'hq' ? BUILDINGS.hq.name[fac] : BUILDINGS[t.at].name[fac];
    const need = (t.needs || []).map(id => `${TECH[id] && this.techState(TECH[id]).st === 'done' ? '✓' : '✗'} ${esc(TECH[id]?.name || id)}`).concat(t.needsAny ? [`one of: ${t.needsAny.map(id => esc(TECH[id]?.name || id)).join(' / ')}`] : []);
    const other = t.doctrine ? Object.values(TECH).find(o => o.faction === fac && o.doctrine === t.doctrine && o.id !== t.id) : null;
    const can = k.st === 'ok';
    box.classList.add('on');
    box.innerHTML = `<div class="tt-dh">${icon(t.icon, 22)}<div><b>${esc(t.name)}</b><small>${esc(at)} · tier ${t.tier}${t.doctrine ? ' · doctrine' : ''}</small></div><button class="ib" data-dx="close">✕</button></div>
      <p class="tt-desc">${esc(t.desc)}</p>
      <div class="tt-facts"><span>${icon(FACTIONS[fac].eco.icon, 14)} ${t.cost}</span><span>⏱ ${t.rounds} round${t.rounds > 1 ? 's' : ''}</span></div>
      ${need.length ? `<div class="tt-needs">Needs: ${need.join(', ')}</div>` : ''}
      ${other ? `<div class="tt-needs">Doctrine pair: picking this rules out <b>${esc(other.name)}</b> (${esc(other.chip || '')}) for the rest of the game.</div>` : ''}
      <button class="ready tt-go" data-dx="go" ${can ? '' : 'disabled'}>${k.st === 'done' ? '✓ Researched' : can ? `Research at the ${esc(at)}` : esc(k.why)}</button>`;
    box.querySelector('[data-dx="close"]').onclick = () => { this.ttSel = null; this.renderTechTree(); };
    box.querySelector('[data-dx="go"]').onclick = () => {
      if (!can) return;
      if (this.planner.queueTrain(k.at, 'tech:' + t.id)) { sfx('confirm'); this.toast(`Queued research: ${t.name} (${at})`); this.changed(); this.renderTechTree(); }
    };
  },
  closeTechTree() { document.getElementById('techtree')?.classList.add('hidden'); this.techOpen = false; },
  renderTechTree() {
    const el = document.getElementById('techtree');
    if (!el || el.classList.contains('hidden') || !this.state) return;
    const fac = this.faction(this.me), all = techsOf(fac), lanes = LANES[fac] || ['hq'];
    const laneOf = t => t.doctrine ? 'doctrine' : t.at;
    const laneName = l => l === 'doctrine' ? 'Doctrines · pick one of each pair' : l === 'hq' ? BUILDINGS.hq.name[fac] + ' · tiers and economy' : BUILDINGS[l].name[fac];
    el.querySelector('#tt-sub').innerHTML = `${esc(FACTIONS[fac].name)} · tap a research to see what it does and queue it · it is paid when it starts and the building does nothing else meanwhile`;
    let h = '<div class="tt-corner"></div>' + [1, 2, 3].map(t => `<div class="tt-col">Tier ${t}</div>`).join('');
    for (const l of lanes) {
      h += `<div class="tt-lane">${l === 'doctrine' ? '⚖' : icon(l === 'hq' ? 'goal' : BUILDINGS[l].icon, 16)}<span>${esc(laneName(l))}</span></div>`;
      for (const tier of [1, 2, 3]) {
        const items = all.filter(t => laneOf(t) === l && t.tier === tier);
        let cell = '';
        items.forEach((t, i) => {
          if (t.doctrine && i % 2 === 1) cell += '<div class="tt-or">or</div>';
          const k = this.techState(t);
          cell += `<button class="tt-node ${k.st}${t.hqTier ? ' tier' : ''}" data-tt="${t.id}" title="${esc(t.desc)}">${icon(t.icon, 16)}<b>${esc(t.name)}</b>${t.chip ? `<i class="tt-chip">${esc(t.chip)}</i>` : ''}<small>${esc(k.st === 'done' ? '✓ Researched' : k.why)}</small></button>`;
        });
        h += `<div class="tt-cell">${cell}</div>`;
      }
    }
    const grid = el.querySelector('#tt-grid');
    grid.innerHTML = h;
    // tapping a node selects it: the detail panel shows what it does, and queues it from there
    grid.querySelectorAll('[data-tt]').forEach(n => n.onclick = () => { this.ttSel = n.dataset.tt; this.renderTechTree(); });
    if (this.ttSel) grid.querySelector(`[data-tt="${this.ttSel}"]`)?.classList.add('sel');
    this.renderTechDetail(fac);
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
