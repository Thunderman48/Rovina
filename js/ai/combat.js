// Combat prediction: who wins a fight between two groups, without simulating it.
// Lanchester's square law (as used for StarCraft bots by Stanescu, Barriga and Buro, AIIDE 2015): a
// group's fighting strength is its damage output times its staying power, so
//   strength = (sum of damage per 100 AP against the other side's average armour) x (sum of HP)
// and   ratio = strength(A) / strength(B)   (> 1: A is expected to win; about 1.2+ is a safe attack).
// Damage per 100 AP uses the real numbers: damageAfter (armour), models left, attack AP, defends
// (each blocks roughly one hit: the HP counts a little more), and towers / the HQ for buildings.
import { RULES } from '../data/units.js';
import { damageAfter } from '../sim/resolve.js';
import { defOf } from '../sim/state.js';
import { bdef } from '../sim/base.js';

// damage per 100 AP of squad q against `armor`
export function squadDpr(q, armor = 5) {
  const d = defOf(q), a = d.attack;
  if (!a) return 0;
  const hits = RULES.ap / Math.max(10, a.ap);
  return hits * damageAfter(a.dmg * Math.max(1, q.models) * (a.kind === 'strike' ? RULES.strikeMult : 1), armor) * (d.mana ? 1.5 : 1);   // casters: spells on top
}
const armorOf = q => defOf(q).armor || 0;
// a group's strength against another group (squads; buildings with fire count as shooters)
export function strength(group, vs) {
  if (!group.length) return 0;
  const sq = vs.filter(x => !x.building);
  const avgArm = sq.length ? sq.reduce((n, x) => n + armorOf(x), 0) / sq.length : 6;
  let dpr = 0, hp = 0;
  for (const x of group) {
    if (x.building) { const f = bdef(x).fire; if (f) dpr += 4 * damageAfter(f.dmg, avgArm); hp += x.hp * 0.5; continue; }
    dpr += squadDpr(x, avgArm);
    hp += x.hp * (1 + 0.15 * (defOf(x).defends || 0));
  }
  return dpr * hp;
}
// predicted ratio of A against B (B empty: a big number)
export function fightRatio(A, B) {
  const sa = strength(A, B), sb = strength(B, A);
  if (sb <= 0) return sa > 0 ? 99 : 1;
  return sa / sb;
}
// a quick strength value of one squad (for influence maps and sorting)
export function power(q) { return Math.sqrt(squadDpr(q, 5) * q.hp); }
