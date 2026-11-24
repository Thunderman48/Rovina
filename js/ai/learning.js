// Learning from combat outcomes (adaptive game AI, as in dynamic scripting: weights move with results).
// The paper value of a unit (combat.js) misses things such as swings hitting every squad in their arc, a
// slow squad never reaching its target, or a squad dying before it lands a blow. So every round the AI
// looks at what really happened since the last one: HP its squads lost (by role), and HP the enemy
// squads it watched lost, credited to its squads near them by their damage. Each role's trade ratio
// (dealt / taken, with a neutral prior) scales its value when the economy picks what to train.
import { squadDpr } from './combat.js';
import { defOf } from '../sim/state.js';
import { isShooter } from '../data/units.js';
import { dist } from '../sim/geom.js';

const PRIOR = 150;   // HP of neutral evidence each role starts with

export function learn(K, mem) {
  const L = mem.learn || (mem.learn = { stat: {}, own: {}, foe: {} });
  const stat = r => L.stat[r] || (L.stat[r] = { dealt: 0, taken: 0 });
  const alive = new Map(K.s.squads.filter(q => q.hp > 0).map(q => [q.id, q]));
  // own losses
  for (const [id, was] of Object.entries(L.own)) {
    const q = alive.get(id);
    stat(was.role).taken += Math.max(0, was.hp - (q ? q.hp : 0));
  }
  // enemy losses, credited to own squads that were close enough to have caused them
  for (const [id, was] of Object.entries(L.foe)) {
    const e = alive.get(id);
    const lost = Math.max(0, was.hp - (e ? e.hp : 0));
    if (!lost) continue;
    const near = Object.values(L.own).filter(o => dist(o.x, o.z, was.x, was.z) < o.reach);
    const w = near.reduce((n, o) => n + o.dpr, 0);
    for (const o of near) stat(o.role).dealt += lost * o.dpr / w;
  }
  // remember this round
  L.own = {};
  for (const q of K.all) if (q.role !== 'builder') {
    const d = defOf(q);
    L.own[q.id] = { role: q.role, hp: q.hp, x: q.x, z: q.z, dpr: Math.max(0.1, squadDpr(q, 5)), reach: (isShooter(d) ? d.attack.range : 3) + 4 };
  }
  L.foe = {};
  for (const e of K.enemies) if (e.visible) L.foe[e.id] = { hp: e.hp, x: e.x, z: e.z };
}

// a role's learned value multiplier: its trade ratio against the side's overall one, 0.4 .. 1.6,
// applied as much as the skill level adapts
export function learnedMult(mem, role, adapt) {
  const L = mem.learn;
  if (!L || !adapt) return 1;
  const all = Object.values(L.stat).reduce((a, x) => ({ dealt: a.dealt + x.dealt, taken: a.taken + x.taken }), { dealt: 0, taken: 0 });
  const x = L.stat[role] || { dealt: 0, taken: 0 };
  const eff = (x.dealt + PRIOR) / (x.taken + PRIOR), base = (all.dealt + PRIOR) / (all.taken + PRIOR);
  return Math.pow(Math.max(0.4, Math.min(1.6, eff / base)), adapt);
}
