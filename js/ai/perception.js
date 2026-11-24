// Perception: what the AI knows this round, from its own side's view only (fog of war). Enemy squads it
// sees now, plus where it last saw the others (forgotten after `skill.memory` rounds); the enemy
// buildings its side has scouted (s.intel); the enemy HQ or the spots it may be at; threats near its own
// buildings; and an estimate of the enemy's army mix and tech tier from what it has seen.
// Easy reacts late: it plans from what it saw one round ago (skill.delay).
import { FACTIONS } from '../data/units.js';
import { GATES } from '../data/tech.js';
import { defOf } from '../sim/state.js';
import { hitRadius } from '../sim/base.js';
import { visibleTo, knownEnemyHq, observers, canSee } from '../sim/vision.js';
import { HQ_X, mirrorOn } from '../data/maps.js';
import { dist } from '../sim/geom.js';

const lite = q => ({ id: q.id, owner: q.owner, faction: q.faction, role: q.role, x: q.x, z: q.z, fx: q.fx, fz: q.fz, models: q.models, hp: q.hp, tk: q.tk, ttl: q.ttl, cd: q.cd || {}, mana: q.mana });

export function perceive(s, p, mem, skill) {
  const e = 1 - p;
  const vis = visibleTo(s, p);
  mem.seen = mem.seen || {};
  const alive = new Set(s.squads.map(q => q.id));
  for (const q of s.squads) if (q.owner === e && vis.has(q.id)) mem.seen[q.id] = { ...lite(q), round: s.round };
  for (const id of Object.keys(mem.seen)) if (!alive.has(id) || s.round - mem.seen[id].round > skill.memory) delete mem.seen[id];
  let enemies = Object.values(mem.seen).map(r => ({ ...r, visible: vis.has(r.id) }));
  // reaction time: Easy plans from last round's picture
  if (skill.delay) { const now = enemies; enemies = mem.lagEnemies || now; mem.lagEnemies = now; }
  const known = Object.values((s.intel && s.intel[p] && s.intel[p].known) || {}).filter(b => b.hp > 0)
    .map(b => ({ ...b, r: hitRadius(b), building: true }));
  const ehq = knownEnemyHq(s, p);
  // the enemy HQ spots not yet seen (where to look while its HQ is unknown)
  const mirror = mirrorOn(s.board.w, s.board.h);
  const spots = s.hqSpots.map(z => p === 0 ? mirror({ x: HQ_X, z }) : { x: HQ_X, z });
  mem.cleared = mem.cleared || {};
  const obs = observers(s, p);
  for (const sp of spots) if (obs.some(o => canSee(s.terrain, o.x, o.z, o.range, sp.x, sp.z))) mem.cleared[sp.x + ',' + sp.z] = true;
  const hqSpots = ehq ? [ehq] : spots.filter(sp => !mem.cleared[sp.x + ',' + sp.z]);
  const all = s.squads.filter(q => q.owner === p && q.hp > 0);
  const army = all.filter(q => q.role !== 'builder' && !q.ttl);
  const myB = (s.buildings || []).filter(b => b.owner === p && b.hp > 0);
  const hq = myB.find(b => b.type === 'hq') || null;
  // threats: known enemy squads close to our buildings (an alert for the defense manager)
  const guarded = myB.filter(b => b.type !== 'wall');
  const threats = enemies.filter(t => guarded.some(b => dist(t.x, t.z, b.x, b.z) < (b.type === 'hq' ? 13 : 9)));
  // enemy mix (roles of the squads it knows about) and tech tier (an elite squad seen => tier 2+)
  const mix = {};
  for (const t of enemies) mix[t.role] = (mix[t.role] || 0) + 1;
  const efac = s.players[e].faction;
  const gated = new Set(Object.keys(GATES[efac] || {}));
  mem.enemyTier = Math.max(mem.enemyTier || 1, enemies.some(t => gated.has(t.role)) ? 2 : 1, ehq?.tier || 1);
  return {
    s, p, e, fac: s.players[p].faction, efac, round: s.round,
    army, all, builders: all.filter(q => q.role === 'builder'), summons: all.filter(q => q.ttl),
    hero: army.find(q => q.role === 'hero') || null,
    enemies, known, ehq, hqSpots, hq, myB, threats, mix, enemyTier: mem.enemyTier,
    visible: vis, def: q => defOf(q), rising: !!FACTIONS[s.players[p].faction].rises,
  };
}
