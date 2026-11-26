// Automatic skill use: the rules the AI uses for its ordered squads, shared with stance squads that
// have "auto skills" on (q.auto !== false). Adds skill actions to `plan` and returns
// { left: AP left, charged: the squad charged into (its strikes are already added) or null }.
//  t: the squad's current target (a squad, or a target-like object { x, z, isHq? }); lead: aim offset
import { RULES, isShooter, skillOf, cdOf, isMage, isRangedSkill } from '../data/units.js';
import { defOf, radiusOf } from './state.js';
import { losCut, engagedWith } from './resolve.js';
import { dist } from './geom.js';

const rad = e => e.r ?? radiusOf(e);

export function autoSkills(s, q, t, enemies, mine, plan, left, lead = null) {
  const def = defOf(q), p = q.owner;
  if (!def.skills || !def.skills.length || !t) return { left, charged: null };
  const tx = t.x + (lead ? lead.x : 0), tz = t.z + (lead ? lead.z : 0);
  const gap = dist(q.x, q.z, t.x, t.z) - rad(t) - radiusOf(q);
  const engaged = engagedWith(q, enemies);
  let mana = q.mana || 0;
  // skills already in the plan this round (non-mages: once per round)
  const used = new Set(plan.actions.map(a => a.kind));
  const ready = kind => {
    const k = skillOf(def, kind);
    if (!k || left < k.ap) return null;
    if (engaged.length && isRangedSkill(k)) return null;   // locked in melee: no shooting skills
    return (isMage(def) ? mana >= k.mana : cdOf(q, kind) === 0 && !used.has(kind)) ? k : null;
  };
  const cast = (kind, x, z) => { const k = skillOf(def, kind); plan.actions.push({ kind, x, z }); left -= k.ap; used.add(kind); if (isMage(def)) mana -= k.mana; };
  const real = enemies.filter(e => !e.isHq && !e.building);
  const fighting = engaged.length > 0 || real.some(e => dist(e.x, e.z, q.x, q.z) < 6);
  const lastSk = new Set(q.lastSk || []);
  // Every usable skill becomes a candidate with a situational score; the best go first, as many as AP
  // (and mana) allow. A skill used last round scores lower, so squads rotate through their skills
  // instead of repeating one. Candidates are rebuilt after each cast (mana, AP and "once a round" change).
  const candidates = () => {
    const c = [];
    const add = (kind, score, x, z) => { const k = ready(kind); if (k) c.push({ kind, x, z, score: score - (lastSk.has(kind) ? 1.5 : 0) }); };
    const shooters = real.some(e => isShooter(defOf(e)) && dist(e.x, e.z, q.x, q.z) < defOf(e).attack.range + 2);
    // shield wall when shooters or a melee squad face us
    if (engaged.length || shooters) add('wall', 3 + engaged.length * 0.5, q.x, q.z);
    // step out of a losing melee
    if (engaged.length && q.hp < def.hpPer * 0.5) { const k = skillOf(def, 'step'); if (k) add('step', 4, q.x + (p === 0 ? -1 : 1) * k.range, q.z); }
    // raise fallen models nearby
    { const k = skillOf(def, 'raise'); if (k) { const n = mine.filter(o => defOf(o).models > 1 && o.models < defOf(o).models && dist(o.x, o.z, q.x, q.z) <= k.radius + radiusOf(o)).length; if (n) add('raise', 1.5 + n, q.x, q.z); } }
    // rally when a friend is close and a fight is on
    { const k = skillOf(def, 'rally'); if (k && fighting) { const n = mine.filter(o => o !== q && dist(o.x, o.z, q.x, q.z) <= k.radius + radiusOf(o)).length; if (n) add('rally', 1.5 + 0.4 * n, q.x, q.z); } }
    // leap into a target just out of reach
    { const k = skillOf(def, 'leap'); if (k && !engaged.length && gap > 1 && gap < k.range) { const d = Math.max(0.1, gap - 0.4), l = Math.max(0.1, dist(q.x, q.z, t.x, t.z)); add('leap', 2.2, q.x + (t.x - q.x) / l * d, q.z + (t.z - q.z) / l * d); } }
    // Mighty Swing (stuns) when the target stands in its wide arc (more for each extra enemy in reach)
    { const k = skillOf(def, 'mighty'); if (k && !t.isHq && !t.building && gap <= k.reach - 0.2) add('mighty', 2.5 + 0.5 * real.filter(e => e !== t && dist(e.x, e.z, q.x, q.z) - radiusOf(e) - radiusOf(q) <= k.reach).length, t.x, t.z); }
    if (skillOf(def, 'sweep')) { const k = skillOf(def, 'sweep'), n = real.filter(e => dist(e.x, e.z, q.x, q.z) <= radiusOf(q) + k.reach + radiusOf(e)).length; if (n >= 1) add('sweep', 1.5 + n, q.x, q.z); }
    // casters: burst a summoned squad among enemies (or about to crumble with an enemy next to it)
    { const k = skillOf(def, 'explode'); if (k) for (const o of s.squads.filter(o => o.owner === p && o.ttl && o.hp > 0 && dist(o.x, o.z, q.x, q.z) <= k.range)) {
      const n = real.filter(e => dist(e.x, e.z, o.x, o.z) <= k.radius + radiusOf(e) * 0.6).length;
      if (n >= 2 || (n >= 1 && (o.ttl <= 1 || o.hp < defOf(o).models * defOf(o).hpPer * 0.5))) add('explode', 1.5 + 1.2 * n, o.x, o.z);
    } }
    // casters: summon skeletons toward the enemy when it is close (first when none are out)
    { const k = skillOf(def, 'summon'); const out = s.squads.filter(o => o.owner === p && o.ttl && o.hp > 0).length;
      if (k && !t.isHq && gap < 12 && out < 4) { const l = Math.max(0.1, dist(q.x, q.z, t.x, t.z)), d = Math.min(k.range, Math.max(1.5, gap - 1)); add('summon', out ? 1.6 : 3, q.x + (t.x - q.x) / l * d, q.z + (t.z - q.z) / l * d); } }
    // casters: Dark Thunder at the target (more when it would finish it off)
    { const k = skillOf(def, 'thunder'); if (k && !t.isHq && !t.building && dist(q.x, q.z, t.x, t.z) - rad(t) <= k.range && losCut(s.terrain, q.x, q.z, t.x, t.z) >= 1) add('thunder', 2.2 + (t.hp && t.hp < k.dmg * 2 ? 1 : 0) - (used.has('thunder') ? 0.8 : 0), t.x, t.z); }
    // archers: Arrow Storm where squads are packed, a target hides behind something, or just on the target
    { const k = skillOf(def, 'storm'); if (k && dist(q.x, q.z, tx, tz) <= k.range + 1) { const packed = real.filter(e => dist(e.x, e.z, tx, tz) <= k.radius + radiusOf(e) * 0.6).length; add('storm', 1.2 + 0.8 * packed + (losCut(s.terrain, q.x, q.z, t.x, t.z) < 1 ? 1.5 : 0), tx, tz); } }
    // crossbows: piercing bolt along the line to the target (more for each extra enemy on the line)
    { const k = skillOf(def, 'pierce'); if (k && dist(q.x, q.z, tx, tz) - rad(t) <= k.range && losCut(s.terrain, q.x, q.z, t.x, t.z) >= 1) {
      const l = Math.max(0.1, dist(q.x, q.z, tx, tz)), ux = (tx - q.x) / l, uz = (tz - q.z) / l;
      const onLine = real.filter(e => { const a = (e.x - q.x) * ux + (e.z - q.z) * uz; return a > 0 && a < k.range && Math.abs((e.x - q.x) * uz - (e.z - q.z) * ux) < radiusOf(e) + k.width / 2; }).length;
      add('pierce', 1.8 + 0.7 * Math.max(0, onLine - 1), tx, tz); } }
    { const k = skillOf(def, 'blast'); if (k && dist(q.x, q.z, tx, tz) <= k.range + 1) add('blast', 2, tx, tz); }
    return c.filter(x => x.score > 0).sort((a, b) => b.score - a.score || (a.kind < b.kind ? -1 : 1));
  };
  for (let n = 0; n < 4; n++) {
    const best = candidates()[0];
    if (!best) break;
    cast(best.kind, best.x, best.z);
  }
  // charge: an enemy that still stands there when we act (a slower one, or one pinned in melee by one of
  // our squads) down a clear lane, then swing
  let charged = null;
  let sk = ready('charge');
  if (sk && !engaged.length) {
    charged = real.filter(e => {
      const g = dist(q.x, q.z, e.x, e.z) - radiusOf(e) - radiusOf(q);
      const stays = defOf(e).tier < def.tier || engagedWith(e, (mine || []).filter(o => o !== q)).length > 0;
      return stays && g > 0.5 && g < sk.len - 1 && losCut(s.terrain, q.x, q.z, e.x, e.z) >= 1;
    }).sort((a, b) => dist(q.x, q.z, a.x, a.z) - dist(q.x, q.z, b.x, b.z))[0] || null;
    if (charged) {
      cast('charge', charged.x, charged.z);
      while (left >= def.attack.ap) { plan.actions.push({ kind: 'strike', t: charged.id, x: charged.x, z: charged.z }); left -= def.attack.ap; }
    }
  }
  void RULES;
  return { left, charged };
}
