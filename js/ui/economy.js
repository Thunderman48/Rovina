// The Economy panel (tap the resource counter on the top bar): where every bit of income comes from.
//  - Last round: the income event's parts (flat income by building type, what peasants gathered at each
//    building, souls from deaths on your graves, souls lost to decay)
//  - Next round (expected): the flat income now, gathering expected from the peasants on gather tasks,
//    and for the Undead how much of the bank would decay if nothing is spent
//  - Per building: what each income building pays, and who works it
// Mixed into Game.
import { RULES, FACTIONS, BUILDINGS, gatherSlotsOf } from '../data/units.js';
import { incomeParts, gatherRate, soulDecayOf, bdef } from '../sim/base.js';
import { icon } from './iconset.js';

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const EconomyUI = {
  openEconomy() {
    if (!this.state) return;
    let el = document.getElementById('economy');
    if (!el) {
      el = document.createElement('div');
      el.id = 'economy'; el.className = 'overlay';
      el.innerHTML = '<div class="card eco-card"><div class="help-head"><h2>Economy</h2><button class="ib" id="eco-close">✕</button></div><div class="help-body" id="eco-body"></div></div>';
      document.body.appendChild(el);
      el.querySelector('#eco-close').onclick = () => el.classList.add('hidden');
      el.addEventListener('pointerdown', e => { if (e.target === el) el.classList.add('hidden'); });
    }
    el.classList.remove('hidden');
    document.getElementById('eco-body').innerHTML = this.economyHTML();
  },
  // gold / souls expected from the peasants that are on gather tasks, per building (a full round each)
  expectedGather() {
    const s = this.state, me = this.me, out = new Map();
    for (const q of s.squads) {
      if (q.owner !== me || q.hp <= 0 || q.role !== 'builder' || !q.task || q.task.kind !== 'gather') continue;
      const b = s.buildings.find(x => x.id === q.task.bid);
      const rate = gatherRate(s, b);
      if (!rate) continue;
      const e = out.get(b.id) || { b, n: 0, amount: 0 };
      if (e.n >= gatherSlotsOf(b.type)) continue;
      e.n++; e.amount += Math.floor(RULES.ap / rate);
      out.set(b.id, e);
    }
    return [...out.values()];
  },
  economyHTML() {
    const s = this.state, me = this.me, fac = s.players[me].faction, eco = FACTIONS[fac].eco, R = eco.name;
    const souls = !!FACTIONS[fac].graves;
    const bname = t => BUILDINGS[t].name[fac];
    const row = (ic, label, v, sub = '') => `<div class="eco-row">${icon(ic, 16)}<span>${label}${sub ? `<small>${sub}</small>` : ''}</span><b class="${v < 0 ? 'neg' : 'pos'}">${v > 0 ? '+' : ''}${v}</b></div>`;
    const flatRows = (P, prefix = '') => [
      P.hq ? row('goal', prefix + bname('hq'), P.hq) : '',
      P.mine ? row('node', `${P.count.mine} ${bname('mine')}${P.count.mine > 1 ? 's' : ''}`, P.mine) : '',
      P.well ? row('souls', `${P.count.well} ${bname('well')}${P.count.well > 1 ? 's' : ''}`, P.well) : '',
      P.farm ? row('farm', `${P.count.farm} ${bname('farm')}${P.count.farm > 1 ? 's' : ''} (passive)`, P.farm) : '',
      P.other ? row('spawn', 'Other buildings', P.other) : '',
    ].join('');
    const bank = s.supply[me];
    let h = `<p class="eco-bank">${icon(eco.icon, 18)}<b>${bank}</b> ${R} banked`;
    if (souls) h += ` · souls above <b>${RULES.soulKeep}</b> decay ${Math.round(RULES.soulDecay * 100)} % of the excess at the end of each round`;
    h += '</p>';
    if (souls) {
      const pct = Math.min(100, bank / (RULES.soulKeep * 2) * 100), keep = 50;
      h += `<div class="eco-bar"><i style="width:${pct}%"></i><em style="left:${keep}%"></em></div>`;
    }
    // last round
    const L = this.lastIncome;
    h += '<h3>Last round</h3>';
    if (!L) h += '<p class="eco-none">No round played yet.</p>';
    else {
      const P = L.parts;
      h += flatRows(P);
      for (const [bid, v] of Object.entries(P.gathered || {})) {
        const b = s.buildings.find(x => x.id === bid);
        h += row('builder', `Peasants gathering at the ${b ? bname(b.type) : 'building'}`, v);
      }
      if (P.souls) h += row('souls', 'Souls from deaths on your graves', P.souls, `${P.soulPlaces} place${P.soulPlaces > 1 ? 's' : ''}; ${RULES.soulPerModel} a model, ${RULES.soulPerHero} a hero`);
      if (P.brutal) h += row('tierup', 'Brutal AI bonus', P.brutal);
      if (P.decay) h += row('souls', 'Decay (souls above the threshold)', -P.decay);
      const tot = L.amount + Object.values(P.gathered || {}).reduce((a, b) => a + b, 0) + (P.souls || 0) - (P.decay || 0);
      h += `<div class="eco-row tot"><span>Total</span><b>${tot >= 0 ? '+' : ''}${tot}</b></div>`;
    }
    // next round
    const N = incomeParts(s, me), flat = N.hq + N.mine + N.well + N.farm + N.other;
    h += '<h3>Next round (expected)</h3>' + flatRows(N);
    const g = this.expectedGather();
    for (const e of g) h += row('builder', `${e.n} peasant${e.n > 1 ? 's' : ''} gathering at the ${bname(e.b.type)}`, e.amount, `if they work all round (1 ${R.toLowerCase()} per ${gatherRate(s, e.b)} AP)`);
    if (souls) h += row('souls', 'Souls from deaths on your graves', 0, `depends on the fighting: ${RULES.soulPerModel} per model that falls on your graves (either side)`);
    const gsum = g.reduce((a, e) => a + e.amount, 0);
    const dec = souls ? soulDecayOf(bank + flat) : 0;
    if (dec) h += row('souls', 'Decay if nothing is spent', -dec);
    const nx = flat + gsum - dec;
    h += `<div class="eco-row tot"><span>Total (without deaths)</span><b>${nx >= 0 ? "+" : ""}${nx}</b></div>`;
    // per building
    const inc = s.buildings.filter(b => b.owner === me && b.hp > 0 && (bdef(b).income || b.type === 'hq' || gatherRate(s, b)));
    if (inc.length) {
      h += '<h3>Your income buildings</h3>';
      for (const b of inc) {
        const working = s.squads.filter(q => q.owner === me && q.hp > 0 && q.task?.kind === 'gather' && q.task.bid === b.id).length;
        const v = b.type === 'hq' ? N.hq / 1 : bdef(b).income || 0;
        const sub = b.build ? 'still being built: pays nothing yet' : gatherRate(s, b) ? `peasants working ${working} / ${gatherSlotsOf(b.type)}` : '';
        h += row(bdef(b).icon, esc(bname(b.type)), b.build ? 0 : v, sub);
      }
    }
    if (fac === 'kingdom') h += `<p class="eco-tip">Gold: the Keep and Mines pay every round; Farms pay a little and peasants gather more at Farms (1 per ${eco.gather.farm} AP) and Mines (1 per ${eco.gather.mine} AP). More peasants on Farms and Mines = more gold.</p>`;
    else h += `<p class="eco-tip">Souls: the Crypt and every Soul Well pay a steady income (take more resource sites to grow it). Deaths on your graves pay extra, but souls above ${RULES.soulKeep} decay, so spend them.</p>`;
    return h;
  },
};
