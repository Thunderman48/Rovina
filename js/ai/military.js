// Military manager: gives every army squad a task (0 A.D. Petra / Age of Empires attack groups):
//  revive : 1-2 squads hold a fallen hero's revive zone when it is safe
//  defend : the defense manager answers enemies at home with enough squads to win (combat prediction)
//  scout  : one quick squad searches for the enemy HQ early, and re-scouts every few rounds
//  raid   : fast squads hit weakly defended economy (sites, farms) and pull out when threatened
//  main   : the attack plan's lifecycle: build (hold the staging point) -> gather -> attack (march on a
//           target chosen from the influence map, fighting on the way) -> retreat when the fight is
//           predicted lost -> regroup
// A task is { mode: 'advance' | 'guard' | 'retreat', goal: {x, z} | null, role }.
import { fightRatio, power } from './combat.js';
import { obstacles, bdef, graveCircles } from '../sim/base.js';
import { pointBlocked } from '../sim/nav.js';
import { dist } from '../sim/geom.js';

const VALUE = { hq: 3, well: 3, mine: 3, farm: 2.5, barracks: 2, forge: 2, chapel: 2, pit: 2, sanctum: 2, monolith: 1.8, tower: 1, banner: 1.2, wall: 0.2 };

function clearSpot(s, x0, z0) {
  const O = obstacles(s);
  for (let r = 0; r < 8; r += 0.75) for (let i = 0; i < Math.max(1, Math.round(r * 4)); i++) {
    const a = i / Math.max(1, Math.round(r * 4)) * Math.PI * 2, x = x0 + Math.cos(a) * r, z = z0 + Math.sin(a) * r;
    if (x > 1 && z > 1 && x < s.board.w - 1 && z < s.board.h - 1 && !pointBlocked(O, x, z, 1.4)) return { x, z };
  }
  return { x: x0, z: z0 };
}
const centroid = list => ({ x: list.reduce((n, q) => n + q.x, 0) / list.length, z: list.reduce((n, q) => n + q.z, 0) / list.length });

export function military(K, P, skill, posture, mem, inf) {
  const { s, p } = K;
  const tasks = new Map();
  const free = () => K.army.filter(q => !tasks.has(q.id));
  const home = K.hq ? { x: K.hq.x, z: K.hq.z } : { x: p === 0 ? 6 : s.board.w - 6, z: s.board.h / 2 };
  const foes = K.enemies.filter(e => e.role !== 'builder');

  // revive: hold a fallen hero's zone with the nearest squads when the zone isn't heavily threatened
  const rz = s.revive && s.revive[p];
  if (rz && inf.threatAt(rz.x, rz.z) < inf.ownAt(rz.x, rz.z) + 10) {
    for (const q of free().sort((a, b) => dist(a.x, a.z, rz.x, rz.z) - dist(b.x, b.z, rz.x, rz.z)).slice(0, 2)) tasks.set(q.id, { mode: 'advance', goal: { x: rz.x, z: rz.z }, role: 'revive' });
  }

  // defense: enough squads (by predicted strength) go to meet enemies close to home
  if (K.threats.length) {
    const c = centroid(K.threats);
    const group = [];
    for (const q of free().sort((a, b) => dist(a.x, a.z, c.x, c.z) - dist(b.x, b.z, c.x, c.z))) {
      if (group.length && fightRatio(group, K.threats) >= 1.4) break;
      group.push(q);
    }
    for (const q of group) tasks.set(q.id, { mode: 'advance', goal: { x: c.x, z: c.z }, role: 'defend' });
  }

  // scouting: while the enemy HQ is unknown (or every so often), one quick squad looks for it
  const scoutEvery = Math.round(14 / Math.max(0.2, skill.scout));
  const needScout = (!K.ehq && K.round >= 2) || (K.round - (mem.lastScout || 0) >= scoutEvery && K.round >= 8);
  let scout = mem.scoutId && K.army.find(q => q.id === mem.scoutId && !tasks.has(q.id));
  if (needScout && !scout && K.army.length >= 3) {
    scout = free().filter(q => q.role !== 'hero' && q.role !== 'mage').sort((a, b) => K.def(b).tier - K.def(a).tier || power(a) - power(b))[0];
    if (scout) mem.scoutId = scout.id;
  }
  if (scout && needScout) {
    // the nearest unseen HQ spot; once the HQ is known, the least recently seen enemy resource site
    const spot = !K.ehq ? K.hqSpots.slice().sort((a, b) => dist(scout.x, scout.z, a.x, a.z) - dist(scout.x, scout.z, b.x, b.z))[0]
      : (s.shrines || []).filter(sh => (p === 0 ? sh.x > s.board.w / 2 : sh.x < s.board.w / 2)).sort((a, b) => dist(scout.x, scout.z, a.x, a.z) - dist(scout.x, scout.z, b.x, b.z))[0];
    if (spot && dist(scout.x, scout.z, spot.x, spot.z) > 3) tasks.set(scout.id, { mode: inf.threatAt(scout.x, scout.z) > power(scout) * 2 ? 'retreat' : 'advance', goal: { x: spot.x, z: spot.z }, role: 'scout' });
    else { mem.lastScout = K.round; mem.scoutId = null; }
  } else if (!needScout) mem.scoutId = null;

  // raids: fast squads go for weakly defended economy while the main army builds or attacks
  if (posture === 'harass' || posture === 'attack') {
    const eco = K.known.filter(b => b.type === 'mine' || b.type === 'well' || b.type === 'farm');
    for (const q of free().filter(q => q.role === 'fast')) {
      const t = eco.map(b => ({ b, sc: VALUE[b.type] - inf.threatAt(b.x, b.z) / Math.max(1, power(q)) - dist(q.x, q.z, b.x, b.z) * 0.04 })).sort((a, b) => b.sc - a.sc)[0];
      if (!t || t.sc < 0.5) continue;
      const danger = inf.threatAt(q.x, q.z) > power(q) * 2.2;
      tasks.set(q.id, { mode: danger ? 'retreat' : 'advance', goal: { x: t.b.x, z: t.b.z }, role: 'raid' });
    }
  }

  // ---- the main army and its attack plan ----
  const main = free();
  const A = mem.atk || (mem.atk = { state: 'build', since: K.round, size: 0, target: null });
  // target: the best known enemy building (value / local defence, closer is better), else an HQ spot
  const pickTarget = () => {
    const cands = K.known.map(b => {
      const v = VALUE[b.type] || 1, d = inf.threatAt(b.x, b.z);
      return { x: b.x, z: b.z, id: b.id, sc: v * (b.type === 'hq' && b.hp < bdef(b).hp * 0.5 ? 2 : 1) / (1 + d / 40) - dist(home.x, home.z, b.x, b.z) * 0.015 };
    }).sort((a, b) => b.sc - a.sc);
    if (cands.length) return cands[0];
    const sp = K.hqSpots.slice().sort((a, b) => dist(home.x, home.z, a.x, a.z) - dist(home.x, home.z, b.x, b.z))[0];
    return sp ? { x: sp.x, z: sp.z, id: null } : { x: s.board.w - home.x, z: s.board.h - home.z, id: null };
  };
  // re-pick when the target is gone, or it was only a guessed spot and real buildings are now known
  // (or the spot was seen empty); during an attack, switch to a clearly better target nearby
  const stale = !A.target || (A.target.id && !K.known.some(b => b.id === A.target.id))
    || (!A.target.id && (K.known.length || !K.hqSpots.some(sp => sp.x === A.target.x && sp.z === A.target.z)));
  if (stale || A.state !== 'attack') A.target = pickTarget();
  // staging: a third of the way to the target, on the safest nearby ground
  const T = A.target;
  const sx = home.x + (T.x - home.x) * 0.35, sz = home.z + (T.z - home.z) * 0.35;
  let st = { x: sx, z: sz }, sb = -1e9;
  for (let i = 0; i < 9; i++) {
    const a = i / 9 * Math.PI * 2, x = sx + Math.cos(a) * (i ? 3 : 0), z = sz + Math.sin(a) * (i ? 3 : 0);
    const b = inf.balance(x, z);
    if (b > sb) { sb = b; st = { x, z }; }
  }
  // the Undead wait on their own graves (every death there pays souls; Monoliths heal): the grave
  // point closest to the staging spot, a little inside the edge
  if (K.rising) {
    let gb = null, gd = 1e9;
    for (const g of graveCircles(s, p)) {
      const d = dist(g.x, g.z, st.x, st.z), k = d > g.r - 1.5 ? Math.max(0, g.r - 1.5) / Math.max(0.01, d) : 1;
      const pt = { x: g.x + (st.x - g.x) * k, z: g.z + (st.z - g.z) * k }, dd = dist(pt.x, pt.z, st.x, st.z);
      if (dd < gd) { gd = dd; gb = pt; }
    }
    if (gb) st = gb;
  }
  const staging = clearSpot(s, st.x, st.z);
  const at = q => dist(q.x, q.z, staging.x, staging.z) < 6;
  const c = main.length ? centroid(main) : home;
  // the state machine
  if (A.state === 'build' && posture === 'attack') Object.assign(A, { state: 'gather', since: K.round });
  if (A.state === 'gather') {
    const gathered = main.filter(at).length >= Math.ceil(main.length * 0.7);
    if (posture === 'defend' || (posture === 'build' && mem.atkRatio < (P.attackRatio + skill.edge) * 0.8)) A.state = 'build';   // once gathering, only a threat at home or a clearly worse outlook calls it off
    else if (main.length >= 2 && (gathered || K.round - A.since >= 4)) Object.assign(A, { state: 'attack', since: K.round, size: main.length });
  } else if (A.state === 'attack') {
    // abort when the fight around the army is predicted lost, or the army has been cut down
    const near = foes.filter(e => dist(e.x, e.z, c.x, c.z) < 13);
    const towers = K.known.filter(b => !b.build && bdef(b).fire && dist(b.x, b.z, c.x, c.z) < 13);
    const r = fightRatio(main, near.concat(towers));
    if ((near.length && r < 0.7) || main.length < A.size * 0.4) Object.assign(A, { state: 'retreat', since: K.round });
  } else if (A.state === 'retreat') {
    if (K.round - A.since >= 2 || main.every(q => dist(q.x, q.z, home.x, home.z) < 12)) Object.assign(A, { state: 'build', since: K.round, target: pickTarget() });
  }
  // where to fall back to: a healing building (Monolith / Chapel with Field Hospital), else home
  const heal = K.myB.filter(b => !b.build && bdef(b).heal).sort((a, b) => dist(c.x, c.z, a.x, a.z) - dist(c.x, c.z, b.x, b.z))[0];
  const fall = heal ? { x: heal.x, z: heal.z } : clearSpot(s, home.x + (p === 0 ? 4 : -4), home.z);
  for (const q of main) {
    if (A.state === 'attack') tasks.set(q.id, { mode: 'advance', goal: { x: T.x, z: T.z }, role: 'attack' });
    else if (A.state === 'retreat') tasks.set(q.id, { mode: 'advance', goal: fall, role: 'retreat', flee: true });
    else if (posture === 'defend' && K.hq) tasks.set(q.id, { mode: 'advance', goal: clearSpot(s, home.x + (p === 0 ? 4 : -4), home.z), role: 'home' });
    else tasks.set(q.id, { mode: 'advance', goal: staging, role: 'stage' });
  }
  mem.staging = staging;
  return tasks;
}
