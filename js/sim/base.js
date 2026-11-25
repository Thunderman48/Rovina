// Base & economy: buildings (footprints, obstacles, placement), shrine nodes, supply,
// training. Deterministic, shared by the resolver, the planner UI and the AI.
import { RULES, BUILDINGS, FACTIONS, squadRadius, trainCost, trainsOf, maxBuildersOf, pairOf, unitDef } from '../data/units.js';
import { dist, inRect } from './geom.js';
import { pointBlocked } from './nav.js';
import { TECH, GATES, BUILDING_GATES, techBuilding, techRules, techKey } from '../data/tech.js';

// a building's definition with its side's research applied (b.tk = the side's tech key)
export const bdef = b => techBuilding(BUILDINGS[b.type], b.type, b.tk);

// ---- tech ----
export const tkOf = (s, p) => (s.techKey && s.techKey[p]) || '';
export const hasTech = (s, p, id) => !!(s.tech && s.tech[p] && s.tech[p].includes(id));
export const researching = (s, p, id) => (s.buildings || []).some(b => b.owner === p && b.hp > 0 && b.train && b.train.tech === id);
const ruleCache = new Map();
// a side-wide research bonus (TECH.<id>.rules), or dflt
export function ruleOf(s, p, key, dflt = 0) {
  const k = tkOf(s, p);
  if (!k) return dflt;
  let r = ruleCache.get(k);
  if (!r) { r = techRules(k.split(',')); ruleCache.set(k, r); }
  return r[key] ?? dflt;
}
// the tech a role still waits for (its HQ tier), or ''
export function gateOf(s, p, role) { const g = GATES[s.players[p].faction]?.[role]; return g && !hasTech(s, p, g) ? g : ''; }
// tech a building type researches for a faction
export const researchesAt = (type, faction) => Object.values(TECH).filter(t => t.faction === faction && t.at === type);
const bnames = (types, faction) => types.map(t => BUILDINGS[t].name[faction]).join(' or ');
// can side p research `id` (at building b)? earlier: tech queued before it in the same line; others:
// tech queued in other buildings. start: the research would start now (needs must be finished).
// Returns '' or a reason.
export function techError(s, p, id, b = null, earlier = [], others = [], start = false) {
  const t = TECH[id], fac = s.players[p].faction;
  if (!t || t.faction !== fac) return 'Your side can\'t research that';
  if (b && t.at !== b.type) return 'Researched at the ' + BUILDINGS[t.at].name[fac];
  if (hasTech(s, p, id)) return 'Already researched';
  if (!start && (researching(s, p, id) || others.includes(id) || earlier.includes(id))) return 'Already under way';
  if (t.doctrine) {
    const sib = Object.values(TECH).filter(x => x.doctrine === t.doctrine && x.id !== id).find(x => hasTech(s, p, x.id) || researching(s, p, x.id) || (!start && (others.includes(x.id) || earlier.includes(x.id))));
    if (sib) return 'You chose ' + sib.name;
  }
  for (const n of t.needs || []) if (!hasTech(s, p, n) && (start || !(researching(s, p, n) || earlier.includes(n)))) return 'Needs ' + TECH[n].name;
  if (t.needsBuilding && !(s.buildings || []).some(x => x.owner === p && x.hp > 0 && !x.build && t.needsBuilding.includes(x.type))) return 'Needs a ' + bnames(t.needsBuilding, fac);
  return '';
}
// queue items are roles or 'tech:<id>' (research)
export const isTechItem = it => typeof it === 'string' && it.startsWith('tech:');
export const itemCost = (fac, it) => isTechItem(it) ? (TECH[it.slice(5)]?.cost || 0) : trainCost(fac, it);
export const itemRounds = (fac, it) => isTechItem(it) ? (TECH[it.slice(5)]?.rounds || 1) : RULES.trainRounds[it] || 2;
// a finished research: record it and refresh every squad and building of the side (max HP grows with it)
export function finishTech(s, p, id) {
  s.tech = s.tech || [[], []]; s.techKey = s.techKey || ['', ''];
  if (s.tech[p].includes(id)) return;
  s.tech[p].push(id);
  const key = techKey(s.tech[p]);
  s.techKey[p] = key;
  for (const q of s.squads) {
    if (q.owner !== p) continue;
    const old = FACTIONS[q.faction].units[q.role] && unitDefTk(q.faction, q.role, q.tk);
    q.tk = key;
    const nw = unitDefTk(q.faction, q.role, key);
    if (old && nw.hpPer !== old.hpPer && q.hp > 0) q.hp = Math.round((q.hp + q.models * (nw.hpPer - old.hpPer)) * 1000) / 1000;
  }
  for (const b of s.buildings) {
    if (b.owner !== p) continue;
    const old = bdef(b).hp;
    b.tk = key;
    const nw = bdef(b).hp;
    if (nw !== old && !b.build && b.hp > 0) b.hp = Math.max(1, Math.round(b.hp + nw - old));
    if (b.type === 'hq' && TECH[id].hqTier) b.tier = TECH[id].hqTier;
  }
}
const unitDefTk = (f, r, tk) => unitDef(f, r, tk);
export const bname = (b, faction) => bdef(b).name[faction];

// footprint of a building at (x,z) with rot (0 or 1 = rotated 90 degrees)
export function footprint(type, x, z, rot = 0) {
  const d = BUILDINGS[type];
  if (d.shape === 'circle') return { x, z, r: d.r };
  return rot ? { x, z, w: d.d, d: d.w } : { x, z, w: d.w, d: d.d };
}
// a round "hit" radius for attacks and sight
export function hitRadius(b) { const d = bdef(b); return d.shape === 'circle' ? d.r : Math.sqrt(b.w * b.d) / 2 + 0.15; }

// distance from (x,z) to the building's footprint edge (0 inside)
export function edgeDist(b, x, z) {
  if (b.r !== undefined) return Math.max(0, dist(b.x, b.z, x, z) - b.r);
  const dx = Math.max(0, Math.abs(x - b.x) - b.w / 2), dz = Math.max(0, Math.abs(z - b.z) - b.d / 2);
  return Math.sqrt(dx * dx + dz * dz);
}
// distance from (x,z) to an attack target's edge: a squad's round base, a real building's footprint, or a
// light building copy (stance / AI targets) that carries its footprint as `foot`
export function edgeGap(e, x, z) {
  const f = e.foot || (e.type ? e : null);
  if (f) return edgeDist(f, x, z);
  return dist(x, z, e.x, e.z) - (e.r ?? squadRadius(unitDef(e.faction, e.role, e.tk), e.models));
}
export const footOf = b => b.r !== undefined ? { x: b.x, z: b.z, r: b.r } : { x: b.x, z: b.z, w: b.w, d: b.d };
export function addBuilding(s, owner, type, x, z, rot = 0, built = true) {
  const b = { id: 'b' + (s.nextBid = (s.nextBid || 0) + 1), owner, type, rot, ...footprint(type, x, z, rot) };
  if (tkOf(s, owner)) b.tk = tkOf(s, owner);
  const d = bdef(b);   // with the side's research (HP, work)
  Object.assign(b, { hp: built || !d.work ? d.hp : Math.max(1, Math.round(d.hp * RULES.siteHp)), build: built ? 0 : d.work, train: null, vision: built || !d.work ? d.vision : 3 });
  if (d.trains || d.research) b.queue = [];
  s.buildings.push(b);
  return b;
}

// terrain + standing buildings as one obstacle list (buildings use kind 'building' so nav blocks them)
const obsCache = new Map();
export function buildingSig(s) { return (s.map || '') + '#' + (s.buildings || []).filter(b => b.hp > 0).map(b => b.id + '@' + b.x + ',' + b.z + ',' + b.rot).join('|'); }
export function obstacles(s) {
  const sig = buildingSig(s);
  if (!sig) return s.terrain;
  let o = obsCache.get(sig);
  if (!o) {
    o = s.terrain.concat(s.buildings.filter(b => b.hp > 0).map(b => b.r !== undefined ? { kind: 'building', x: b.x, z: b.z, r: b.r } : { kind: 'building', x: b.x, z: b.z, w: b.w, d: b.d }));
    if (obsCache.size > 60) obsCache.clear();
    obsCache.set(sig, o);
  }
  return o;
}
export const navKey = s => 'r' + buildingSig(s);

// ---- placement ------------------------------------------------------------------------
function overlaps(a, b, pad = 0) {
  // circle / rect vs circle / rect (rects are axis aligned)
  const ra = a.r !== undefined, rb = b.r !== undefined;
  if (ra && rb) return dist(a.x, a.z, b.x, b.z) < a.r + b.r + pad;
  if (ra && !rb) return inRect(a.x, a.z, b, a.r + pad);
  if (!ra && rb) return inRect(b.x, b.z, a, b.r + pad);
  return Math.abs(a.x - b.x) < (a.w + b.w) / 2 + pad && Math.abs(a.z - b.z) < (a.d + b.d) / 2 + pad;
}
// resource site at (x,z) (within a small snap distance), or null
export function siteAt(s, x, z, snap = 0.6) { return (s.shrines || []).find(sh => dist(sh.x, sh.z, x, z) <= snap) || null; }
export function siteTaken(s, sh, extra = []) { return (s.buildings || []).filter(b => b.hp > 0).concat(extra).some(b => BUILDINGS[b.type].site && dist(b.x, b.z, sh.x, sh.z) < 0.6); }
// nearest resource site to (x,z) that is still free
export function nearestFreeSite(s, x, z, extra = []) {
  let best = null, bd = 1e9;
  for (const sh of s.shrines || []) { const d = dist(sh.x, sh.z, x, z); if (d < bd && !siteTaken(s, sh, extra)) { bd = d; best = sh; } }
  return best;
}
export const canBuild = (s, p, type) => FACTIONS[s.players[p].faction].buildings.includes(type);

// can side p place `type` at (x,z,rot)? `extra` = buildings already queued. `squads` = false ignores
// squads standing there (they move; used for the build queue). Returns '' or a reason.
export function placeError(s, p, type, x, z, rot = 0, extra = [], squads = true) {
  const W = s.board.w, H = s.board.h, d = BUILDINGS[type];
  if (!d || !canBuild(s, p, type)) return 'Your side can\'t build that';
  if (BUILDING_GATES[type] && !hasTech(s, p, BUILDING_GATES[type])) return 'Needs the ' + TECH[BUILDING_GATES[type]].name;
  const f = footprint(type, x, z, rot), half = f.r !== undefined ? f.r : Math.max(f.w, f.d) / 2;
  if (x - half < 0.3 || z - half < 0.3 || x + half > W - 0.3 || z + half > H - 0.3) return 'Off the board';
  // only on ground the side has seen; undead buildings only on their own graves (like blight / creep)
  if (type !== 'hq' && !seenBy(s, p, x, z)) return 'You haven\'t seen that spot yet';
  if (type !== 'hq' && FACTIONS[s.players[p].faction].graves && !graveAt(s, p, x, z)) return 'Undead buildings must stand on your graves';
  // no building near an enemy building the side has seen (anti-rush; fog-fair: only what it knows),
  // except on the side's home ground (within the map's zone of its own HQ), so enemy creep can't shut
  // a side out of its own base
  const ownHq = (s.buildings || []).find(b => b.owner === p && b.type === 'hq' && b.hp > 0);
  const home = ownHq && edgeDist(ownHq, x, z) <= (s.board.zone || RULES.buildZone);
  if (type !== 'hq' && !home) for (const k of Object.values((s.intel && s.intel[p] && s.intel[p].known) || {})) {
    if (k.owner !== p && k.hp > 0 && edgeDist(k, x, z) < RULES.enemyBuildGap) return `Too close to an enemy building (${RULES.enemyBuildGap}″)`;
  }
  const live = (s.buildings || []).filter(b => b.hp > 0).concat(extra);
  if (d.site) {
    const sh = siteAt(s, x, z);
    if (!sh) return 'Must stand on a resource site';
    if (siteTaken(s, sh, extra)) return 'That site is already taken';
  } else {
    for (const sh of s.shrines || []) if (overlaps(f, { x: sh.x, z: sh.z, r: RULES.shrineRadius * 0.6 }, 0)) return 'Too close to a resource site';
  }
  for (const t of s.terrain) {
    if (t.kind === 'board') continue;
    if (t.kind === 'river') { if (Math.abs(x - t.x) < t.w / 2 + half) return 'Not in the stream'; continue; }
    const tf = t.r !== undefined ? { x: t.x, z: t.z, r: t.r } : { x: t.x, z: t.z, w: t.w, d: t.d };
    if (overlaps(f, tf, 0.2)) return 'Blocked by terrain';
  }
  for (const b of live) if (overlaps(f, b, 0.3)) return 'Too close to another building';
  // only enemy squads block: your own squads make way when the site starts (pushOut)
  if (squads) for (const q of s.squads) if (q.hp > 0 && q.owner !== p && overlaps(f, { x: q.x, z: q.z, r: squadRadius(unitDef(q.faction, q.role, q.tk), q.models) }, 0.1)) return 'An enemy squad is standing there';
  const count = t => live.filter(b => b.owner === p && b.type === t).length;
  if (type === 'banner' && count('banner') >= RULES.maxBannerCp) return `At most ${RULES.maxBannerCp} ${d.name[s.players[p].faction].toLowerCase()}s`;
  return '';
}
// own squads standing on a new building's footprint move to the nearest free spot outside it
export function pushOut(s, b, ev = () => {}) {
  const O = obstacles(s);
  const rOf = q => squadRadius(unitDef(q.faction, q.role, q.tk), q.models);
  for (const q of s.squads) {
    if (q.hp <= 0 || q.owner !== b.owner) continue;
    const r = rOf(q);
    if (!overlaps(b, { x: q.x, z: q.z, r }, 0.05)) continue;
    const free = (x, z) => !pointBlocked(O, x, z, r * 0.85) && !s.squads.some(o => o !== q && o.hp > 0 && dist(o.x, o.z, x, z) < r + rOf(o) - 0.1);
    const from = { x: q.x, z: q.z };
    let best = null, bd = 1e9;
    for (let ring = 0; ring < 10 && !best; ring++) for (let k = 0; k < 24; k++) {
      const a = k / 24 * Math.PI * 2, R = (b.r !== undefined ? b.r : Math.hypot(b.w, b.d) / 2) + r + 0.2 + ring * 0.5;
      const x = b.x + Math.cos(a) * R, z = b.z + Math.sin(a) * R;
      if (overlaps(b, { x, z, r }, 0.05) || !free(x, z)) continue;
      const d = dist(x, z, q.x, q.z);
      if (d < bd) { bd = d; best = { x, z }; }
    }
    if (!best) continue;
    q.x = Math.round(best.x * 100) / 100; q.z = Math.round(best.z * 100) / 100;
    ev({ type: 'pushed', id: q.id, bid: b.id, fx: from.x, fz: from.z, x: q.x, z: q.z });
  }
}
export function bannerCount(s, p) { return (s.buildings || []).filter(b => b.owner === p && b.type === 'banner' && b.hp > 0).length; }
export function bonusCp(s, p) {
  const own = (s.buildings || []).filter(b => b.owner === p && b.hp > 0 && !b.build);
  return Math.min(RULES.maxBannerCp, own.filter(b => b.type === 'banner').length) + own.filter(b => b.type === 'hq').reduce((n, b) => n + (bdef(b).cp || 0), 0);   // + the Citadel
}
export const isBuilder = q => q.role === 'builder';
export function builderCount(s, p) { return s.squads.filter(q => q.owner === p && q.hp > 0 && isBuilder(q)).length + (s.buildings || []).filter(b => b.owner === p && b.train && b.train.role === 'builder').length; }
// squads counted against the army cap: builders (their own cap) and summoned squads don't count
export const inArmy = q => !isBuilder(q) && !q.ttl;
// population a role takes when trained (a pair / three of a swarm counts each squad)
export const popCost = (fac, role, tk = '') => (unitDef(fac, role, tk).pop || 0) * pairOf(fac, role, tk);
// the side's population: its army squads plus the squads in training (builders, heroes and summons are free)
export function armySize(s, p) {
  const tk = tkOf(s, p), fac = s.players[p].faction;
  return s.squads.filter(q => q.owner === p && q.hp > 0 && inArmy(q)).reduce((n, q) => n + (unitDef(q.faction, q.role, q.tk).pop || 0), 0)
    + (s.buildings || []).filter(b => b.owner === p && b.train && b.train.role && b.train.role !== 'builder').reduce((n, b) => n + popCost(fac, b.train.role, tk), 0);
}
// undead grave ground of side p: graveyards around its buildings and leftover patches
export function graveCircles(s, p) {
  return (s.buildings || []).filter(b => b.owner === p && b.hp > 0 && b.grave > 0).map(b => ({ x: b.x, z: b.z, r: b.grave, b }))
    .concat(((s.graves && s.graves[p]) || []).map(g => ({ x: g.x, z: g.z, r: g.r, patch: g })));
}
// a living own Lich or Necromancer squad within `range` of (x, z)? (raising a Monolith)
export function casterNear(s, p, x, z, range) {
  return s.squads.some(q => q.owner === p && q.hp > 0 && (q.role === 'hero' || q.role === 'mage') && unitDef(q.faction, q.role, q.tk).mana && dist(q.x, q.z, x, z) <= range);
}
// has side p ever seen the ground at (x, z)? (no memory recorded: yes)
export function seenBy(s, p, x, z) {
  if (!s.explored || !s.board) return true;
  const i = Math.floor(x), j = Math.floor(z);
  if (i < 0 || j < 0 || i >= s.board.w || j >= s.board.h) return false;
  return s.explored[p][j * s.board.w + i] === '1';
}
export function graveAt(s, p, x, z) { return graveCircles(s, p).find(c => dist(c.x, c.z, x, z) <= c.r) || null; }
// n models died at (x, z) on graveyard c of side p: the graves spread a little where they died, as a
// small new grave area at the graveyard's nearest edge (pushed on past other grave ground it would sit
// inside). Areas that land near an earlier one merge with it (their areas add up). Returns the area.
export function spreadGraves(s, p, c, x, z, n) {
  let ux = x - c.x, uz = z - c.z;
  const l = Math.hypot(ux, uz);
  if (l < 0.05) { ux = p === 0 ? 1 : -1; uz = 0; } else { ux /= l; uz /= l; }   // died at the centre: toward the enemy
  const r = RULES.graveBlob * ruleOf(s, p, 'graveBlobMult', 1) * Math.sqrt(n), circles = graveCircles(s, p);
  let t = c.r;
  for (let i = 0; i < 120 && circles.some(o => dist(o.x, o.z, c.x + ux * t, c.z + uz * t) < o.r - r * 0.5); i++) t += 0.25;
  const W = s.board ? s.board.w : 48, H = s.board ? s.board.h : 32;
  const bx = Math.max(0, Math.min(W, c.x + ux * t)), bz = Math.max(0, Math.min(H, c.z + uz * t));
  const r3 = v => Math.round(v * 1000) / 1000;
  const near = s.graves[p].find(g => g.blob && dist(g.x, g.z, bx, bz) < (g.r + r) * 0.6);
  if (near) {
    const a1 = near.r * near.r, a2 = r * r, A = a1 + a2;
    near.x = r3((near.x * a1 + bx * a2) / A); near.z = r3((near.z * a1 + bz * a2) / A); near.r = r3(Math.sqrt(A));
    return near;
  }
  const g = { x: r3(bx), z: r3(bz), r: r3(r), blob: true };
  s.graves[p].push(g);
  return g;
}
// does side p's faction raise buildings out of the ground (no builders)?
export const rises = (s, p) => !!FACTIONS[s.players[p].faction].rises;
// income per round for side p (finished buildings only)
// the flat income a side earns at the end of a round, by source (before the Brutal multiplier):
// { hq, mine, well, farm, other } amounts and how many buildings pay into each
export function incomeParts(s, p) {
  const eco = FACTIONS[s.players[p].faction].eco;
  const out = { hq: 0, mine: 0, well: 0, farm: 0, other: 0, count: { mine: 0, well: 0, farm: 0, other: 0 } };
  for (const b of s.buildings || []) {
    if (b.owner !== p || b.hp <= 0 || b.build) continue;
    if (b.type === 'hq') { out.hq += eco.hq + ruleOf(s, p, 'hqIncome'); continue; }
    const v = (bdef(b).income || 0) + (b.type === 'farm' ? ruleOf(s, p, 'farmIncome') : b.type === 'mine' ? ruleOf(s, p, 'mineIncome') : b.type === 'well' ? ruleOf(s, p, 'wellIncome') : 0);
    if (!v) continue;
    const k = b.type in out.count ? b.type : 'other';
    out[k] += v; out.count[k]++;
  }
  // upkeep (Dawn of War style): the army costs a little every round, never more than the flat income
  out.pop = armySize(s, p);
  out.upkeep = Math.min(out.hq + out.mine + out.well + out.farm + out.other, Math.floor(Math.max(0, out.pop - RULES.upkeepFree) * RULES.upkeepPerPop));
  return out;
}
export function incomeOf(s, p) {
  const P = incomeParts(s, p);
  return Math.round((P.hq + P.mine + P.well + P.farm + P.other - P.upkeep) * (s.players[p].incomeMult || 1));   // Brutal AI
}
// souls lost to decay at the end of a round with `bank` souls banked (above RULES.soulKeep)
export const soulDecayOf = bank => Math.max(0, Math.floor((bank - RULES.soulKeep) * RULES.soulDecay));
// AP of builder work per 1 resource when gathering at building b (0 = can't gather there)
export function gatherRate(s, b) {
  if (!b || b.hp <= 0 || b.build) return 0;
  const r = FACTIONS[s.players[b.owner].faction].eco.gather[b.type] || 0;
  return r && b.type === 'farm' ? Math.max(1, r + ruleOf(s, b.owner, 'farmGather')) : r && b.type === 'mine' ? Math.max(1, r + ruleOf(s, b.owner, 'mineGather')) : r;
}
// can building b train `role` (ignoring supply)?
export function trainsRole(b, role, faction) { return trainsOf(b.type, faction).includes(role); }

// ---- production queues ------------------------------------------------------------------
// Two kinds: one base build queue per side (s.bq[p], items { qid, type, x, z, rot }) that free
// builders take from, and a queue of roles on every training building (b.queue). Items are paid
// when they start (at the start of a round); a queue whose front item can't start waits.
// training buildings and research buildings (they share one queue each)
export const trainers = (s, p) => (s.buildings || []).filter(b => b.owner === p && b.hp > 0 && !b.build && (trainsOf(b.type, s.players[p].faction).length || researchesAt(b.type, s.players[p].faction).length));
const qfoot = (it, p) => ({ type: it.type, x: it.x, z: it.z, rot: it.rot, owner: p, ...footprint(it.type, it.x, it.z, it.rot) });
export const buildQueue = (s, p) => (s.bq && s.bq[p]) || [];

// validate side p's queue orders. orders.queue = { builds?: full list, trains?: { bid: roles }, cancel?: [bid] }
// replaces lists; the legacy orders.builds / orders.trains are appended. Returns the new queues.
export function validateQueue(s, p, o = {}) {
  const fac = s.players[p].faction, oq = o.queue || {};
  const cur = buildQueue(s, p);
  const hasBuilder = builderCount(s, p) > 0 || rises(s, p);
  const src = Array.isArray(oq.builds) ? oq.builds : cur.concat(Array.isArray(o.builds) ? o.builds : []);
  const bq = [], ids = new Set();
  for (const it of src) {
    if (bq.length >= RULES.queueMaxBuild) break;
    const d = BUILDINGS[it?.type];
    if (!d || it.type === 'hq' || !hasBuilder) continue;
    const x = +it.x || 0, z = +it.z || 0, rot = it.rot ? 1 : 0;
    const qid = it.qid && !ids.has(it.qid) && cur.some(c => c.qid === it.qid) ? it.qid : null;
    // a new or moved item must fit; an item left where it was is checked when it starts (and dropped
    // there with an event if its spot became invalid)
    const same = qid && cur.some(c => c.qid === qid && c.type === it.type && c.x === x && c.z === z && c.rot === rot);
    if (!same && placeError(s, p, it.type, x, z, rot, bq.map(b => qfoot(b, p)), false)) continue;
    if (qid) ids.add(qid);
    bq.push({ qid, type: it.type, x, z, rot });
  }
  const tq = {}, legacy = Array.isArray(o.trains) ? o.trains : [];
  const queuedTech = [];   // research queued so far (each tech only once, doctrines exclusive)
  for (const b of trainers(s, p)) {
    const rep = oq.trains && oq.trains[b.id];
    const list = Array.isArray(rep) ? rep : (b.queue || []).concat(legacy.filter(t => t && t.bid === b.id).map(t => t.role));
    const ok = [], earlier = [];
    for (const r of list) {
      if (ok.length >= RULES.queueMax || typeof r !== 'string') continue;
      if (r.startsWith('tech:')) {
        const id = r.slice(5);
        if (techError(s, p, id, b, earlier, queuedTech)) continue;
        earlier.push(id); queuedTech.push(id); ok.push(r);
      } else if (trainCost(fac, r) && trainsRole(b, r, fac) && !gateOf(s, p, r)) ok.push(r);
    }
    tq[b.id] = ok;
  }
  const cancel = [...new Set((Array.isArray(oq.cancel) ? oq.cancel : []).filter(bid => trainers(s, p).some(b => b.id === bid && b.train)))];
  // repeat: { bid: role | null } locks a training building onto one role (it trains it whenever its queue is empty)
  const repeat = {};
  for (const [bid, role] of Object.entries(oq.repeat || {})) {
    const b = trainers(s, p).find(x => x.id === bid);
    if (b && (role === null || (typeof role === 'string' && trainCost(fac, role) && trainsRole(b, role, fac) && !gateOf(s, p, role)))) repeat[bid] = role;
  }
  return { bq, tq, cancel, repeat };
}

// put validated queues into the state (assigns ids to new items; cancelling training refunds it)
export function applyQueue(s, p, v, ev = () => {}) {
  s.bq = s.bq || [[], []];
  s.bq[p] = v.bq.map(it => ({ ...it, qid: it.qid || 'k' + (s.nextQid = (s.nextQid || 0) + 1) }));
  for (const b of trainers(s, p)) b.queue = (v.tq[b.id] || []).slice();
  for (const [bid, role] of Object.entries(v.repeat || {})) { const b = s.buildings.find(x => x.id === bid); if (role) b.repeat = role; else delete b.repeat; }
  for (const bid of v.cancel) {
    const b = s.buildings.find(x => x.id === bid);
    const refund = b.train.tech ? TECH[b.train.tech].cost : trainCost(s.players[p].faction, b.train.role);
    s.supply[p] += refund;
    ev({ type: 'trainCancel', id: b.id, role: b.train.role, tech: b.train.tech, owner: p, refund });
    b.train = null;
  }
}

// start what can start, in order: the build queue first, then each training building (by id).
// With opts.apply the state changes (pay, place sites, start training) and events go to opts.ev;
// without it this is a forecast for the UI. opts.bq / opts.tq / opts.cancel override the queues.
// Returns { builds: [{ qid, starts | wait, need | drop }], trains: { bid: [{ starts | wait, need }] } }.
//   waits: 'gold' / 'souls' (need = shortfall), 'builders' (every builder already has a site),
//   'blocked' (a squad stands on the spot), 'cap' (army cap), 'line' (behind an item that waits)
//   drop: the spot became invalid (terrain, building, site taken, limit): the item leaves the queue
export function startQueues(s, p, opts = {}) {
  const apply = !!opts.apply, ev = opts.ev || (() => {});
  const fac = s.players[p].faction, res = FACTIONS[fac].eco.res;
  const cancel = new Set(opts.cancel || []);
  let supply = s.supply[p];
  for (const b of s.buildings) if (cancel.has(b.id) && b.owner === p && b.train) supply += b.train.tech ? TECH[b.train.tech].cost : trainCost(fac, b.train.role);
  const out = { builds: [], trains: {} };
  // sites that can be under way at once: one per builder (undead: RULES.maxRising, they rise on their own)
  const crews = rises(s, p) ? RULES.maxRising : s.squads.filter(q => q.owner === p && q.hp > 0 && isBuilder(q)).length;
  let sites = s.buildings.filter(b => b.owner === p && b.hp > 0 && b.build > 0).length;
  const extra = [], keep = [];
  let line = false;
  for (const it of opts.bq || buildQueue(s, p)) {
    const d = BUILDINGS[it.type];
    const hard = placeError(s, p, it.type, it.x, it.z, it.rot, extra, false, false);
    if (hard) {
      out.builds.push({ qid: it.qid, drop: hard });
      if (apply) ev({ type: 'queueDrop', owner: p, qid: it.qid, btype: it.type, x: it.x, z: it.z, why: hard });
      continue;
    }
    let wait = '', need = 0;
    if (line) wait = 'line';
    else if (sites >= crews) wait = rises(s, p) ? 'rising' : 'builders';
    else if (supply < d.cost) { wait = res; need = d.cost - supply; }
    else if (placeError(s, p, it.type, it.x, it.z, it.rot, extra, true)) wait = 'blocked';
    if (wait) { out.builds.push({ qid: it.qid, wait, need }); keep.push(it); line = true; continue; }
    supply -= d.cost; sites++;
    out.builds.push({ qid: it.qid, starts: true });
    if (apply) {
      s.supply[p] -= d.cost;
      const b = addBuilding(s, p, it.type, it.x, it.z, it.rot, !d.work);
      pushOut(s, b, ev);   // own squads standing on the spot make way
      if (FACTIONS[fac].graves && d.grave) b.grave = Math.round(d.grave * RULES.graveStart * 1000) / 1000;   // graves spread at once
      ev({ type: 'construct', id: b.id, btype: b.type, owner: p, x: b.x, z: b.z, rot: b.rot, hp: b.hp, build: b.build, done: !b.build, qid: it.qid });
    } else extra.push(qfoot(it, p));
  }
  if (apply) s.bq[p] = keep;
  let army = armySize(s, p), nb = builderCount(s, p);
  for (const b of cancel.size ? s.buildings : []) if (cancel.has(b.id) && b.owner === p && b.train && b.train.role) { if (b.train.role === 'builder') nb--; else army -= popCost(fac, b.train.role, tkOf(s, p)); }
  for (const b of trainers(s, p).sort((a, c) => +a.id.slice(1) - +c.id.slice(1))) {
    const list = out.trains[b.id] = [];
    let busy = !!b.train && !cancel.has(b.id), started = false;
    // a locked (repeating) building trains its role whenever nothing else is queued
    const rep = opts.rep && b.id in opts.rep ? opts.rep[b.id] : b.repeat;
    const list0 = (opts.tq && opts.tq[b.id]) || b.queue || [];
    const fromRepeat = !list0.length && !!rep;
    for (const role of fromRepeat ? [rep] : list0) {
      if (busy) { list.push({ wait: 'line' }); continue; }
      if (role.startsWith('tech:')) {
        // research: paid when it starts; the building trains nothing meanwhile
        const id = role.slice(5), t = TECH[id];
        let wait = '', need = 0;
        if (!t || techError(s, p, id, b, [], [], true)) wait = 'needs';
        else if (supply < t.cost) { wait = res; need = t.cost - supply; }
        busy = true;
        if (wait) { list.push({ wait, need, why: t ? techError(s, p, id, b, [], [], true) : '' }); continue; }
        supply -= t.cost;
        list.push({ starts: true }); started = true;
        if (apply) {
          s.supply[p] -= t.cost;
          b.train = { tech: id, left: t.rounds, total: t.rounds };
          ev({ type: 'research', id: b.id, tech: id, owner: p });
        }
        continue;
      }
      const c = trainCost(fac, role), tk = tkOf(s, p);
      let wait = '', need = 0;
      if (gateOf(s, p, role)) wait = 'needs';
      else if (role !== 'builder' && army + popCost(fac, role, tk) > s.board.cap) wait = 'cap';
      else if (role === 'builder' && nb >= maxBuildersOf(fac)) wait = 'builders';
      else if (supply < c) { wait = res; need = c - supply; }
      busy = true;
      if (wait) { list.push({ wait, need }); continue; }
      supply -= c; if (role === 'builder') nb++; else army += popCost(fac, role, tk);
      list.push({ starts: true, repeat: fromRepeat }); started = true;
      if (apply) {
        s.supply[p] -= c;
        const n = role === 'fighter' && ruleOf(s, p, 'fastWarriors') ? 1 : RULES.trainRounds[role] || 2;
        b.train = { role, left: n, total: n };
        ev({ type: 'train', id: b.id, role, owner: p });
      }
    }
    if (apply && started && !fromRepeat) b.queue = b.queue.slice(1);
  }
  return out;
}

// a free spot next to a building for a newly trained squad (toward the enemy first)
export function spawnSpot(s, b, radius) {
  const dir = b.owner === 0 ? 1 : -1;
  const base = hitRadius(b) + radius + 0.4;
  const obs = obstacles(s);
  for (let ring = 0; ring < 3; ring++) for (let k = 0; k < 12; k++) {
    const a = (k % 2 ? 1 : -1) * Math.floor((k + 1) / 2) * Math.PI / 6;
    const r = base + ring * 1.2;
    const x = b.x + Math.cos(a) * r * dir, z = b.z + Math.sin(a) * r;
    if (pointBlocked(obs, x, z, radius)) continue;
    if (s.squads.some(q => q.hp > 0 && dist(q.x, q.z, x, z) < radius + squadRadius(unitDef(q.faction, q.role, q.tk), q.models) + 0.1)) continue;
    return { x, z };
  }
  return null;
}

// army value used for the round-limit tiebreak
export function armyValue(s, p) {
  let v = 0;
  for (const q of s.squads) if (q.owner === p && q.hp > 0) v += q.hp;
  for (const b of s.buildings || []) if (b.owner === p && b.hp > 0 && b.type === 'hq') v += b.hp * 2;   // only the HQ: farms and walls don't win battles
  return v;
}
export { BUILDINGS, trainCost };
