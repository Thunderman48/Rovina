// Round resolution.
//  Both sides' orders are resolved together. Speed tiers act fastest -> slowest; inside a tier
//  every squad acts at once on a shared timeline where an action's AP cost is its duration.
//  Every attack is a non-targeted skillshot (Swing arc, Volley line, Lob circle, Charge lane,
//  Bone Blast circle). Its area is telegraphed for the whole wind-up and anything inside it
//  when it resolves is hit.
//  Tactics (M2): engagement (stepping away from an enemy melee squad costs AP and gives it a
//  parting blow), parry (negates the next melee hit and ripostes), overwatch (fires once at the
//  first enemy that moves in the front cone, in any tier), cover (forests halve volleys),
//  line of sight (walls and rocks stop volleys; lobs arc over), skill cooldowns.
// Produces the new state and a log used for scrubbable playback.
import { RULES, isMelee, isShooter, skillOf, cdOf, gatherSlotsOf, isMage, unitDef, meleeOf, isRangedSkill } from '../data/units.js';
import { dist, norm, segRect, segCircle } from './geom.js';
import { clone, defOf, radiusOf, modelsFor, speedOf } from './state.js';
import { validateOrders, actionCost } from './orders.js';
import { buildStancePlan } from './stances.js';
import { terrainFactor, pointBlocked, blocks, blocksMove, boardOf } from './nav.js';
import { visibleTo, canSee, updateIntel } from './vision.js';
import { obstacles, navKey, hitRadius, bdef, applyQueue, startQueues, graveAt, spreadGraves, finishTech, tkOf, ruleOf, spawnSpot, armyValue, incomeOf, incomeParts, soulDecayOf, edgeDist, gatherRate } from './base.js';
import { approachSpot, closestOn } from './builders.js';
import { coverOf, coverMult } from './cover.js';
import { Nav } from './nav.js';
import { statsOwners, recordStats } from './stats.js';
import { BUILDINGS, FACTIONS, trainCost } from '../data/units.js';
import { addSquad, freeSpot } from './state.js';

const r3 = v => Math.round(v * 1000) / 1000;
const MELEE_HITS = ['strike', 'swing', 'charge', 'parting'];

export function damageAfter(dmg, armor, defended) {
  const v = dmg * RULES.armorK / (RULES.armorK + armor) * (defended ? RULES.defendMult : 1);
  return Math.max(1, Math.round(v));
}

// Does a swing arc from origin o (facing d, radius R, cos half-angle ch) touch circle (c, rc)?
export function arcHits(ox, oz, dx, dz, R, ch, cx, cz, rc) {
  const vx = cx - ox, vz = cz - oz;
  const l = Math.sqrt(vx * vx + vz * vz);
  if (l - rc > R) return false;
  if (l <= rc) return true;
  const cosA = (vx * dx + vz * dz) / l;
  return cosA >= ch - rc / l;
}

// Fraction (0..1) along a->b where blocking terrain (walls, rocks) first cuts the line, or 1.
export function losCut(terrain, ax, az, bx, bz) {
  let tCut = 1;
  for (const t of terrain) {
    if (!blocks(t)) continue;
    const tt = t.r !== undefined ? segCircle(ax, az, bx, bz, t.x, t.z, t.r) : segRect(ax, az, bx, bz, t, 0);
    if (tt >= 0 && tt < tCut) tCut = tt;
  }
  return tCut;
}
// Is the target in cover from a shot along a->b (the line crosses a forest, or it stands in one)?
export function inCover(terrain, ax, az, bx, bz) {
  for (const t of terrain) {
    if (t.kind !== 'forest') continue;
    if (dist(bx, bz, t.x, t.z) < t.r) return true;
    const tt = segCircle(ax, az, bx, bz, t.x, t.z, t.r);
    if (tt >= 0 && tt < 1) return true;
  }
  return false;
}
// Aim point clamped to a maximum range from (ox,oz)
export function clampAim(ox, oz, x, z, range) {
  const d = norm(x - ox, z - oz);
  if (d.l <= range) return { x, z };
  return { x: ox + d.x * range, z: oz + d.z * range };
}
// Enemy melee squads this squad is engaged with
export function engagedWith(q, squads) {
  if (defOf(q).ghost) return [];
  const out = [];
  for (const e of squads) {
    if (e.owner === q.owner || e.hp <= 0 || !isMelee(defOf(e))) continue;
    if (dist(q.x, q.z, e.x, e.z) <= radiusOf(q) + radiusOf(e) + RULES.engageGap) out.push(e);
  }
  return out;
}

export function resolveRound(state0, ordersIn) {
  const s = clone(state0);
  const round = s.round;
  const statOwners = statsOwners(s), statBank = s.supply.slice();   // for the results screen
  updateIntel(s);
  const orders = [0, 1].map(p => validateOrders(s, p, ordersIn[p]));
  const log = { round, segments: [] };

  for (const p of [0, 1]) for (const [id, st] of Object.entries(orders[p].stances)) {
    const q = s.squads.find(x => x.id === id); if (q) q.stance = st;
  }
  for (const p of [0, 1]) for (const [id, v] of Object.entries(orders[p].auto || {})) {
    const q = s.squads.find(x => x.id === id); if (!q) continue;
    if (v) delete q.auto; else q.auto = false;      // auto skills: on unless switched off
  }
  // advance target points (setting one puts the squad on Advance)
  for (const p of [0, 1]) for (const [id, g] of Object.entries(orders[p].goals || {})) {
    const q = s.squads.find(x => x.id === id); if (!q) continue;
    if (g) { q.goal = g; q.stance = 'advance'; } else delete q.goal;
  }
  // production queues: apply this round's queue edits, then start what can start (paid now)
  const baseEvents = [];
  const bev = e => baseEvents.push(e);
  // cancelled sites (still under construction): removed, RULES.siteRefund of the cost back
  for (const p of [0, 1]) for (const id of orders[p].cancelSites || []) {
    const b = s.buildings.find(x => x.id === id);
    if (!b || b.owner !== p || b.hp <= 0 || !(b.build > 0)) continue;
    const refund = Math.floor(BUILDINGS[b.type].cost * RULES.siteRefund);
    s.supply[p] += refund;
    s.buildings = s.buildings.filter(x => x !== b);
    for (const q of s.squads) if (q.task?.bid === id) q.task = null;
    baseEvents.push({ type: 'siteCancel', id, owner: p, btype: b.type, refund });
  }
  for (const p of [0, 1]) if (orders[p].queue) applyQueue(s, p, orders[p].queue, bev);
  for (const p of [0, 1]) if (orders[p].queue) startQueues(s, p, { apply: true, ev: bev });
  // planning-time knowledge
  const snapshot = s.squads.filter(q => q.hp > 0).map(q => ({ ...q }));
  // fog: stance squads only react to enemies their side can see
  const seenBy = [visibleTo(s, 0), visibleTo(s, 1)];

  const rts = [];
  for (const q of s.squads) {
    if (q.hp <= 0) continue;
    const def = defOf(q);
    const direct = orders[q.owner].squads[q.id];
    const plan = direct || buildStancePlan(s, q, snapshot.filter(e => e.owner !== q.owner && seenBy[q.owner].has(e.id)), snapshot);
    // the skills it uses this round (auto skills prefer a different one next round)
    const sks = (plan.actions || []).map(x => x.kind).filter(k => skillOf(def, k));
    if (sks.length) q.lastSk = [...new Set(sks)]; else delete q.lastSk;
    rts.push({
      q, def, plan, direct: !!direct,
      actions: plan.actions.map(a => ({ ...a, cost: actionCost(q, a) })),
      tier: Math.max(RULES.minTier, def.tier + (plan.upgrades || 0)),
      idx: 0, el: 0, st: null,
      defends: def.defends + (plan.defends || 0),
      parry: !!plan.parry,
      watch: plan.overwatch ? { active: true } : null,
      mult: 1,
      armor: 0,                    // extra armour this round (Rally)
      stun0: q.stun || 0,          // stun carried over from last round
      parted: new Set(),           // enemies that already got a parting blow on this squad
      acted: false,
    });
  }
  rts.sort((a, b) => (a.q.id < b.q.id ? -1 : 1));
  const rtById = new Map(rts.map(r => [r.q.id, r]));

  let seg = null, T = 0;
  const ev = e => seg.events.push({ t: r3(T), ...e });
  const rec = (q, t) => {
    const tr = seg.tracks[q.id] || (seg.tracks[q.id] = []);
    const row = [r3(t), r3(q.x), r3(q.z), r3(q.fx), r3(q.fz)];
    const last = tr[tr.length - 1];
    if (last && last[0] === row[0]) tr[tr.length - 1] = row; else tr.push(row);
  };
  const living = () => s.squads.filter(q => q.hp > 0);
  s.buildings = s.buildings || [];
  const obs = () => obstacles(s);
  const rad = e => e.type ? hitRadius(e) : radiusOf(e);
  // buildings are hit by their real footprint (rect or circle), squads by their round base
  const isB = e => !!e.type;
  const edgeFrom = (e, x, z) => isB(e) ? edgeDist(e, x, z) : dist(x, z, e.x, e.z) - radiusOf(e);
  const segHit = (ax, az, bx, bz, e, pad) => isB(e) && e.r === undefined ? segRect(ax, az, bx, bz, e, pad) : segCircle(ax, az, bx, bz, e.x, e.z, (isB(e) ? e.r : radiusOf(e)) + pad);
  const inCircle = (e, cx, cz, R) => isB(e) ? edgeDist(e, cx, cz) <= R : dist(cx, cz, e.x, e.z) <= R + radiusOf(e) * 0.6;
  const inArc = (ox, oz, dx, dz, R, ch, e) => { if (!isB(e)) return arcHits(ox, oz, dx, dz, R, ch, e.x, e.z, radiusOf(e)); const c = closestOn(e, ox, oz); return arcHits(ox, oz, dx, dz, R, ch, c.x, c.z, 0); };
  // enemy squads and buildings (allBuildings: own buildings too, for things that block shots)
  const targets = (q, allBuildings = false) => s.squads.filter(e => e.hp > 0 && e.owner !== q.owner)
    .concat(s.buildings.filter(b => b.hp > 0 && (allBuildings || b.owner !== q.owner)));
  const unitAt = id => s.squads.find(x => x.id === id) || s.buildings.find(x => x.id === id);
  // passives on the attacker's side: Berserk (low HP: more damage), Rend stacks on it (less damage)
  const pv = q => (q && !q.type ? defOf(q).passive : null) || null;
  const lowHp = q => { const d = defOf(q); return q.hp < d.models * d.hpPer * pv(q).below; };
  const outMult = q => (pv(q)?.kind === 'berserk' && lowHp(q) ? pv(q).dmg : 1) * (q.rend ? 1 - q.rend.n * q.rend.dmg : 1);
  const atkDmg = (r, base) => base * r.q.models * r.mult * outMult(r.q);
  const RANGED_KINDS = ['volley', 'pierce', 'lob', 'storm', 'blast', 'thunder'];

  // ---- start: reveal tiers and what each squad prepared --------------------------
  seg = { kind: 'start', len: 0, tracks: {}, events: [] };
  for (const e of baseEvents) ev(e);
  for (const r of rts) {
    if (r.plan.overwatch) {
      const d = norm(r.plan.overwatch.x - r.q.x, r.plan.overwatch.z - r.q.z);
      if (d.l > 0.01) { r.q.fx = d.x; r.q.fz = d.z; rec(r.q, 0); }
    }
    ev({ type: 'prep', id: r.q.id, tier: r.tier, upgrades: r.plan.upgrades || 0, defends: r.defends, parry: r.parry, watch: !!r.watch, stance: r.direct ? null : r.q.stance });
    if (r.watch) ev({ type: 'watch', id: r.q.id, R: r.def.attack.range, ch: RULES.overwatchCos });
    // shield walls are braced from the start of the round (the AP is spent holding it)
    const wl = r.actions.find(x => x.kind === 'wall');
    if (wl) { r.wall = skillOf(r.def, 'wall'); ev({ type: 'wallOn', id: r.q.id, mult: r.wall.mult, ch: r.wall.cosHalf, R: r3(radiusOf(r.q) + 0.5) }); }
  }
  log.segments.push(seg);

  // ---- hits ---------------------------------------------------------------------
  let hits = [];
  const ledger = [0, 1].map(() => ({ gathered: {}, souls: 0, soulPlaces: 0 }));   // this round's income by source
  const deaths = [];       // models that fell: where and when (souls for the undead)
  const gatherers = new Map(); // building id -> builders gathering there this round
  function hitOne(h) {
    const q = h.dst, r = rtById.get(q.id);
    if (q.hp <= 0) return;
    if (q.type) {          // a building
      const dmg = damageAfter(h.dmg * RULES.siegeMult, bdef(q).armor, false);
      q.hp = Math.max(0, q.hp - dmg);
      ev({ type: 'hit', src: h.src, dst: q.id, dmg, raw: Math.round(h.dmg), kind: h.kind, hp: r3(q.hp), building: true });
      if (q.hp <= 0) ev({ type: 'bdown', id: q.id, btype: q.type, owner: q.owner });
      return;
    }
    if (r && r.parry && MELEE_HITS.includes(h.kind)) {
      r.parry = false;
      ev({ type: 'parry', id: q.id, src: h.src });
      const src = rtById.get(h.src);
      if (src && src.q.hp > 0) hitOne({ src: q.id, dst: src.q, dmg: atkDmg(r, r.def.attack.dmg) * RULES.riposteMult, kind: 'riposte' });
      return;
    }
    // locked shields: hits from the front arc are blunted
    let walled = false;
    if (r && r.wall) {
      const src = unitAt(h.src);
      if (src) { const d = norm(src.x - q.x, src.z - q.z); if (d.l > 1e-4 && d.x * q.fx + d.z * q.fz >= r.wall.cosHalf) walled = true; }
    }
    // cover where it stands now (walls only count against attacks from their far side)
    const hs = unitAt(h.src), cover = coverOf(s, q, hs?.x, hs?.z), cm = coverMult(cover, h.kind);
    // passives: the attacker's (src) and the target's (q)
    const ps = pv(hs), pq = pv(q), ranged = RANGED_KINDS.includes(h.kind);
    let pm = 1, armor = defOf(q).armor + (r ? r.armor : 0);
    if (ps?.kind === 'disciplined' && living().some(o => o.owner === hs.owner && o !== hs && engagedWith(o, [q]).length)) pm *= ps.mult;
    if (ps?.kind === 'ridedown' && (isShooter(defOf(q)) || isMage(defOf(q)))) pm *= ps.mult;
    if (ps?.kind === 'longshot' && hs && dist(hs.x, hs.z, q.x, q.z) >= ps.range) pm *= ps.mult;
    if (ps?.kind === 'pierce' && (h.kind === 'volley' || h.kind === 'pierce')) armor = Math.max(0, armor - ps.armor);
    if (pq?.kind === 'bulwark' && ranged) pm *= pq.mult;
    if (pq?.kind === 'berserk' && lowHp(q)) pm *= pq.taken;
    if (pq?.kind === 'militia' && s.buildings.some(b => b.owner === q.owner && b.hp > 0 && edgeDist(b, q.x, q.z) - radiusOf(q) <= pq.radius)) armor += pq.armor;
    if (pq?.kind === 'gravebound' && graveAt(s, q.owner, q.x, q.z)) armor += pq.armor;
    let defended = false;
    if (r && r.defends > 0) { r.defends--; defended = true; }
    if (ps?.kind === 'chill' && r && r.defends > 0) { r.defends--; ev({ type: 'chill', id: q.id, src: h.src }); }   // Chilling Touch strips a defend
    const dmg = damageAfter(h.dmg * cm * pm * (walled ? r.wall.mult : 1), armor, defended);
    const before = q.models;
    q.hp = Math.max(0, q.hp - dmg);
    q.models = modelsFor(q, q.hp);
    if (before > q.models && !q.ttl) deaths.push({ x: q.x, z: q.z, n: before - q.models, hero: defOf(q).models === 1, T, owner: q.owner });
    if (h.stun && q.hp > 0) { q.stun = Math.max(q.stun || 0, h.stun); ev({ type: 'stun', id: q.id, src: h.src, ap: h.stun }); }
    // Rend (Warbands): a stack on the target, until the end of its next round
    if (ps?.kind === 'rend' && q.hp > 0) {
      q.rend = { n: Math.min(ps.max, (q.rend?.n || 0) + 1), dmg: ps.dmg, ap: ps.ap, until: round + 1 };
      ev({ type: 'rend', id: q.id, src: h.src, n: q.rend.n });
    }
    // Soul Drain (the Lich): heals a share of the damage it dealt
    if (ps?.kind === 'drain' && hs.hp > 0) {
      const d = defOf(hs), add = Math.min(d.models * d.hpPer - hs.hp, Math.round(dmg * ps.share * 10) / 10);
      if (add > 0) { hs.hp = r3(hs.hp + add); hs.models = modelsFor(hs, hs.hp); ev({ type: 'heal', id: hs.id, amount: add, hp: hs.hp, models: hs.models, drain: true }); }
    }
    ev({ type: 'hit', src: h.src, dst: q.id, dmg, raw: Math.round(h.dmg), defended, cover: cm < 1 ? cover : null, walled, kind: h.kind, hp: q.hp, models: q.models, lost: before - q.models, defLeft: r ? r.defends : 0 });
  }
  function applyHits(batch) {
    const byDst = new Map();
    for (const h of batch) { if (!byDst.has(h.dst.id)) byDst.set(h.dst.id, []); byDst.get(h.dst.id).push(h); }
    for (const [, list] of byDst) {
      list.sort((a, b) => b.dmg - a.dmg); // strongest hit uses the defend / parry first
      for (const h of list) hitOne(h);
    }
  }
  function checkDeaths() {
    for (const q of s.squads) if (q.hp <= 0 && !q.dead) {
      q.dead = true;
      ev({ type: 'down', id: q.id });
      const r = rtById.get(q.id); if (r) { r.idx = r.actions.length; r.watch = null; }
    }
  }

  // ---- shooting helpers ---------------------------------------------------------
  // a volley line from (ox,oz) along d: first enemy on the line before a wall
  function volley(r, ox, oz, dx, dz, overwatch = false) {
    const q = r.q, at = r.def.attack;
    const bx = ox + dx * at.range, bz = oz + dz * at.range;
    const tCut = losCut(s.terrain, ox, oz, bx, bz);
    let best = null, bt = tCut;
    // the first enemy on the line (its own side's buildings never stop or weaken its shots)
    for (const e of targets(q)) {
      const tt = segHit(ox, oz, bx, bz, e, at.width / 2);
      if (tt >= 0 && tt < bt) { bt = tt; best = e; }
    }
    const ex = ox + (bx - ox) * bt, ez = oz + (bz - oz) * bt;
    if (best) hits.push({ src: q.id, dst: best, dmg: atkDmg(r, at.dmg), kind: 'volley' });
    ev({ type: 'release', id: q.id, kind: 'volley', hit: best ? [best.id] : [], ex: r3(ex), ez: r3(ez), blocked: !best && bt < 1, overwatch });
  }
  // a lobbed circle (or bone blast) at (cx,cz): everyone inside, walls don't matter
  function circleHit(r, kind, cx, cz, R, dmg, overwatch = false) {
    const q = r.q, struck = [];
    for (const e of targets(q)) {
      if (inCircle(e, cx, cz, R)) { hits.push({ src: q.id, dst: e, dmg, kind }); struck.push(e.id); }
    }
    ev({ type: 'release', id: q.id, kind, hit: struck, ex: r3(cx), ez: r3(cz), overwatch });
  }

  // put a jumping/teleporting squad down on the nearest free spot back along its line
  function land(q, ox, oz) {
    const rq = radiusOf(q);
    const free = (x, z) => !pointBlocked(obs(), x, z, rq * 0.85) && !living().some(o => o !== q && dist(x, z, o.x, o.z) < rq + radiusOf(o) - 0.05);
    if (free(q.x, q.z)) return;
    const d = norm(ox - q.x, oz - q.z);
    for (let k = 1; k <= 40; k++) {
      const t = k * 0.25;
      if (t > d.l) break;
      const x = q.x + d.x * t, z = q.z + d.z * t;
      if (free(x, z)) { q.x = x; q.z = z; return; }
    }
    q.x = ox; q.z = oz;
  }
  // a piercing bolt: every enemy on the line before a wall
  function pierce(r, ox, oz, dx, dz, sk) {
    const q = r.q;
    const bx = ox + dx * sk.range, bz = oz + dz * sk.range;
    const tCut = losCut(s.terrain, ox, oz, bx, bz), struck = [];
    for (const e of targets(q)) {
      const tt = segHit(ox, oz, bx, bz, e, sk.width / 2);
      if (tt >= 0 && tt < tCut) { hits.push({ src: q.id, dst: e, dmg: atkDmg(r, sk.dmg), kind: 'pierce' }); struck.push(e.id); }
    }
    ev({ type: 'release', id: q.id, kind: 'pierce', hit: struck, ex: r3(ox + (bx - ox) * tCut), ez: r3(oz + (bz - oz) * tCut), blocked: !struck.length && tCut < 1 });
  }

  // Dark Thunder: the first enemy squad at the aim point (in sight of the caster), then jumps to the
  // nearest enemy squad not yet struck, each jump weaker
  function thunder(r, cx, cz, sk) {
    const q = r.q, struck = [], chain = [{ x: r3(q.x), z: r3(q.z) }];
    let cur = null, bd = 1e9;
    for (const e of living()) {
      if (e.owner === q.owner) continue;
      const d = dist(cx, cz, e.x, e.z) - radiusOf(e);
      if (d <= sk.radius && d < bd && losCut(s.terrain, q.x, q.z, e.x, e.z) >= 1) { bd = d; cur = e; }
    }
    let dmg = atkDmg(r, sk.dmg);
    for (let i = 0; cur && i <= sk.jumps; i++) {
      hits.push({ src: q.id, dst: cur, dmg, kind: 'thunder' });
      struck.push(cur.id); chain.push({ x: r3(cur.x), z: r3(cur.z) });
      dmg *= sk.decay;
      const from = cur; cur = null; bd = 1e9;
      for (const e of living()) {
        if (e.owner === q.owner || struck.includes(e.id)) continue;
        const d = dist(from.x, from.z, e.x, e.z) - radiusOf(e) - radiusOf(from);
        if (d <= sk.jump && d < bd) { bd = d; cur = e; }
      }
    }
    ev({ type: 'release', id: q.id, kind: 'thunder', hit: struck, chain, ex: r3(cx), ez: r3(cz) });
  }
  // Corpse Explosion: one of the caster's summoned squads near the aim point bursts
  function explode(r, cx, cz, sk) {
    const q = r.q;
    let best = null, bd = 1e9;
    for (const o of living()) {
      if (o.owner !== q.owner || !o.ttl) continue;
      const d = dist(cx, cz, o.x, o.z) - radiusOf(o);
      if (d <= 1.5 && d < bd) { bd = d; best = o; }
    }
    if (!best) { ev({ type: 'fizzle', id: q.id, kind: 'explode', ex: r3(cx), ez: r3(cz) }); return; }
    const dmg = (sk.base + sk.perModel * best.models) * r.mult, struck = [];
    for (const e of targets(q)) if (inCircle(e, best.x, best.z, sk.radius)) { hits.push({ src: q.id, dst: e, dmg, kind: 'explode' }); struck.push(e.id); }
    best.hp = 0; best.models = 0;
    ev({ type: 'release', id: q.id, kind: 'explode', hit: struck, ex: r3(best.x), ez: r3(best.z), burst: best.id });
  }

  // Strike (melee target attack) at release: hit the chosen target if it is within reach; else, unless
  // locked in melee, lunge straight at it (up to RULES.strikeLunge AP of movement, stopping 0.9 x reach
  // from it, cut short by terrain, buildings and friends), then hit if it is in reach. A dead target:
  // the nearest enemy already in reach takes the hit instead.
  function strike(r, st) {
    // target order at release (since 2026-11-26, so a strike lands whenever an enemy can be reached):
    //  1. the named target, if in reach, or reachable by a lunge (not while locked with another enemy)
    //  2. else any enemy already in reach: one it is locked with first, then the one nearest the
    //     original target / aim point
    //  3. else (not locked) a lunge at the nearest enemy within reach + lunge
    //  4. else a miss
    const q = r.q, at = meleeOf(r.def), rq = radiusOf(q);
    const gapTo = e => edgeFrom(e, q.x, q.z) - rq;
    const locked = engagedWith(q, living());
    const lungeMax = speedOf(q) * RULES.strikeLunge * terrainFactor(s.terrain, q.x, q.z);
    let tg = st.tg ? unitAt(st.tg) : null;
    if (tg && tg.hp <= 0) tg = null;
    const ref = tg ? { x: tg.x, z: tg.z } : { x: st.ax ?? q.x, z: st.az ?? q.z };
    let lunge = 0;
    const doLunge = e => {
      const aimAt = isB(e) ? closestOn(e, q.x, q.z) : e;   // a building: its nearest edge
      const d = norm(aimAt.x - q.x, aimAt.z - q.z);
      const want = Math.min(lungeMax, gapTo(e) - at.reach * 0.9);
      const x0 = q.x, z0 = q.z;
      rec(q, T - 3);   // stands until just before the blow, then lunges (playback)
      // walk the line in small steps; stop before terrain or buildings. Friends don't stop it (like
      // ordinary moves, a lunge passes through its own lines; overlaps drift apart afterwards)
      const wedged = pointBlocked(obs(), x0, z0, rq * 0.85);   // already touching an obstacle: only stop at new ones
      for (let k = 1, n = Math.ceil(want / 0.1); k <= n; k++) {
        const l = Math.min(want, k * 0.1), x = x0 + d.x * l, z = z0 + d.z * l;
        if (!wedged && pointBlocked(obs(), x, z, rq * 0.85)) break;
        q.x = x; q.z = z; lunge = l;
      }
      if (lunge > 0) { q.fx = d.x; q.fz = d.z; rec(q, T); }
    };
    const reach = e => gapTo(e) <= at.reach + 1e-6;
    // 1. the named target
    if (tg && !reach(tg) && !locked.length && gapTo(tg) - at.reach <= lungeMax) doLunge(tg);
    if (!tg || !reach(tg)) {
      // 2. anything in reach (locked-with enemies first, then nearest the original target / aim)
      let alt = null, bs = 1e9;
      for (const e of targets(q)) {
        if (!reach(e)) continue;
        const sc = (locked.includes(e) ? 0 : 1000) + dist(ref.x, ref.z, e.x, e.z);
        if (sc < bs) { bs = sc; alt = e; }
      }
      if (alt) tg = alt;
      else if (!locked.length && !lunge) {
        // 3. lunge at the nearest enemy a lunge can reach
        let bd = at.reach + lungeMax; alt = null;
        for (const e of targets(q)) { const g = gapTo(e); if (g <= bd) { bd = g; alt = e; } }
        if (alt) { tg = alt; doLunge(alt); }
      }
    }
    if (tg && reach(tg)) {
      if (tg.x !== undefined) { const d = norm(tg.x - q.x, tg.z - q.z); if (d.l > 0.01) { q.fx = d.x; q.fz = d.z; } }
      hits.push({ src: q.id, dst: tg, dmg: atkDmg(r, at.dmg) * RULES.strikeMult, kind: 'strike' });
      ev({ type: 'release', id: q.id, kind: 'strike', hit: [tg.id], lunge: r3(lunge), ex: r3(q.x), ez: r3(q.z) });
    } else {
      let near = 99; for (const e of targets(q)) near = Math.min(near, gapTo(e));
      ev({ type: 'release', id: q.id, kind: 'strike', hit: [], miss: true, lunge: r3(lunge), ex: r3(q.x), ez: r3(q.z), gap: r3(near), locked: locked.length > 0 });
    }
  }

  // ---- one AP of an action ---------------------------------------------------------
  function step(r, moves, moved) {
    const q = r.q, def = r.def;
    let a = r.actions[r.idx];
    // stunned: nothing advances (no movement, no wind-up) until the stun has run out
    if (q.stun > 0) {
      if (!r.stunned) { r.stunned = true; ev({ type: 'stunned', id: q.id, ap: q.stun }); }
      q.stun--;
      if (r.stun0 > 0) r.stun0--;
      if (!q.stun) { delete q.stun; r.stunned = false; ev({ type: 'unstun', id: q.id }); }
      return;
    }
    // locked in melee: a shot (volley / lob) or a ranged skill becomes a melee strike at the nearest enemy
    // it is engaged with (nothing is spent on the skill: no mana, no cooldown)
    if (r.el === 0 && meleeOf(def) && (a.kind === 'volley' || a.kind === 'lob' || isRangedSkill(skillOf(def, a.kind)))) {
      const foes = engagedWith(q, living());
      if (foes.length) {
        const e = foes.sort((x, y) => dist(q.x, q.z, x.x, x.z) - dist(q.x, q.z, y.x, y.z))[0];
        const from = a.kind;
        a = r.actions[r.idx] = { kind: 'strike', t: e.id, x: e.x, z: e.z, cost: meleeOf(def).ap, from };
        ev({ type: 'toMelee', id: q.id, from, t: e.id });
      }
    }
    // chase: a strike that starts with its target (and every other enemy) beyond reach + lunge, and not
    // locked in melee, spends its AP walking after the target instead of swinging at nothing (melee units
    // follow their target, as in most RTS games). Without a valid target: the enemy nearest the aim (4").
    if (r.el === 0 && a.kind === 'strike') {
      const mr = meleeOf(def), rq = radiusOf(q), gap = e => edgeFrom(e, q.x, q.z) - rq;
      const far = mr.reach + speedOf(q) * RULES.strikeLunge;
      if (!targets(q).some(e => gap(e) <= far) && !engagedWith(q, living()).length) {
        let goal = a.t ? unitAt(a.t) : null;
        if (goal && (goal.hp <= 0 || goal.owner === q.owner || (!goal.type && !seenBy[q.owner].has(goal.id)))) goal = null;
        if (!goal) { let bd = 4; for (const e of targets(q)) { if (!e.type && !seenBy[q.owner].has(e.id)) continue; const d = edgeFrom(e, a.x, a.z); if (d <= bd) { bd = d; goal = e; } } }
        if (goal) {
          const to = isB(goal) ? closestOn(goal, q.x, q.z) : goal;
          const pts = Nav.for(obs(), rq, navKey(s)).path(q.x, q.z, to.x, to.z);
          if (pts.length) {
            a = r.actions[r.idx] = { kind: 'move', pts, cost: a.cost, chase: goal.id };
            ev({ type: 'chase', id: q.id, t: goal.id });
          }
        }
      }
    }
    if (r.el === 0) {
      r.st = { phase: 'go' };
      if (a.kind === 'move') r.st.pts = a.pts.map(p => ({ ...p }));
      const sk = skillOf(def, a.kind);
      if (sk && isMage(def)) {
        // mages pay mana when the cast starts (no cooldown); not enough mana: the spell fizzles
        if ((q.mana || 0) < sk.mana) { ev({ type: 'fizzle', id: q.id, kind: a.kind }); r.idx++; r.el = 0; r.st = null; return; }
        q.mana -= sk.mana;
        ev({ type: 'mana', id: q.id, mana: q.mana, spent: sk.mana });
      } else if (sk) q.cd = { ...(q.cd || {}), [a.kind]: sk.cd + 1 };
      r.st.sk = sk;
      const tele = (kind, extra) => ev({ type: 'tele', id: q.id, kind, ox: r3(q.x), oz: r3(q.z), dx: r3(q.fx), dz: r3(q.fz), t1: r3(T + a.cost), ...extra });
      const face = (x, z) => { const d = norm(x - q.x, z - q.z); if (d.l > 0.01) { q.fx = d.x; q.fz = d.z; } };
      if (a.kind === 'strike') {
        // target attack: the named enemy (a squad must have been visible to the side at round start),
        // else the enemy whose edge is closest to the aim point, within 2"
        let tg = a.t ? unitAt(a.t) : null;
        if (tg && (tg.hp <= 0 || tg.owner === q.owner || (!tg.type && !seenBy[q.owner].has(tg.id)))) tg = null;
        if (!tg) {
          let bd = 2;
          for (const e of targets(q)) { const d = edgeFrom(e, a.x, a.z); if (d <= bd) { bd = d; tg = e; } }
        }
        if (!tg) {
          const mr = meleeOf(def), rq = radiusOf(q);
          let bd = mr.reach + speedOf(q) * RULES.strikeLunge;
          for (const e of targets(q)) { const d = edgeFrom(e, q.x, q.z) - rq; if (d <= bd) { bd = d; tg = e; } }
        }
        r.st.tg = tg ? tg.id : null; r.st.ax = a.x; r.st.az = a.z;
        face(tg ? tg.x : a.x, tg ? tg.z : a.z);
        rec(q, T);
        tele('strike', tg ? { shape: 'target', tx: r3(tg.x), tz: r3(tg.z), R: r3(rad(tg)), tid: tg.id } : { shape: 'target', tx: r3(a.x), tz: r3(a.z), R: 0.5 });
      }
      if (a.kind === 'swing' || a.kind === 'volley' || a.kind === 'charge' || a.kind === 'pierce' || a.kind === 'mighty') {
        face(a.x, a.z);
        r.st.dx = q.fx; r.st.dz = q.fz; r.st.ox = q.x; r.st.oz = q.z;
        rec(q, T);
        const at = def.attack;
        if (a.kind === 'swing') tele('swing', { shape: 'arc', R: r3(radiusOf(q) + at.reach), ch: at.cosHalf });
        else if (a.kind === 'mighty') tele('mighty', { shape: 'arc', R: r3(radiusOf(q) + sk.reach), ch: sk.cosHalf });
        else if (a.kind === 'volley') tele('volley', { shape: 'line', len: at.range, w: at.width });
        else if (a.kind === 'pierce') tele('pierce', { shape: 'line', len: sk.range, w: sk.width });
        else {
          r.st.phase = 'wind'; r.st.travel = 0;
          tele('charge', { t1: r3(T + sk.wind), shape: 'line', len: sk.len, w: r3(radiusOf(q) * 2) });
        }
      }
      if (a.kind === 'lob' || a.kind === 'blast' || a.kind === 'storm' || a.kind === 'leap' || a.kind === 'step' || a.kind === 'summon' || a.kind === 'thunder' || a.kind === 'explode') {
        const range = a.kind === 'lob' ? def.attack.range : sk.range;
        const R = a.kind === 'lob' ? def.attack.radius : sk.radius || radiusOf(q) + 0.4;
        const c = clampAim(q.x, q.z, a.x, a.z, range);
        face(c.x, c.z); rec(q, T);
        r.st.cx = c.x; r.st.cz = c.z; r.st.ox = q.x; r.st.oz = q.z;
        const t1 = a.kind === 'leap' ? T + sk.flight : T + a.cost;
        ev({ type: 'tele', id: q.id, kind: a.kind, ox: r3(c.x), oz: r3(c.z), dx: r3(q.fx), dz: r3(q.fz), t1: r3(t1), shape: 'circle', R: r3(R) });
      }
      if (a.kind === 'rally' || a.kind === 'raise') tele(a.kind, { shape: 'circle', R: sk.radius });
      if (a.kind === 'sweep') tele('sweep', { shape: 'arc', R: r3(radiusOf(q) + sk.reach), ch: -1 });
      ev({ type: 'act', id: q.id, kind: a.kind, cost: a.cost });
    }
    r.el += 1;
    const st = r.st;
    if (a.kind === 'move' && st.phase === 'go') {
      // stepping away from an engaged enemy: stand and disengage first, taking parting blows
      if (!st.checked) {
        st.checked = true;
        const wp = st.pts[0];
        if (wp) {
          const dir = norm(wp.x - q.x, wp.z - q.z);
          const away = engagedWith(q, living()).filter(e => (e.x - q.x) * dir.x + (e.z - q.z) * dir.z < 0);
          if (away.length) {
            st.hold = RULES.disengageAP;
            ev({ type: 'disengage', id: q.id });
            for (const e of away) {
              if (r.parted.has(e.id)) continue;
              r.parted.add(e.id);
              const er = rtById.get(e.id);
              hits.push({ src: e.id, dst: q, dmg: defOf(e).attack.dmg * e.models * (er ? er.mult : 1) * RULES.partingMult, kind: 'parting' });
            }
          }
        }
      }
      if (st.hold > 0) st.hold--;
      else moves.push({ r, st, d: speedOf(q) * terrainFactor(s.terrain, q.x, q.z) });
    } else if (a.kind === 'charge') {
      if (st.phase === 'wind' && r.el >= st.sk.wind) st.phase = 'rush';
      else if (st.phase === 'rush') {
        const sk = st.sk, rq = radiusOf(q);
        const step = Math.min(speedOf(q) * 4.6 * terrainFactor(s.terrain, q.x, q.z), sk.len - st.travel);
        const nx = q.x + st.dx * step, nz = q.z + st.dz * step;
        // first enemy squad in the way takes the impact
        let hit = null, ht = 2;
        for (const e of targets(q)) {
          const tt = segHit(q.x, q.z, nx, nz, e, rq);
          if (tt >= 0 && tt < ht) { ht = tt; hit = e; }
        }
        // riders and wraiths weave through their own lines; only walls, rocks and the edge stop them
        const bump = (x, z) => pointBlocked(obs(), x, z, rq * 0.85);
        // when the charge ends on top of a friend, step aside to the nearest free spot
        const settle = () => {
          for (const o of living()) {
            if (o === q || o.owner !== q.owner) continue;
            const need = rq + radiusOf(o), d = dist(q.x, q.z, o.x, o.z);
            if (d >= need - 0.02) continue;
            const v = d > 1e-4 ? norm(q.x - o.x, q.z - o.z) : { x: -st.dz, z: st.dx };
            const tx = o.x + v.x * need, tz = o.z + v.z * need;
            if (!pointBlocked(obs(), tx, tz, rq * 0.85)) { q.x = tx; q.z = tz; }
          }
        };
        rec(q, T);
        if (hit) {
          const t = Math.max(0, ht - 0.01);
          q.x += (nx - q.x) * t; q.z += (nz - q.z) * t;
          hits.push({ src: q.id, dst: hit, dmg: atkDmg(r, sk.dmg), kind: 'charge' });
          settle();
          ev({ type: 'release', id: q.id, kind: 'charge', hit: [hit.id], ex: r3(q.x), ez: r3(q.z) });
          st.phase = 'done';
        } else if (bump(nx, nz)) {
          ev({ type: 'release', id: q.id, kind: 'charge', hit: [], ex: r3(q.x), ez: r3(q.z), blocked: true });
          st.phase = 'done';
        } else {
          q.x = nx; q.z = nz; st.travel += step;
          if (st.travel >= sk.len - 1e-6) { settle(); ev({ type: 'release', id: q.id, kind: 'charge', hit: [], ex: r3(q.x), ez: r3(q.z) }); st.phase = 'done'; }
        }
        moved.add(q.id);
        rec(q, T + 1);
        if (st.phase === 'rush' && r.el >= a.cost) { settle(); ev({ type: 'release', id: q.id, kind: 'charge', hit: [], ex: r3(q.x), ez: r3(q.z) }); st.phase = 'done'; }
      }
    } else if (a.kind === 'leap') {
      // a jump over everything: fly for `flight` AP, land, shove adjacent enemies back
      const sk = st.sk;
      if (st.phase === 'go') {
        const t = Math.min(1, r.el / sk.flight);
        rec(q, T);
        q.x = st.ox + (st.cx - st.ox) * t; q.z = st.oz + (st.cz - st.oz) * t;
        rec(q, T + 1); moved.add(q.id);
        if (t >= 1) {
          land(q, st.ox, st.oz);
          const pushed = [];
          for (const e of living()) {
            if (e.owner === q.owner) continue;
            const d = dist(q.x, q.z, e.x, e.z), need = radiusOf(q) + radiusOf(e) + 0.3;
            if (d >= need) continue;
            const v = d > 1e-4 ? norm(e.x - q.x, e.z - q.z) : { x: q.fx, z: q.fz };
            const tx = e.x + v.x * sk.shove, tz = e.z + v.z * sk.shove;
            if (!pointBlocked(obs(), tx, tz, radiusOf(e) * 0.85)) { rec(e, T); e.x = tx; e.z = tz; rec(e, T + 1); pushed.push(e.id); moved.add(e.id); }
          }
          // Leap Strike: the landing also hits every enemy close around it
          if (sk.dmg) for (const e of targets(q)) if (edgeFrom(e, q.x, q.z) <= radiusOf(q) + sk.radius) hits.push({ src: q.id, dst: e, dmg: atkDmg(r, sk.dmg), kind: 'leap' });
          ev({ type: 'land', id: q.id, kind: 'leap', ex: r3(q.x), ez: r3(q.z), pushed, dmg: !!sk.dmg });
          st.phase = 'done';
        }
      }
    } else if (a.kind === 'work') {
      // a builder: walk to the building (re-pathing around whatever is in the way), then
      // build it, repair it, or gather resources at it with the AP that is left
      if (st.target === undefined) {
        let best = null, bd = 1e9;
        for (const b of s.buildings) {
          if (b.owner !== q.owner || b.hp <= 0) continue;
          const d = dist(b.x, b.z, a.x, a.z);
          if (d < hitRadius(b) + 0.6 && d < bd) { bd = d; best = b; }
        }
        st.target = best;
        st.mode = !best ? null : best.build > 0 ? 'build' : best.hp < bdef(best).hp ? 'repair' : gatherRate(s, best) ? 'gather' : null;
        if (!st.mode && !st.failed) { st.failed = true; ev({ type: 'workFail', id: q.id, bid: best ? best.id : null }); }
        if (st.mode) q.task = { kind: st.mode, bid: best.id };   // remembered even while still walking there
        st.got = 0;
      }
      const b = st.target, bd0 = b && bdef(b);
      if (st.mode && b && b.hp > 0) {
        const gap = edgeDist(b, q.x, q.z) - radiusOf(q);
        if (gap > RULES.workReach) {
          // walk: (re)path when there is no path yet or no progress for a while
          if (!st.pts || !st.pts.length || (st.best !== undefined && gap >= st.best - 0.02 && r.el - st.bestAt > 8)) {
            const spot = approachSpot(s, b, q.x, q.z, radiusOf(q), q.id);
            const pts = spot ? Nav.for(obs(), radiusOf(q), navKey(s)).path(q.x, q.z, spot.x, spot.z) : [];
            if (!pts.length) { if (!st.failed) { st.failed = true; ev({ type: 'workFail', id: q.id, bid: b.id }); } st.mode = null; if (q.task?.bid === b.id) q.task = null; q.noReach = { ...(q.noReach || {}), [b.id]: s.round }; }   // unreachable: drop the task (and skip it for a few rounds)
            st.pts = pts; st.bestAt = r.el; st.best = gap;
          }
          if (gap < (st.best ?? 1e9) - 0.02) { st.best = gap; st.bestAt = r.el; }
          if (st.mode && st.pts.length) moves.push({ r, st, d: speedOf(q) * terrainFactor(s.terrain, q.x, q.z) });
        } else {
          if (!st.started) {
            // gathering: at most gatherSlotsOf(type) builders per building (farms 4, others 2)
            if (st.mode === 'gather') {
              const g = gatherers.get(b.id) || new Set();
              if (g.size >= gatherSlotsOf(b.type) && !g.has(q.id)) { ev({ type: 'workFail', id: q.id, bid: b.id, full: true }); st.mode = null; q.task = null; }
              else { g.add(q.id); gatherers.set(b.id, g); }
            }
            if (st.mode) {
              st.started = true;
              q.task = { kind: st.mode, bid: b.id };
              ev({ type: 'work', id: q.id, bid: b.id, mode: st.mode, repair: st.mode === 'repair' });
              const d = norm(b.x - q.x, b.z - q.z); if (d.l > 0.01) { q.fx = d.x; q.fz = d.z; rec(q, T); }
            }
          }
          if (st.mode === 'build' && b.build > 0) {
            b.build--;
            b.hp = Math.min(bd0.hp, b.hp + bd0.hp * (1 - RULES.siteHp) / bd0.work);
            if (b.build === 0) { b.hp = Math.round(b.hp); b.vision = bd0.vision; ev({ type: 'built', id: b.id, btype: b.type, owner: b.owner, by: q.id }); }
          } else if (st.mode === 'repair' || (st.mode === 'build' && b.hp < bd0.hp)) {
            b.hp = Math.min(bd0.hp, b.hp + bd0.hp / bd0.work);
            if (b.hp >= bd0.hp) ev({ type: 'repaired', id: b.id, by: q.id });
          } else if (st.mode === 'gather') st.got++;
          // done: the building is finished / repaired -> go back to gathering next
          if (st.mode !== 'gather' && !b.build && b.hp >= bd0.hp && q.task?.bid === b.id) q.task = null;
        }
      }
      if (r.el >= a.cost && st.mode === 'gather' && st.got > 0 && gatherRate(s, b) > 0) {
        // partial work carries over to the next round while the builder stays at it (a building
        // destroyed meanwhile pays nothing)
        const rate = gatherRate(s, b), acc = (q.gacc && q.gacc.bid === b.id ? q.gacc.ap : 0) + st.got;
        const amount = Math.floor(acc / rate);
        q.gacc = { bid: b.id, ap: acc - amount * rate };
        if (amount > 0) { s.supply[q.owner] += amount; ledger[q.owner].gathered[b.id] = (ledger[q.owner].gathered[b.id] || 0) + amount; ev({ type: 'gather', id: q.id, bid: b.id, owner: q.owner, amount }); }
        st.got = 0;
      }
    } else if (r.el >= a.cost && st.phase === 'go') {
      st.phase = 'done';
      const at = def.attack, sk = st.sk;
      if (a.kind === 'strike') strike(r, st);
      else if (a.kind === 'swing') {
        const R = radiusOf(q) + at.reach;
        const struck = [];
        for (const e of targets(q)) {
          if (inArc(st.ox, st.oz, st.dx, st.dz, R, at.cosHalf, e)) { hits.push({ src: q.id, dst: e, dmg: atkDmg(r, at.dmg), kind: 'swing' }); struck.push(e.id); }
        }
        ev({ type: 'release', id: q.id, kind: 'swing', hit: struck });
      } else if (a.kind === 'mighty') {
        const R = radiusOf(q) + sk.reach, struck = [];
        for (const e of targets(q)) {
          if (inArc(st.ox, st.oz, st.dx, st.dz, R, sk.cosHalf, e)) { hits.push({ src: q.id, dst: e, dmg: atkDmg(r, sk.dmg), kind: 'mighty', stun: sk.stun }); struck.push(e.id); }
        }
        ev({ type: 'release', id: q.id, kind: 'mighty', hit: struck });
      } else if (a.kind === 'summon') {
        // the summoned squads rise at once: they block and can be hit, but don't act this round
        ev({ type: 'release', id: q.id, kind: 'summon', hit: [], ex: r3(st.cx), ez: r3(st.cz), count: sk.count });
        for (let i = 0; i < sk.count; i++) {
          const ang = (i / sk.count) * Math.PI * 2 + 0.6, off = sk.count > 1 ? 0.9 : 0;
          const z = addSquad(s, q.owner, 'summon', st.cx + Math.cos(ang) * off, st.cz + Math.sin(ang) * off);
          z.fx = q.owner === 0 ? 1 : -1; z.stance = 'advance';   // summoned skeletons march on the enemy
          z.ttl = RULES.summonTtl + ruleOf(s, q.owner, 'summonTtl') + 1;                           // this round doesn't count toward its life
          freeSpot(s, z);
          ev({ type: 'spawn', id: z.id, bid: q.id, role: 'summon', owner: q.owner, x: r3(z.x), z: r3(z.z), fx: z.fx, summon: true, mid: true, faction: z.faction, paint: z.paint, models: z.models, hp: z.hp });
          rec(z, T);
        }
      } else if (a.kind === 'thunder') thunder(r, st.cx, st.cz, sk);
      else if (a.kind === 'explode') explode(r, st.cx, st.cz, sk);
      else if (a.kind === 'volley') volley(r, st.ox, st.oz, st.dx, st.dz);
      else if (a.kind === 'lob') circleHit(r, 'lob', st.cx, st.cz, at.radius, atkDmg(r, at.dmg));
      else if (a.kind === 'blast' || a.kind === 'storm') circleHit(r, a.kind, st.cx, st.cz, sk.radius, atkDmg(r, sk.dmg));
      else if (a.kind === 'pierce') pierce(r, st.ox, st.oz, st.dx, st.dz, sk);
      else if (a.kind === 'sweep') {
        const R = radiusOf(q) + sk.reach, struck = [];
        for (const e of targets(q)) {
          if (edgeFrom(e, q.x, q.z) <= R) { hits.push({ src: q.id, dst: e, dmg: atkDmg(r, sk.dmg), kind: 'sweep' }); struck.push(e.id); }
        }
        ev({ type: 'release', id: q.id, kind: 'sweep', hit: struck });
      } else if (a.kind === 'step') {
        // vanish and reappear: no parting blows
        rec(q, T);
        q.x = st.cx; q.z = st.cz; land(q, st.ox, st.oz);
        rec(q, T + 0.001); moved.add(q.id);
        ev({ type: 'land', id: q.id, kind: 'step', ex: r3(q.x), ez: r3(q.z), pushed: [] });
      } else if (a.kind === 'raise') {
        const ids = [];
        for (const o of living()) {
          if (o.owner !== q.owner) continue;
          const od = defOf(o);
          if (od.models <= 1 || o.models >= od.models) continue;
          if (dist(q.x, q.z, o.x, o.z) > sk.radius + radiusOf(o)) continue;
          o.hp = Math.min(od.models * od.hpPer, o.models * od.hpPer + od.hpPer);
          o.models = modelsFor(o, o.hp);
          ids.push(o.id);
        }
        ev({ type: 'raise', id: q.id, ids, hp: ids.map(id => living().find(o => o.id === id).hp), models: ids.map(id => living().find(o => o.id === id).models) });
      }
      else if (a.kind === 'rally') {
        const ids = [];
        for (const o of rts) {
          if (o.q.owner !== q.owner || o.q.hp <= 0) continue;
          if (dist(q.x, q.z, o.q.x, o.q.z) <= sk.radius + radiusOf(o.q)) { o.defends += sk.defends; o.mult = Math.max(o.mult, sk.dmgMult || 1); o.armor = Math.max(o.armor, sk.armor || 0); ids.push(o.q.id); }
        }
        ev({ type: 'buff', id: q.id, kind: 'rally', ids, armor: sk.armor || 0 });
      }
    }
    if (r.el >= a.cost) { r.idx++; r.el = 0; r.st = null; }
  }

  // Move every walking squad one AP along its path.
  //  - enemy squads block (that is how fights start); friendly squads let each other pass and
  //    spread apart again once they stop (separate), so lines don't jam
  //  - blocked: try sidesteps up to 90 degrees; after a few stuck steps, re-path around obstacles
  //  - a squad that somehow stands inside an obstacle may always step out of it
  function resolveMoves(moves, moved) {
    const all = living();
    for (const m of moves) {
      const q = m.r.q, st = m.st;
      if (!st.pts.length) { st.phase = 'arrived'; continue; }
      let left = m.d, cx = q.x, cz = q.z;
      while (left > 1e-6 && st.pts.length) {
        const wp = st.pts[0], dd = dist(cx, cz, wp.x, wp.z);
        if (dd <= left) { cx = wp.x; cz = wp.z; left -= dd; st.pts.shift(); }
        else { cx += (wp.x - cx) / dd * left; cz += (wp.z - cz) / dd * left; left = 0; }
      }
      const rq = radiusOf(q);
      const ethereal = !!defOf(q).ghost;
      const O = obs();
      const depth = (x, z) => { let d = 0; for (const t of O) { if (!blocksMove(t)) continue; const v = t.r !== undefined ? t.r + rq * 0.85 - dist(x, z, t.x, t.z) : Math.min(t.w / 2 + rq * 0.85 - Math.abs(x - t.x), t.d / 2 + rq * 0.85 - Math.abs(z - t.z)); if (v > d) d = v; } return d; };
      const stuckIn = pointBlocked(O, q.x, q.z, rq * 0.85);
      const d0 = stuckIn ? depth(q.x, q.z) : 0;
      const clear = (x, z) => {
        if (pointBlocked(O, x, z, rq * 0.85)) {
          const { w: W, h: H } = boardOf(O);
          if (!stuckIn || x < rq * 0.5 || z < rq * 0.5 || x > W - rq * 0.5 || z > H - rq * 0.5 || depth(x, z) >= d0 - 1e-3) return false;
        }
        if (ethereal) return true;          // wraiths drift through squads
        for (const o of all) if (o !== q && o.owner !== q.owner && dist(x, z, o.x, o.z) < rq + radiusOf(o) - 0.02 && dist(x, z, o.x, o.z) < dist(q.x, q.z, o.x, o.z)) return false;
        return true;
      };
      let nx = cx, nz = cz, ok = clear(nx, nz);
      // walked into contact with an enemy squad: stop here, the fight is on
      if (!ok && !ethereal && all.some(o => o.owner !== q.owner && dist(cx, cz, o.x, o.z) < rq + radiusOf(o) && dist(q.x, q.z, o.x, o.z) <= rq + radiusOf(o) + RULES.engageGap + 0.05)) {
        st.pts = []; st.phase = 'arrived'; continue;
      }
      if (!ok) {
        // sidestep around whatever is in the way: keep to one side (switching sides only after
        // being stuck for a while), so squads slide along walls instead of zig-zagging
        const vx = cx - q.x, vz = cz - q.z;
        if (!st.side) st.side = (q.id.charCodeAt(q.id.length - 1) % 2) ? 1 : -1;
        if ((st.stuck || 0) >= 4 && st.stuck % 4 === 0) st.side = -st.side;
        for (const a of [0.5, 0.9, 1.3]) {
          const c = Math.cos(a * st.side), sn = Math.sin(a * st.side);
          const tx = q.x + (vx * c - vz * sn), tz = q.z + (vx * sn + vz * c);
          if (clear(tx, tz)) { nx = tx; nz = tz; ok = true; break; }
        }
      }
      if (!ok) {
        st.stuck = (st.stuck || 0) + 1;
        const goal = st.pts[st.pts.length - 1];
        // nearly there and the spot is taken: call it arrived
        if (goal && st.pts.length <= 1 && dist(q.x, q.z, goal.x, goal.z) < rq * 3) { st.phase = 'arrived'; st.pts = []; continue; }
        // stuck on terrain or a building: find a new way round (at most every few AP)
        if (goal && st.stuck >= 3 && (st.repathAt === undefined || T - st.repathAt >= 6)) {
          st.repathAt = T;
          const pts = Nav.for(O, rq, navKey(s)).path(q.x, q.z, goal.x, goal.z);
          if (pts.length) st.pts = pts;
        }
        continue;
      }
      st.stuck = 0;
      rec(q, T);
      const d = norm(nx - q.x, nz - q.z);
      if (d.l > 1e-4) { q.fx = d.x; q.fz = d.z; moved.add(q.id); }
      q.x = nx; q.z = nz;
      rec(q, T + 1);
      if (!st.pts.length) st.phase = 'arrived';
    }
  }

  // friendly squads that ended up overlapping drift apart a little each AP. Only pairs that have both
  // stopped (walkers pass through without shoving anyone), and never into an enemy or an obstacle.
  function separate(walking) {
    const all = living().filter(q => !defOf(q).ghost);
    const O = obs();
    const push = new Map();
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
      const a = all[i], b = all[j];
      if (a.owner !== b.owner || walking.has(a.id) || walking.has(b.id)) continue;
      const need = radiusOf(a) + radiusOf(b) - 0.05, d = dist(a.x, a.z, b.x, b.z);
      if (d >= need) continue;
      const v = d > 1e-4 ? norm(a.x - b.x, a.z - b.z) : { x: a.id < b.id ? 1 : -1, z: 0 };
      const k = Math.min(0.06, (need - d) / 2 + 0.005);
      for (const [u, sg] of [[a, 1], [b, -1]]) { const p = push.get(u) || { x: 0, z: 0 }; p.x += v.x * k * sg; p.z += v.z * k * sg; push.set(u, p); }
    }
    // one net nudge per squad (so a squad between two friends doesn't jiggle back and forth)
    let any = false;
    for (const [u, p] of push) {
      const l = Math.hypot(p.x, p.z); if (l < 0.005) continue;
      const f = Math.min(1, 0.06 / l), tx = u.x + p.x * f, tz = u.z + p.z * f, ru = radiusOf(u);
      if (pointBlocked(O, tx, tz, ru * 0.85)) continue;
      if (all.some(e => e.owner !== u.owner && dist(tx, tz, e.x, e.z) < ru + radiusOf(e) + 0.05)) continue;
      rec(u, T); u.x = tx; u.z = tz; rec(u, T + 1); any = true;
    }
    return any;
  }

  // overwatch: any watcher fires once at the first enemy that moved inside its front cone
  function overwatch(moved) {
    if (!moved.size) return;
    for (const r of rts) {
      if (!r.watch || !r.watch.active || r.q.hp <= 0) continue;
      const q = r.q, at = r.def.attack;
      let best = null, bd = 1e9;
      for (const id of moved) {
        const e = rtById.get(id)?.q;
        if (!e || e.owner === q.owner || e.hp <= 0) continue;
        const d = dist(q.x, q.z, e.x, e.z);
        if (d - radiusOf(e) > at.range || d < 1e-6) continue;
        if (((e.x - q.x) * q.fx + (e.z - q.z) * q.fz) / d < RULES.overwatchCos) continue;
        if (at.kind === 'volley' && losCut(obs(), q.x, q.z, e.x, e.z) < 1) continue;
        if (d < bd) { bd = d; best = e; }
      }
      if (!best) continue;
      r.watch.active = false;
      ev({ type: 'watchEnd', id: q.id });
      if (at.kind === 'volley') { const d = norm(best.x - q.x, best.z - q.z); volley(r, q.x, q.z, d.x, d.z, true); }
      else circleHit(r, 'lob', best.x, best.z, at.radius, atkDmg(r, at.dmg), true);
    }
  }

  // ---- tiers fastest -> slowest -------------------------------------------------------
  const maxTier = 6 + RULES.maxUpgrades;
  for (let tier = maxTier; tier >= RULES.minTier; tier--) {
    const group = rts.filter(r => !r.acted && r.q.hp > 0 && r.tier === tier);
    if (!group.length) continue;
    for (const r of group) r.acted = true;
    seg = { kind: 'tier', tier, len: 0, tracks: {}, events: [], squads: group.map(r => r.q.id) };
    T = 0;
    let guard = 0;
    while (guard++ < 400) {
      const act = group.filter(r => r.q.hp > 0 && r.idx < r.actions.length);
      if (!act.length) break;
      hits = [];
      const moves = [], moved = new Set();
      for (const r of act) step(r, moves, moved);
      resolveMoves(moves, moved);
      separate(new Set(moves.filter(m => m.st.pts.length).map(m => m.r.q.id)));
      overwatch(moved);
      const batch = hits; hits = [];
      applyHits(batch);
      checkDeaths();
      T += 1;
    }
    // let squads that ended this tier on top of each other step apart
    for (let k = 0; k < 24 && separate(new Set()); k++) T += 1;
    seg.len = T;
    log.segments.push(seg);
  }

  // ---- buildings act last: towers and keeps fire at the nearest enemy squad they see ----
  const shooters = s.buildings.filter(b => b.hp > 0 && !b.build && bdef(b).fire);
  if (shooters.length && living().length) {
    seg = { kind: 'tier', tier: 0, len: 8, tracks: {}, events: [], squads: [] };
    T = 0; hits = [];
    const shots = [];
    for (const b of shooters) {
      const f = bdef(b).fire;
      let best = null, bd = 1e9;
      for (const e of living()) {
        if (e.owner === b.owner) continue;
        const d = dist(b.x, b.z, e.x, e.z) - radiusOf(e);
        if (d <= f.range && d < bd && canSee(obstacles(s).filter(t => t.x !== b.x || t.z !== b.z), b.x, b.z, f.range + radiusOf(e), e.x, e.z)) { bd = d; best = e; }
      }
      if (!best) continue;
      const dd = norm(best.x - b.x, best.z - b.z);
      ev({ type: 'tele', id: b.id, kind: 'volley', ox: r3(b.x), oz: r3(b.z), dx: r3(dd.x), dz: r3(dd.z), t1: 4, shape: 'line', len: f.range, w: 0.7 });
      shots.push({ b, e: best, dmg: f.dmg * 4 });
    }
    T = 4;
    for (const sh of shots) {
      if (sh.e.hp <= 0) continue;
      hits.push({ src: sh.b.id, dst: sh.e, dmg: sh.dmg, kind: 'volley' });
      ev({ type: 'release', id: sh.b.id, kind: 'volley', hit: [sh.e.id], ex: r3(sh.e.x), ez: r3(sh.e.z), building: true });
    }
    const batch = hits; hits = [];
    applyHits(batch); checkDeaths();
    if (shots.length) log.segments.push(seg);
  }

  // ---- end of round ----------------------------------------------------------------
  seg = { kind: 'end', len: 0, tracks: {}, events: [] };
  // a fallen hero leaves a revive zone where it fell
  s.revive = s.revive || [null, null];
  for (const q of s.squads) if (q.hp <= 0 && q.role === 'hero') {
    s.revive[q.owner] = { x: r3(q.x), z: r3(q.z), progress: 0, round };
    ev({ type: 'reviveZone', owner: q.owner, x: r3(q.x), z: r3(q.z) });
  }
  // a destroyed undead building leaves its graveyard behind
  s.graves = s.graves || [[], []];
  for (const b of s.buildings) if (b.hp <= 0 && b.grave > 0) s.graves[b.owner].push({ x: b.x, z: b.z, r: r3(b.grave) });
  s.squads = s.squads.filter(q => q.hp > 0);
  s.buildings = s.buildings.filter(b => b.hp > 0);
  for (const b of s.buildings) b.hp = Math.max(1, Math.round(b.hp));
  // training
  for (const b of s.buildings) {
    if (!b.train || --b.train.left > 0) continue;
    if (b.train.tech) {   // research done: the whole side gets it
      const id = b.train.tech; b.train = null;
      finishTech(s, b.owner, id);
      ev({ type: 'researched', id: b.id, tech: id, owner: b.owner });
      continue;
    }
    const role = b.train.role; b.train = null;
    const def = unitDef(s.players[b.owner].faction, role, tkOf(s, b.owner));
    const spot = spawnSpot(s, b, 0.5 + 0.42 * Math.sqrt(def.models) + (def.look === 'rider' || def.look === 'wraith' ? 0.12 : 0));
    if (!spot) { ev({ type: 'spawnFail', id: b.id, role }); continue; }
    // the undead swarm comes in pairs: the second squad stands next to the first
    for (let i = 0; i < (def.pair || 1); i++) {
      const q = addSquad(s, b.owner, role, spot.x, spot.z);
      if (i) freeSpot(s, q);
      ev({ type: 'spawn', id: q.id, bid: b.id, role, owner: b.owner, x: r3(q.x), z: r3(q.z) });
    }
  }
  // summoned squads crumble after their last round
  for (const q of s.squads) if (q.ttl && --q.ttl <= 0) { q.hp = 0; ev({ type: 'crumble', id: q.id }); }
  s.squads = s.squads.filter(q => q.hp > 0);
  // undead buildings rise out of the ground on their own, and finished ones mend
  for (const b of s.buildings) {
    if (!FACTIONS[s.players[b.owner].faction].rises) continue;
    const d = bdef(b);
    if (b.build > 0) {
      const w = Math.min(b.build, RULES.riseWork);
      b.build -= w;
      b.hp = Math.min(d.hp, Math.round(b.hp + d.hp * (1 - RULES.siteHp) * w / d.work));
      ev({ type: 'rise', id: b.id, build: b.build });
      if (b.build <= 0) { b.build = 0; b.vision = d.vision; ev({ type: 'built', id: b.id, btype: b.type, owner: b.owner, by: null }); }
    } else if (b.hp < d.hp && b.type !== 'hq') b.hp = Math.min(d.hp, Math.round(b.hp + d.hp * RULES.undeadMend));
  }
  // Monoliths heal friendly squads around them a little (HP per model alive; fallen models come back as HP fills)
  for (const b of s.buildings) {
    const hd = bdef(b).heal;
    if (!hd || b.build || b.hp <= 0) continue;
    for (const q of s.squads) {
      if (q.owner !== b.owner || q.hp <= 0 || q.ttl) continue;
      const d = defOf(q), max = d.models * d.hpPer;
      if (q.hp >= max || dist(q.x, q.z, b.x, b.z) - radiusOf(q) > hd.radius) continue;
      const add = Math.min(max - q.hp, hd.hp * Math.max(1, q.models));
      q.hp += add; q.models = modelsFor(q, q.hp);
      ev({ type: 'heal', id: q.id, bid: b.id, amount: add, hp: q.hp, models: q.models });
    }
  }
  // passives at the end of the round: Reassemble (Skeleton Warriors on own graves), Soul Siphon
  // (Necromancers: mana for enemy models dying close by), and Rend stacks running out
  for (const q of s.squads) {
    if (q.hp <= 0) continue;
    const pq = defOf(q).passive;
    if (pq?.kind === 'reassemble' && graveAt(s, q.owner, q.x, q.z)) {
      const d = defOf(q), max = d.models * d.hpPer, add = Math.min(max - q.hp, pq.hp * Math.max(1, q.models));
      if (add > 0) { q.hp += add; q.models = modelsFor(q, q.hp); ev({ type: 'heal', id: q.id, amount: add, hp: q.hp, models: q.models, reassemble: true }); }
    }
    if (pq?.kind === 'siphon' && q.mana !== undefined) {
      let n = 0;
      for (const dd of deaths) if (dd.owner !== q.owner && dist(dd.x, dd.z, q.x, q.z) <= pq.radius) n += dd.n;
      const add = Math.min(defOf(q).mana.max - q.mana, n * pq.mana);
      if (add > 0) { q.mana += add; ev({ type: 'mana', id: q.id, mana: q.mana, gained: add, siphon: true }); }
    }
    if (q.rend && q.rend.until <= round) { delete q.rend; ev({ type: 'rendEnd', id: q.id }); }
  }
  // mages regain mana; stun carried over from last round and still left is dropped, new stun carries once
  for (const q of s.squads) {
    const d = defOf(q);
    if (d.mana) q.mana = Math.min(d.mana.max, (q.mana || 0) + d.mana.regen);
    const r = rtById.get(q.id);
    if (q.stun > 0 && r && r.stun0 > 0) delete q.stun;
  }
  // resource sites belong to whoever has a finished mine / soul well on them
  for (const sh of s.shrines || []) {
    const b = s.buildings.find(b => bdef(b).site && !b.build && dist(b.x, b.z, sh.x, sh.z) < 0.6);
    const owner = b ? b.owner : -1;
    if (owner !== sh.owner) { sh.owner = owner; ev({ type: 'shrine', x: sh.x, z: sh.z, owner }); }
  }
  // souls: models (either side's, not summoned) that fell on the undead side's grave ground pay, and the
  // graves spread a little at that graveyard's nearest edge; then every undead building's graveyard
  // fills up to its reach
  for (const p of [0, 1]) {
    if (!FACTIONS[s.players[p].faction].graves) continue;
    for (const d of deaths) {
      const c = graveAt(s, p, d.x, d.z);
      if (!c) continue;
      const amount = d.hero ? RULES.soulPerHero : d.n * (RULES.soulPerModel + ruleOf(s, p, 'soulPerModel'));
      s.supply[p] += amount;
      ledger[p].souls += amount; ledger[p].soulPlaces++;
      ev({ type: 'souls', owner: p, x: r3(d.x), z: r3(d.z), amount });
      // the graves spread where they died: a small grave area at that graveyard's nearest edge
      const g = spreadGraves(s, p, c, d.x, d.z, d.n);
      ev({ type: 'graves', owner: p, x: g.x, z: g.z, r: g.r, blob: true });
    }
    // graves spread almost at once: every undead building (rising or finished) reaches its full graveyard
    for (const b of s.buildings) {
      if (b.owner !== p || !bdef(b).grave) continue;
      const cap = bdef(b).grave;
      if ((b.grave || 0) < cap) { b.grave = r3(cap); ev({ type: 'graves', id: b.id, r: b.grave }); }
    }
    // Plague of Graves (research): enemy squads standing on these graves lose HP per model (never the last HP)
    const drain = ruleOf(s, p, 'graveDrain');
    if (drain) for (const q of s.squads) {
      if (q.owner === p || q.hp <= 0 || !graveAt(s, p, q.x, q.z)) continue;
      const loss = Math.min(q.hp - 1, drain * q.models);
      if (loss <= 0) continue;
      q.hp = r3(q.hp - loss); q.models = modelsFor(q, q.hp);
      ev({ type: 'plague', id: q.id, owner: p, amount: loss, hp: q.hp, models: q.models });
    }
  }
  // revive: any of its squads standing in the zone at the end of a round adds progress; enemies inside don't stop it
  for (const p of [0, 1]) {
    const z = s.revive[p];
    if (!z || z.round === round) continue;
    if (s.squads.some(o => o.owner === p && o.hp > 0 && o.role !== 'builder' && !o.ttl && dist(o.x, o.z, z.x, z.z) - radiusOf(o) <= RULES.reviveRadius)) {
      z.progress++;
      ev({ type: 'reviveTick', owner: p, progress: z.progress, need: RULES.reviveRounds + ruleOf(s, p, 'reviveRounds') });
    }
    if (z.progress >= RULES.reviveRounds + ruleOf(s, p, 'reviveRounds')) {
      const h = addSquad(s, p, 'hero', z.x, z.z), hd = defOf(h);
      h.hp = Math.max(1, Math.round(hd.hpPer * RULES.reviveHp));
      freeSpot(s, h);
      s.revive[p] = null;
      ev({ type: 'revive', id: h.id, owner: p, x: r3(h.x), z: r3(h.z), hp: h.hp });
    }
  }
  // income, itemised (the economy panel shows these parts): the flat income, plus what was gathered and
  // harvested this round; then the Undead's souls above RULES.soulKeep decay
  for (const p of [0, 1]) {
    const inc = incomeOf(s, p), P = incomeParts(s, p);
    s.supply[p] += inc;
    const decay = FACTIONS[s.players[p].faction].graves ? soulDecayOf(s.supply[p]) : 0;
    s.supply[p] -= decay;
    const flat = P.hq + P.mine + P.well + P.farm + P.other - P.upkeep;
    ev({ type: 'income', owner: p, amount: inc, supply: s.supply[p], parts: { hq: P.hq, mine: P.mine, well: P.well, farm: P.farm, other: P.other, upkeep: P.upkeep, pop: P.pop, count: P.count, brutal: inc - flat, gathered: ledger[p].gathered, souls: ledger[p].souls, soulPlaces: ledger[p].soulPlaces, decay } });
  }
  updateIntel(s);
  for (const q of s.squads) {
    delete q.dead;
    const cd = {};
    for (const [k, v] of Object.entries(q.cd || {})) if (v > 1) cd[k] = v - 1;
    q.cd = cd;
  }
  // win: only by destroying the enemy HQ (test arenas without HQs: no squads left)
  const hasBase = s.buildings.some(b => b.type === 'hq');
  const lost = [0, 1].map(p => hasBase ? !s.buildings.some(b => b.owner === p && b.type === 'hq') : !s.squads.some(q => q.owner === p));
  if (lost[0] && lost[1]) s.winner = -1;
  else if (lost[0]) s.winner = 1;
  else if (lost[1]) s.winner = 0;
  // no round limit: the battle goes on until an HQ falls
  log.segments.push(seg);
  recordStats(s, log.segments.flatMap(g => g.events), statOwners, statBank, round);
  s.round++;
  return { state: s, log };
}
export { isShooter };
