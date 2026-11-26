// The results screen after a battle (StarCraft / Age of Empires score screens): who won, a summary table
// for both sides, and graphs per round (economy, units, kills, buildings, research, damage dealt) drawn
// as small inline SVG line charts. The numbers come from s.stats (js/sim/stats.js), so online players see
// the same screen. Mixed into Game.
import { FACTIONS, BUILDINGS } from '../data/units.js';
import { TECH } from '../data/tech.js';
import { statOf, statSeries } from '../sim/stats.js';
import { icon } from './iconset.js';

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// two sides: categorical slots 1 and 2 of the dataviz palette (dark steps), validated on the card surface
const COLOR = { me: '#338ced', them: '#e76624' };
const fmt = v => v >= 10000 ? (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(Math.round(v));

// tabs: each shows one or two charts (a chart = one measure, both sides, one axis)
const TABS = [
  { id: 'eco', name: 'Economy', charts: [['income', 'Income a round'], ['earned', 'Total earned']] },
  { id: 'units', name: 'Units', charts: [['pop', 'Population'], ['squads', 'Army squads']] },
  { id: 'kills', name: 'Kills', charts: [['kills', 'Enemy squads killed'], ['models', 'Enemy models killed']] },
  { id: 'bld', name: 'Buildings', charts: [['buildings', 'Buildings standing'], ['razed', 'Enemy buildings destroyed']] },
  { id: 'res', name: 'Research', charts: [['research', 'Research done']] },
  { id: 'dmg', name: 'Damage', charts: [['dmgUnits', 'Damage dealt to squads'], ['dmgBuildings', 'Damage dealt to buildings']] },
];

export const ResultsUI = {
  // the two sides as seen from this player: [me, them] with label and colour
  resultSides() {
    const s = this.state, me = this.me, them = 1 - me;
    const fname = p => FACTIONS[s.players[p].faction].name;
    const theirLabel = this.match === 'ai' ? `AI${this.memory?.personality?.name ? ' · ' + this.memory.personality.name : ''}` : 'Opponent';
    return [
      { p: me, label: 'You', fac: fname(me), color: COLOR.me },
      { p: them, label: theirLabel, fac: fname(them), color: COLOR.them },
    ];
  },
  openResults(fresh = false) {
    if (!this.state?.stats) return;
    let el = document.getElementById('results');
    if (!el) {
      el = document.createElement('div');
      el.id = 'results'; el.className = 'overlay';
      document.body.appendChild(el);
    }
    if (fresh || !this.resTab) this.resTab = 'eco';
    el.classList.remove('hidden');
    el.innerHTML = this.resultsHTML();
    el.querySelector('#res-close').onclick = () => this.closeResults();
    el.querySelector('#res-view').onclick = () => this.closeResults();
    el.querySelector('#res-again').onclick = () => location.reload();
    el.querySelectorAll('[data-rtab]').forEach(b => b.onclick = () => { this.resTab = b.dataset.rtab; this.openResults(); });
    this.drawResultCharts(el);
    // the battle is over: the Results button takes the Tech tree button's place (room on phones)
    document.getElementById('b-res')?.classList.remove('hidden');
    if (this.state.winner !== null) document.getElementById('b-tech')?.classList.add('hidden');
  },
  closeResults() { document.getElementById('results')?.classList.add('hidden'); },

  resultsHTML() {
    const s = this.state, st = s.stats, W = s.winner, me = this.me;
    const sides = this.resultSides();
    const title = W === me ? 'Victory' : W === -1 ? 'Draw' : W === null ? 'Battle so far' : 'Defeat';
    const enemyHq = BUILDINGS.hq.name[s.players[1 - me].faction], myHq = BUILDINGS.hq.name[s.players[me].faction];
    const why = W === -1 ? 'Both HQs fell in the same round.' : W === me ? `The enemy ${enemyHq} has fallen.` : W === null ? '' : `Your ${myHq} has fallen.`;
    const last = st.rounds[st.rounds.length - 1];
    const v = (side, k) => last ? statOf(last, side.p, k) : 0;
    const peak = side => Math.max(0, ...statSeries(s, 'pop', side.p));
    // summary rows: [label, value of a side, higher is better?]
    const rows = [
      ['Resources earned', sd => v(sd, 'earned'), true],
      ['Resources spent', sd => v(sd, 'spentTotal'), true],
      ['Squads trained', sd => v(sd, 'trained'), true],
      ['Squads lost', sd => v(sd, 'lost'), false],
      ['Enemy squads killed', sd => v(sd, 'kills'), true],
      ['Enemy models killed', sd => v(sd, 'models'), true],
      ['Highest population', sd => peak(sd), true],
      ['Buildings finished', sd => v(sd, 'built'), true],
      ['Enemy buildings destroyed', sd => v(sd, 'razed'), true],
      ['Research done', sd => v(sd, 'research'), true],
      ['Damage to squads', sd => v(sd, 'dmgUnits'), true],
      ['Damage to buildings', sd => v(sd, 'dmgBuildings'), true],
    ];
    const head = sides.map(sd => `<th><span class="res-key" style="background:${sd.color}"></span>${esc(sd.label)}<small>${esc(sd.fac)}</small></th>`).join('');
    const body = rows.map(([label, f, up]) => {
      const a = f(sides[0]), b = f(sides[1]);
      const best = a === b ? -1 : (a > b) === up ? 0 : 1;
      return `<tr><td>${label}</td>${[a, b].map((x, i) => `<td class="${i === best ? 'best' : ''}">${fmt(x)}</td>`).join('')}</tr>`;
    }).join('');
    const tab = TABS.find(t => t.id === this.resTab) || TABS[0];
    const legend = `<div class="res-legend">${sides.map(sd => `<span><i style="background:${sd.color}"></i>${esc(sd.label)} · ${esc(sd.fac)}</span>`).join('')}</div>`;
    let extra = '';
    if (tab.id === 'res') {
      const items = sides.map(sd => `<div class="res-tl"><h4><span class="res-key" style="background:${sd.color}"></span>${esc(sd.label)}</h4>${(st.tech[sd.p] || []).map(t => { const T = TECH[t.id]; return T ? `<div class="res-tli"><b>R${t.r}</b>${icon(T.icon, 14)}${esc(T.name)}</div>` : ''; }).join('') || '<div class="res-tli none">No research</div>'}</div>`).join('');
      extra = `<div class="res-tls">${items}</div>`;
    }
    return `<div class="card res-card">
      <div class="help-head"><h2>${title}</h2><button class="ib" id="res-close" title="Close">✕</button></div>
      <p class="res-why">${esc(why)} ${st.rounds.length} round${st.rounds.length === 1 ? '' : 's'}${this.match === 'ai' ? ` · AI ${esc(String(this.aiLevel || '').replace(/^./, c => c.toUpperCase()))}` : ''}</p>
      <div class="res-body">
        <table class="res-sum"><thead><tr><th></th>${head}</tr></thead><tbody>${body}</tbody></table>
        <div class="res-tabs">${TABS.map(t => `<button class="chip${t.id === tab.id ? ' on' : ''}" data-rtab="${t.id}">${t.name}</button>`).join('')}</div>
        ${legend}
        ${tab.charts.map(([key, name]) => `<div class="res-chart" data-key="${key}"><div class="res-ct">${name}</div><div class="res-plot"></div></div>`).join('')}
        ${extra}
      </div>
      <div class="res-foot"><button class="chip" id="res-view">View the battlefield</button><button class="ready" id="res-again">Play again</button></div>
    </div>`;
  },

  // line charts: x = round, y = value; both sides on one axis; a crosshair + readout on hover / tap
  drawResultCharts(el) {
    const s = this.state, rounds = s.stats.rounds.map(e => e.r), sides = this.resultSides();
    for (const box of el.querySelectorAll('.res-chart')) {
      const key = box.dataset.key, plot = box.querySelector('.res-plot');
      const series = sides.map(sd => ({ ...sd, v: statSeries(s, key, sd.p) }));
      const W = Math.max(260, plot.clientWidth || 520), H = 170, L = 44, R = 14, T = 10, B = 24;
      const n = rounds.length, maxV = Math.max(1, ...series.flatMap(x => x.v));
      // a round y scale: 1, 2, 2.5, 5 x 10^k
      const step = (() => { const raw = maxV / 4, m = Math.pow(10, Math.floor(Math.log10(raw))); return [1, 2, 2.5, 5, 10].map(k => k * m).find(k => k >= raw); })();
      const top = step * Math.ceil(maxV / step);
      const X = i => L + (n <= 1 ? (W - L - R) / 2 : i / (n - 1) * (W - L - R)), Y = val => T + (1 - val / top) * (H - T - B);
      let svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(box.querySelector('.res-ct').textContent)} by round">`;
      for (let y = 0; y <= top + 1e-9; y += step) svg += `<line x1="${L}" x2="${W - R}" y1="${Y(y)}" y2="${Y(y)}" class="res-grid"/><text x="${L - 6}" y="${Y(y) + 4}" class="res-ax" text-anchor="end">${fmt(y)}</text>`;
      const ticks = Math.min(6, n);
      for (let k = 0; k < ticks; k++) { const i = ticks === 1 ? 0 : Math.round(k * (n - 1) / (ticks - 1)); svg += `<text x="${X(i)}" y="${H - 6}" class="res-ax" text-anchor="middle">${rounds[i]}</text>`; }
      for (const sr of series) {
        const d = sr.v.map((val, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(val).toFixed(1)}`).join('');
        svg += `<path d="${d}" fill="none" stroke="${sr.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
      }
      svg += `<line class="res-cross" x1="0" x2="0" y1="${T}" y2="${H - B}" visibility="hidden"/>`;
      for (const sr of series) svg += `<circle class="res-dot" r="4" fill="${sr.color}" stroke="#1b1916" stroke-width="2" visibility="hidden"/>`;
      svg += `<rect x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent" class="res-hit"/></svg><div class="res-tip hidden"></div>`;
      plot.innerHTML = svg;
      const hit = plot.querySelector('.res-hit'), cross = plot.querySelector('.res-cross'), dots = plot.querySelectorAll('.res-dot'), tip = plot.querySelector('.res-tip');
      const show = ev => {
        const r = hit.getBoundingClientRect(), fx = (ev.clientX - r.left) / Math.max(1, r.width);
        const i = Math.max(0, Math.min(n - 1, Math.round(fx * (n - 1))));
        cross.setAttribute('x1', X(i)); cross.setAttribute('x2', X(i)); cross.setAttribute('visibility', 'visible');
        series.forEach((sr, k) => { dots[k].setAttribute('cx', X(i)); dots[k].setAttribute('cy', Y(sr.v[i])); dots[k].setAttribute('visibility', 'visible'); });
        tip.innerHTML = `<b>Round ${rounds[i]}</b>${series.map(sr => `<span><i style="background:${sr.color}"></i>${esc(sr.label)} ${fmt(sr.v[i])}</span>`).join('')}`;
        tip.classList.remove('hidden');
        const px = X(i) / W * plot.clientWidth;
        tip.style.left = Math.max(0, Math.min(plot.clientWidth - tip.offsetWidth, px - tip.offsetWidth / 2)) + 'px';
      };
      const hide = () => { cross.setAttribute('visibility', 'hidden'); dots.forEach(d => d.setAttribute('visibility', 'hidden')); tip.classList.add('hidden'); };
      hit.addEventListener('pointermove', show); hit.addEventListener('pointerdown', show); hit.addEventListener('pointerleave', hide);
    }
  },
};
