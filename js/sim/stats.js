// Battle statistics for the results screen (and tools): one entry per round per side, built from the
// round's events and the state after it. Deterministic and part of the state, so online peers and the
// balance tool see the same numbers.
//   s.stats = { rounds: [{ r, p: [side0, side1] }], tech: [[{ id, r }], [{ id, r }]] }
// where each side is an array of numbers in STAT_KEYS order (compact: the state travels online every
// round); read them with statOf / statSeries.
// Per side each round (cumulative where noted):
//   income  : what came in this round (flat income + gathering + souls from deaths − decay)
//   bank    : resource banked at the end of the round
//   spent   : spent this round (start bank + income − end bank; refunds make it smaller, never below 0)
//   earned / spentTotal : cumulative income and spending
//   pop / squads : population and army squads alive (peasants and summons not in `squads`)
//   trained : cumulative squads trained (summons and revived heroes not counted)
//   lost / kills : cumulative own / enemy squads destroyed (summoned skeletons not counted)
//   models  : cumulative enemy models killed (any squad)
//   buildings : own finished buildings standing; built (cumulative finished); razed (cumulative enemy
//               buildings destroyed)
//   research : research finished (count)
//   dmgUnits / dmgBuildings : cumulative damage dealt to enemy squads / buildings (tower fire included)
//   reinforced : cumulative models bought back by reinforcing
import { armySize } from './base.js';

export const STAT_KEYS = ['income', 'bank', 'spent', 'earned', 'spentTotal', 'pop', 'squads', 'trained', 'lost', 'kills', 'models', 'buildings', 'built', 'razed', 'research', 'dmgUnits', 'dmgBuildings', 'reinforced'];
const IDX = Object.fromEntries(STAT_KEYS.map((k, i) => [k, i]));
// one value of side p in a round entry; the whole series of a key for side p
export const statOf = (entry, p, key) => entry.p[p][IDX[key]] ?? 0;
export const statSeries = (s, key, p) => (s.stats?.rounds || []).map(e => statOf(e, p, key));

// who owns each squad / building at the start of the round (dead squads still count afterwards)
export function statsOwners(s) {
  const m = new Map();
  for (const q of s.squads) m.set(q.id, { owner: q.owner, summon: !!q.ttl || q.role === 'summon' });
  for (const b of s.buildings || []) m.set(b.id, { owner: b.owner, building: true });
  return m;
}

export function recordStats(s, events, owners, bank0, round) {
  const st = s.stats || (s.stats = { rounds: [], tech: [[], []] });
  const prev = st.rounds.length ? st.rounds[st.rounds.length - 1] : null;
  const last = prev ? [0, 1].map(p => Object.fromEntries(STAT_KEYS.map(k => [k, statOf(prev, p, k)]))) : null;
  const own = id => owners.get(id);
  const side = [0, 1].map(p => ({
    income: 0, bank: s.supply[p], spent: 0,
    earned: last ? last[p].earned : 0, spentTotal: last ? last[p].spentTotal : 0,
    pop: armySize(s, p), squads: s.squads.filter(q => q.owner === p && q.hp > 0 && q.role !== 'builder' && q.role !== 'summon' && !q.ttl).length,
    trained: last ? last[p].trained : 0, lost: last ? last[p].lost : 0, kills: last ? last[p].kills : 0, models: last ? last[p].models : 0,
    buildings: (s.buildings || []).filter(b => b.owner === p && b.hp > 0 && !b.build).length,
    built: last ? last[p].built : 0, razed: last ? last[p].razed : 0,
    research: (s.tech && s.tech[p] || []).length,
    dmgUnits: last ? last[p].dmgUnits : 0, dmgBuildings: last ? last[p].dmgBuildings : 0, reinforced: last ? last[p].reinforced : 0,
  }));
  for (const e of events) {
    if (e.type === 'spawn') owners.set(e.id, { owner: e.owner, summon: !!e.summon || e.role === 'summon' });
    else if (e.type === 'revive') owners.set(e.id, { owner: e.owner });
  }
  for (const e of events) {
    switch (e.type) {
      case 'income': {
        const g = Object.values(e.parts?.gathered || {}).reduce((a, b) => a + b, 0);
        side[e.owner].income += e.amount + g + (e.parts?.souls || 0) - (e.parts?.decay || 0);
        break;
      }
      case 'spawn': if (!e.summon && e.role !== 'summon') side[e.owner].trained++; break;
      case 'down': {
        const o = own(e.id); if (!o || o.summon) break;
        side[o.owner].lost++; side[1 - o.owner].kills++;
        break;
      }
      case 'hit': {
        const src = own(e.src); if (!src || !(e.dmg > 0)) break;
        const dst = own(e.dst);
        if (dst && dst.owner === src.owner) break;   // never count own-side damage
        if (e.building) side[src.owner].dmgBuildings += e.dmg; else side[src.owner].dmgUnits += e.dmg;
        if (!e.building && e.lost > 0) side[src.owner].models += e.lost;
        break;
      }
      case 'built': side[e.owner].built++; break;
      case 'construct': if (e.done) side[e.owner].built++; break;
      case 'bdown': side[1 - e.owner].razed++; break;
      case 'researched': st.tech[e.owner].push({ id: e.tech, r: round }); break;
      case 'reinforce': side[e.owner].reinforced += e.models; break;
    }
  }
  for (const p of [0, 1]) {
    const S = side[p];
    S.spent = Math.max(0, bank0[p] + S.income - S.bank);
    S.earned += S.income; S.spentTotal += S.spent;
    S.dmgUnits = Math.round(S.dmgUnits); S.dmgBuildings = Math.round(S.dmgBuildings);
  }
  st.rounds.push({ r: round, p: side.map(S => STAT_KEYS.map(k => S[k])) });
}
