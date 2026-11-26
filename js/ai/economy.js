// Economy and production with a queue manager (0 A.D. Petra style): every need becomes a request with a
// priority (from the personality and the strategic posture); requests are funded in priority order from
// the side's resource, and a ready, unfunded top request may hold its cost back (saving) so cheaper,
// lower ones don't starve it. Requests: builders to sites, economy (peasants, farms, mines / soul wells,
// grave spreading), production buildings, defenses, the HQ tier and tech buildings, research, and the
// army (squad types picked by counter value against what the AI has seen, not a fixed table).
import { RULES, FACTIONS, trainsOf, pairOf, maxBuildersOf } from '../data/units.js';
import { TECH, GATES } from '../data/tech.js';
import { MATCHUPS } from './matchups.js';
import { emptyPlan, defOf, apFor } from '../sim/state.js';
import { popCost, placeError, BUILDINGS, trainCost, footprint, builderCount, armySize, bdef, buildQueue, siteTaken, seenBy, graveCircles, hasTech, techError, gateOf, tkOf, researching } from '../sim/base.js';
import { builderPlan, approachSpot } from '../sim/builders.js';
import { dist } from '../sim/geom.js';
import { learnedMult } from './learning.js';

const TIER2 = { kingdom: 'castle', undead: 'mausoleum' }, TIER3 = { kingdom: 'citadel', undead: 'necropolis' };

// counter value of a role against the enemy mix it knows, from the combat simulator's matchup table
// (tools/matchups.mjs: equal-cost duels, so the score already includes cost). The mix it counters is
// what it has seen (weighted by `adapt`) blended with what the enemy can train at its known tier.
function roleValue(fac, role, K, adapt) {
  const T = MATCHUPS[fac + '>' + K.efac]?.[role];
  if (!T) return 1;
  const pool = Object.keys(T).filter(r => K.enemyTier >= 2 || !(GATES[K.efac] || {})[r]);
  const seen = {};
  let n = 0;
  for (const e of K.enemies) if (T[e.role] !== undefined) { seen[e.role] = (seen[e.role] || 0) + (e.models || 1) / Math.max(1, defOf(e).models); n++; }
  let v = 0, w = 0;
  for (const r of new Set(pool.concat(Object.keys(seen)))) {
    const wt = (1 - adapt) / pool.length * (pool.includes(r) ? 1 : 0) + (n ? adapt * (seen[r] || 0) / n : adapt / pool.length * (pool.includes(r) ? 1 : 0));
    v += wt * Math.exp(1.6 * T[r]); w += wt;
  }
  return w ? v / w : 1;
}

export function economy(K, P, skill, posture, mem, orders) {
  const { s, p, fac } = K;
  const out = { builds: [], trains: [] };
  let supply = s.supply[p];
  const gold = fac === 'kingdom', rising = K.rising;
  const mine = K.myB, hq = K.hq;
  if (!hq) return out;
  const fwd = p === 0 ? 1 : -1;
  const queued = buildQueue(s, p).map(it => ({ ...it, owner: p, ...footprint(it.type, it.x, it.z, it.rot) }));
  const builders = K.builders;
  const count = t => mine.filter(b => b.type === t).length + queued.filter(b => b.type === t).length;
  const done = t => mine.filter(b => b.type === t && !b.build).length;
  const busy = new Set();
  // 1. unfinished sites and damaged buildings get the nearest free builder (no cost)
  const tasked = id => builders.some(q => q.task && q.task.bid === id && q.task.kind !== 'gather');
  for (const b of mine.filter(b => (b.build > 0 || b.hp < bdef(b).hp * 0.7) && !tasked(b.id)).sort((a, c) => (a.build ? -1 : 1) - (c.build ? -1 : 1))) {
    const q = builders.filter(x => !busy.has(x.id)).sort((a, c) => dist(a.x, a.z, b.x, b.z) - dist(c.x, c.z, b.x, b.z))[0];
    if (!q) break;
    const bp = builderPlan(s, q, b, apFor(q));
    if (!bp.actions.length) continue;
    const plan = emptyPlan(); plan.actions = bp.actions; orders.squads[q.id] = plan; busy.add(q.id);
  }

  // ---- placement helpers (candidates around own buildings, scored by `prefer`) ----
  const rises = () => mine.filter(b => b.build > 0).length + queued.length;
  // builders already on a site keep working on it; a new site only starts with a builder to spare
  // (one site under way per builder), else the order would pull a builder off its site for nothing
  const onSite = q => q.task && q.task.kind !== 'gather' && mine.some(b => b.id === q.task.bid && (b.build > 0 || b.hp < bdef(b).hp));
  const place = (type, prefer) => {
    const free = builders.filter(x => !busy.has(x.id) && !onSite(x));
    if (rising && rises() >= RULES.maxRising) return false;
    if (!rising && (!free.length || rises() >= builders.length)) return false;
    const cand = [];
    if (BUILDINGS[type].site) {
      const sites = (s.shrines || []).filter(sh => !siteTaken(s, sh, queued) && seenBy(s, p, sh.x, sh.z)).sort((a, b) => dist(a.x, a.z, hq.x, hq.z) - dist(b.x, b.z, hq.x, hq.z));
      for (const sh of sites) cand.push({ x: sh.x, z: sh.z, score: -dist(sh.x, sh.z, hq.x, hq.z) - (K.inf ? K.inf.threatAt(sh.x, sh.z) * 0.05 : 0) });
    } else for (const b of mine) for (let r = 2.5; r <= 8; r += 1.5) for (let k = 0; k < 12; k++) {
      const a = k / 12 * Math.PI * 2, x = b.x + Math.cos(a) * r, z = b.z + Math.sin(a) * r;
      cand.push({ x, z, score: prefer(x, z) });
    }
    cand.sort((a, b) => b.score - a.score);
    for (const c of cand.slice(0, 60)) for (const rot of [0, 1]) {
      if (placeError(s, p, type, c.x, c.z, rot, queued)) continue;
      const f = { type, x: c.x, z: c.z, rot, owner: p, ...footprint(type, c.x, c.z, rot) };
      // keep a free side to work from (no sites squeezed in between buildings)
      if (!rising && type !== 'wall' && !approachSpot(s, f, hq.x, hq.z, 1.1)) continue;
      if (rising) { queued.push(f); out.builds.push({ type, x: c.x, z: c.z, rot }); return true; }
      const q = free.sort((a, b) => dist(a.x, a.z, c.x, c.z) - dist(b.x, b.z, c.x, c.z))[0];
      const bp = builderPlan(s, q, f, apFor(q));
      if (!bp.actions.length) continue;
      queued.push(f); out.builds.push({ type, x: c.x, z: c.z, rot });
      const plan = emptyPlan(); plan.actions = bp.actions; orders.squads[q.id] = plan; busy.add(q.id);
      return true;
    }
    return false;
  };
  // undead: spread graves toward a target with a Bone Fence (or a Monolith) on the nearest grave edge
  const spreadToward = (target, type = 'wall') => {
    if (rises() >= RULES.maxRising || mine.some(b => b.type === type && b.build > 0)) return false;
    const pts = [];
    for (const c of graveCircles(s, p)) for (let k = 0; k < 16; k++) {
      const a = k / 16 * Math.PI * 2, rr = Math.max(0.5, c.r - 0.3);
      pts.push({ x: c.x + Math.cos(a) * rr, z: c.z + Math.sin(a) * rr });
    }
    pts.sort((a, b) => dist(a.x, a.z, target.x, target.z) - dist(b.x, b.z, target.x, target.z));
    for (const c of pts.slice(0, 14)) for (const rot of [0, 1]) {
      if (placeError(s, p, type, c.x, c.z, rot, queued)) continue;
      queued.push({ type, x: c.x, z: c.z, rot, owner: p, ...footprint(type, c.x, c.z, rot) });
      out.builds.push({ type, x: c.x, z: c.z, rot });
      return true;
    }
    return false;
  };
  const forward = (x, z) => fwd * (x - hq.x) - Math.abs(z - hq.z) * 0.3;
  const side = (x, z) => -Math.abs(fwd * (x - hq.x) - 1) - Math.abs(Math.abs(z - hq.z) - 5) * 0.5;
  const toward = t => (x, z) => -dist(x, z, t.x, t.z);
  const front = K.ehq || K.hqSpots[0] || { x: s.board.w / 2, z: s.board.h / 2 };

  // ---- requests: { pri, cost, ready, run } ----
  const usedB = new Set();   // one new item per idle building a round
  const R = [];
  const req = (pri, cost, run, ready = true, tag = '', reserve = false) => R.push({ pri, cost, run, ready, tag, reserve });
  const army = K.army.length, threatened = K.threats.length > 0;
  // souls above the decay threshold are lost a bit every round: spend them first
  const flush = rising && supply > RULES.soulKeep;
  // healthy: the strategy's predicted strength ratio (with the remembered enemy army) is not losing
  const healthy = army >= 4 && (mem.ratio ?? 1) >= 0.9 && army >= K.enemies.filter(e => e.role !== 'builder').length * 0.7;
  const atWar = posture === 'attack' || posture === 'defend';
  const site = gold ? 'mine' : 'well';
  const wantSites = gold ? 1 + Math.floor(P.greed * 2 + s.round / 14) : (P.wells || 2) + Math.floor(s.round / 16);
  // economy
  // Kingdom opening (starting at 0 gold): a second peasant, then the first Mine, then the Barracks
  if (!count('barracks')) req(threatened ? 100 : gold && !count(site) ? 118 : 135, BUILDINGS.barracks.cost, () => place('barracks', (x, z) => -Math.abs(z - hq.z - 3) - Math.abs(fwd * (x - hq.x) - 2)), gold || count(site) > 0, 'barracks', true);
  if (count(site) < wantSites) {
    // undead: the nearest seen free site must be on graves first: spread graves toward it
    const sites = (s.shrines || []).filter(sh => !siteTaken(s, sh, queued) && seenBy(s, p, sh.x, sh.z)).sort((a, b) => dist(a.x, a.z, hq.x, hq.z) - dist(b.x, b.z, hq.x, hq.z));
    const onGraves = sites.find(sh => !placeError(s, p, site, sh.x, sh.z, 0, queued));
    const pri = count(site) ? 55 + 30 * P.greed : threatened ? 98 : 125;   // the first site comes before the army
    const first = !count(site);
    // a site can only be asked for when one is placeable (an enemy building's 16" zone can shut them all)
    if (!rising || onGraves) req(pri, BUILDINGS[site].cost, () => place(site), !!onGraves, 'site', first);
    else if (sites.length) {
      req(pri - 5, BUILDINGS.wall.cost, () => spreadToward(sites[0]), true, 'spread');
      if (first) req(pri, BUILDINGS[site].cost, () => false, false, 'site', true);   // save for it meanwhile
    }
  }
  if (gold) {
    const farms = Math.min(P.farms + Math.floor(s.round / 12), 8);
    if (count('farm') < farms) req(count('farm') ? 45 + 40 * P.greed : threatened ? 90 : 120, BUILDINGS.farm.cost, () => place('farm', side), s.round >= 2 || !count('farm'));
    const jobs = 1 + 3 * done('farm') + 2 * done('mine');
    const want = Math.min(maxBuildersOf(fac), Math.max(2, Math.min(jobs, P.peasants + Math.floor(s.round / 6))));
    if (builderCount(s, p) < want && !hq.train && !(hq.queue || []).length) req(builderCount(s, p) < 2 && !threatened ? 140 : 60 + 30 * P.greed - (threatened ? 25 : 0), trainCost(fac, 'builder'), () => { if (usedB.has(hq.id)) return false; usedB.add(hq.id); out.trains.push({ bid: hq.id, role: 'builder' }); return true; }, true, 'peasant');
  }
  // defenses (towers / walls), more for defensive personalities or when threatened
  if (threatened && count('wall') < 2 + Math.round(P.defense * 2)) req(70, BUILDINGS.wall.cost, () => place('wall', (x, z) => forward(x, z) - Math.min(...K.threats.map(e => dist(e.x, e.z, x, z))) * 0.5));
  if (s.round >= 4 && count('tower') < 1 + Math.round(P.defense * 2 + s.round / 20)) req(25 + 45 * P.defense + (threatened ? 20 : 0), BUILDINGS.tower.cost, () => place('tower', forward));
  if (gold && count('banner') < RULES.maxBannerCp && s.round >= 5) req(35, BUILDINGS.banner.cost, () => place('banner', (x, z) => -dist(x, z, hq.x, hq.z)));
  if (rising && s.round >= 4 && count('monolith') < (P.monoliths || 1) + Math.floor(s.round / 10)) req(35 + 35 * P.defense, BUILDINGS.monolith.cost, () => place('monolith', toward(front)));
  // the Undead push their graves toward the enemy over the game (the blight creep)
  if (rising && s.round >= 6 && P.defense > 0.5) req(20 + 20 * P.defense, BUILDINGS.wall.cost, () => spreadToward(front), true, 'creep');
  // more production when the bank is big
  if (count('barracks') && (supply >= 70 || flush) && count('barracks') < 1 + Math.floor(s.round / 8)) req(supply >= 150 || flush ? 118 : 50, BUILDINGS.barracks.cost, () => place('barracks', (x, z) => -Math.abs(z - hq.z) * 0.4 - Math.abs(fwd * (x - hq.x) - 3)));
  // tech: HQ tiers, tech buildings, research (only with a healthy army)
  const t2 = TIER2[fac], t3 = TIER3[fac];
  const trainerIdle = b => !b.build && !b.train && !(b.queue || []).length;
  // research shares its building's queue with training: with a healthy army and a bank that covers it,
  // it goes ahead of the army request for that building (else the army starves the tech or vice versa)
  const researchReq = (b, id, pri) => req(healthy && supply >= TECH[id].cost + 15 ? 140 + pri * 0.1 : pri, TECH[id].cost, () => { if (usedB.has(b.id)) return false; usedB.add(b.id); out.trains.push({ bid: b.id, role: 'tech:' + id }); return true; }, trainerIdle(b), 'tech');
  if (s.round >= 5 && !hasTech(s, p, t2) && !researching(s, p, t2) && !techError(s, p, t2, hq, [], [], true))
    researchReq(hq, t2, 52 + 40 * P.tech + (s.round >= 12 ? 15 : 0));
  if (hasTech(s, p, t2) && healthy && s.round >= 12 && !hasTech(s, p, t3) && !researching(s, p, t3) && !techError(s, p, t3, hq, [], [], true))
    researchReq(hq, t3, 35 + 40 * P.tech);
  if (hasTech(s, p, t2)) P.techBuildings.forEach((tb, i) => {
    if (!count(tb) && (i === 0 || s.round >= 12)) req(40 + 40 * P.tech - i * 10, BUILDINGS[tb].cost, () => place(tb, side), healthy || i === 0);
  });
  if (healthy && s.round >= 6) {
    const claimed = [];
    for (const b of mine.filter(b => P.research[b.type] && trainerIdle(b))) {
      const id = P.research[b.type].find(id => !TECH[id].hqTier && !claimed.includes(id) && !techError(s, p, id, b, [], claimed, true));
      if (!id) continue;
      claimed.push(id);
      // the HQ's research competes with its training: lower when the army is small
      researchReq(b, id, 20 + 35 * P.tech - (b.type === 'hq' ? 10 : 0) - (atWar ? 10 : 0));
    }
  }
  // the army: one squad per idle training building, the best counter for what it has seen
  let armyN = armySize(s, p);
  const tk = tkOf(s, p);
  const roles = K.army.map(q => q.role), n = r => roles.filter(x => x === r).length;
  const valueOf = r => roleValue(fac, r, K, skill.adapt) * (P.mix[r] || 1) * learnedMult(mem, r, skill.adapt);
  // the best squad any of its training buildings can make: a building whose own best is far worse
  // (the Crypt's Warbands against Crossbows) leaves its queue to research unless the bank is big
  const allOpts = [...new Set(mine.filter(b => !b.build).flatMap(b => trainsOf(b.type, fac)).filter(r => r !== 'builder' && !gateOf(s, p, r)))];
  const topValue = Math.max(0, ...allOpts.map(valueOf));
  for (const b of mine.filter(b => trainerIdle(b) && trainsOf(b.type, fac).some(r => r !== 'builder'))) {
    if (b.type === 'hq' && gold && builderCount(s, p) < 2) continue;
    const opts = trainsOf(b.type, fac).filter(r => r !== 'builder' && !gateOf(s, p, r));
    if (!opts.length) continue;
    let best = null, bv = -1;
    for (const r of opts) {
      // diversity: a role already above 45 % of the army is worth less; casters capped at 1 per 5 squads
      const share = army ? n(r) / army : 0;
      let v = valueOf(r) * (share > 0.45 ? 0.6 : 1);
      if (r === 'mage' && n('mage') >= Math.max(1, Math.floor(army / 5))) v *= 0.3;
      if (v > bv) { bv = v; best = r; }
    }
    if (bv < topValue * 0.5 && supply < 120 && !threatened && army >= 4) continue;
    const pr = popCost(fac, best, tk);
    const pri = 60 + 30 * P.aggression + (atWar ? 25 : 0) + (flush ? 25 : 0) + (army < 4 && (threatened || s.round >= 6) ? 30 : 0) + (threatened ? 20 : 0);
    req(pri, trainCost(fac, best), () => { if (armyN + pr > s.board.cap || usedB.has(b.id)) return false; usedB.add(b.id); out.trains.push({ bid: b.id, role: best }); armyN += pr; return true; }, true, 'army');
  }

  // ---- fund requests in priority order; a ready top request that can't be paid holds its cost back ----
  R.sort((a, b) => b.pri - a.pri);
  // the opening's key buildings (first site, first barracks) keep their cost saved even before they can
  // be placed, so the army doesn't spend the starting bank first
  let held = s.round <= 8 ? R.filter(r => r.reserve && !r.ready).reduce((n, r) => n + r.cost, 0) : 0;
  mem.reqs = R.map(r => `${r.tag || '?'}:${r.pri | 0}:${r.cost}${r.ready ? '' : '!'}`);
  for (const r of R) {
    if (!r.ready) continue;
    if (supply - held >= r.cost) { if (r.run()) supply -= r.cost; else if (r.reserve && s.round <= 8) held += r.cost; continue; }
    // saving: only for important things (tiers, the first buildings), once
    if (r.pri >= 70 && r.tag !== 'army' && (r.tag !== 'tech' || healthy) && (r.reserve || !held)) held += r.cost;
  }
  return out;
}
