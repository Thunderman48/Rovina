// Tactics: turns tasks into orders, within the same rules as a player.
//  - Every squad gets its task as a stance + target point (Advance + goal, Retreat), like a player would.
//  - Command points go where hand control matters most (squads that can fight this round: hurt squads to
//    pull back, ranged squads to keep their distance, everyone to focus fire); the hero is free.
//  - Micro (by skill): focus fire shared between squads (kill what can be killed, the most dangerous
//    first, without overkill), ranged squads kite melee, hurt squads pull back toward safety, skills via
//    autoSkills, parry / defends on spare AP, aiming ahead of moving targets.
import { RULES, isShooter } from '../data/units.js';
import { emptyPlan, defOf, radiusOf, apFor } from '../sim/state.js';
import { meleePlan, trimPath } from '../sim/stances.js';
import { obstacles, navKey, bonusCp } from '../sim/base.js';
import { autoSkills } from '../sim/skills.js';
import { Nav } from '../sim/nav.js';
import { engagedWith, losCut } from '../sim/resolve.js';
import { squadDpr, power, fightRatio } from './combat.js';
import { dist } from '../sim/geom.js';

const speedIn = q => defOf(q).tier * RULES.moveFactor * RULES.ap;   // inches a round

export function tactics(K, P, skill, mem, inf, tasks, o, rnd) {
  const { s, p } = K;
  // 1. stances and target points for everyone (what squads without direct orders will do)
  for (const q of K.army) {
    const t = tasks.get(q.id);
    if (!t) continue;
    const stance = t.flee ? 'retreat' : t.mode;
    if (q.stance !== stance) o.stances[q.id] = stance;
    if (stance === 'advance' && t.goal && (!q.goal || dist(q.goal.x, q.goal.z, t.goal.x, t.goal.z) > 1.5)) o.goals[q.id] = { x: +t.goal.x.toFixed(2), z: +t.goal.z.toFixed(2) };
  }
  // 2. who gets hand control: squads that can reach a visible enemy this round
  const seen = K.enemies.filter(e => e.visible && e.role !== 'builder' || e.visible);
  const reachOf = q => speedIn(q) + (isShooter(defOf(q)) ? defOf(q).attack.range : 2) + 1;
  const near = q => seen.filter(e => dist(q.x, q.z, e.x, e.z) - radiusOf(e) - radiusOf(q) < reachOf(q));
  let cp = RULES.cp + bonusCp(s, p);
  const cands = K.army.filter(q => near(q).length).map(q => {
    const d = defOf(q), hurt = q.hp < d.models * d.hpPer * 0.35;
    const melee = seen.some(e => !isShooter(defOf(e)) && dist(q.x, q.z, e.x, e.z) - radiusOf(e) - radiusOf(q) < 3);
    const v = (hurt ? 3 : 0) + (isShooter(d) && melee && skill.kite ? 2.5 : 0) + power(q) / 20;
    return { q, v };
  }).sort((a, b) => b.v - a.v);
  const ordered = [];
  for (const c of cands) {
    if (c.q.role === 'hero') { ordered.push(c.q); continue; }
    if (cp <= 0) continue;
    cp--; ordered.push(c.q);
  }
  // 3. orders for the hand-controlled squads, sharing focus fire
  const assigned = new Map();   // enemy id -> damage already aimed at it this round
  const prev = mem.prev || {};
  mem.prev = {};
  for (const e of K.enemies) if (e.visible) mem.prev[e.id] = { x: e.x, z: e.z };
  const lead = e => {
    if (!skill.lead || !prev[e.id] || !e.visible) return null;
    return { x: (e.x - prev[e.id].x) * 0.5, z: (e.z - prev[e.id].z) * 0.5 };
  };
  const mine = K.all;
  for (const q of ordered) {
    const def = defOf(q), plan = emptyPlan();
    let left = apFor(q);
    const opts = near(q);
    if (!opts.length) continue;
    const sloppy = rnd() < skill.mistake;
    const dpr = e => squadDpr(q, defOf(e).armor || 0);
    // focus fire: the enemy we can hurt most for its HP and that hurts us most, not already covered
    const pick = () => {
      if (!skill.focus || sloppy) return opts.slice().sort((a, b) => dist(q.x, q.z, a.x, a.z) - dist(q.x, q.z, b.x, b.z))[0];
      return opts.map(e => {
        const left = e.hp - (assigned.get(e.id) || 0);
        const threat = squadDpr(e, def.armor || 0);
        const sc = left <= 0 ? -1 : (Math.min(1, dpr(e) / left) * 2 + threat / 30) - dist(q.x, q.z, e.x, e.z) * 0.05;
        return { e, sc };
      }).sort((a, b) => b.sc - a.sc)[0].e;
    };
    const t = pick();
    assigned.set(t.id, (assigned.get(t.id) || 0) + dpr(t));
    const L = lead(t);
    const nav = () => Nav.for(obstacles(s), radiusOf(q), navKey(s));
    // pull back: badly hurt and the fight here is lost -> walk toward safety, defend with what is left
    const local = opts.filter(e => dist(e.x, e.z, q.x, q.z) < 8);
    if (q.role !== 'hero' && !sloppy && q.hp < def.models * def.hpPer * 0.35 && fightRatio([q], local) < 0.8) {
      const back = { x: q.x + (p === 0 ? -4 : 4), z: q.z };
      const pts = nav().path(q.x, q.z, back.x, back.z);
      if (pts.length) { const ap = Math.min(left, 60); plan.actions.push({ kind: 'move', pts, ap }); left -= ap; }
      plan.defends = Math.min(RULES.maxDefends, Math.floor(left / RULES.defendCost));
      o.squads[q.id] = plan; continue;
    }
    if (def.parry && engagedWith(q, K.enemies).length) { plan.parry = true; left -= RULES.parryCost; }
    const auto = autoSkills(s, q, t, K.enemies, mine, plan, left, L);
    left = auto.left;
    if (auto.charged) { /* the charge and its swings are planned */ }
    else if (isShooter(def)) {
      const melee = opts.filter(e => !isShooter(defOf(e))).sort((a, b) => dist(q.x, q.z, a.x, a.z) - dist(q.x, q.z, b.x, b.z))[0];
      const mgap = melee ? dist(q.x, q.z, melee.x, melee.z) - radiusOf(melee) - radiusOf(q) : 99;
      // kite: a melee squad is close and we aren't locked in -> step back first, then shoot
      if (skill.kite && !sloppy && mgap < 2.6 && !engagedWith(q, K.enemies).length) {
        const ux = q.x - melee.x, uz = q.z - melee.z, l = Math.max(0.1, Math.hypot(ux, uz));
        const pts = nav().path(q.x, q.z, q.x + ux / l * 3, q.z + uz / l * 3);
        if (pts.length) { const ap = Math.min(left, 35); plan.actions.push({ kind: 'move', pts, ap }); left -= ap; }
      }
      const range = def.attack.range, gap = dist(q.x, q.z, t.x, t.z) - radiusOf(t);
      const blocked = def.attack.kind === 'volley' && losCut(s.terrain, q.x, q.z, t.x, t.z) < 1;
      if (gap > range * 0.95 || blocked) {
        const pts = trimPath(q.x, q.z, nav().path(q.x, q.z, t.x, t.z), range * (blocked ? 0.45 : 0.8));
        const ap = Math.min(left, 45);
        if (pts.length) { plan.actions.push({ kind: 'move', pts, ap }); left -= ap; }
      }
      const tx = t.x + (L ? L.x : 0), tz = t.z + (L ? L.z : 0);
      while (left >= def.attack.ap) { plan.actions.push({ kind: def.attack.kind, x: tx, z: tz }); left -= def.attack.ap; }
    } else left = meleePlan(s, q, t, plan, left, L);
    if (left >= RULES.defendCost) plan.defends = Math.min(RULES.maxDefends, Math.floor(left / RULES.defendCost));
    o.squads[q.id] = plan;
  }
}
