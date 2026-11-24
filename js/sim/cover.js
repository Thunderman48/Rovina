// Cover (Dawn of War style): squads take less damage while they stand in cover.
//  heavy : the squad stands in a ruin (its centre within its radius x 0.6 of the ruin), or right behind a
//          Palisade / Bone Fence (any owner; within 0.6" of it) with the attacker on the far side of it
//  light : the squad's centre stands in a forest
// Ranged hits are reduced by RULES.heavyCoverRanged / lightCoverRanged, melee hits by heavyCoverMelee
// (light cover does nothing against melee). Buildings never get cover.
import { RULES, squadRadius, unitDef } from '../data/units.js';
import { dist, inRect } from './geom.js';
import { edgeDist, obstacles } from './base.js';
import { pointBlocked } from './nav.js';

export const RANGED_HITS = ['volley', 'pierce', 'lob', 'storm', 'blast', 'thunder'];
export const MELEE_HITS_COVER = ['strike', 'swing', 'charge', 'parting', 'mighty', 'sweep', 'leap', 'riposte'];
const WALL_GAP = 0.6;

const rOf = q => squadRadius(unitDef(q.faction, q.role, q.tk), q.models);
const inRuin = (t, x, z, rq) => t.kind === 'ruin' && inRect(x, z, t, rq * 0.6);
const inForest = (t, x, z) => t.kind === 'forest' && dist(x, z, t.x, t.z) <= t.r;
// is (x,z) right behind wall b, seen from (fx,fz)? (the attacker is on the other side of its long axis)
function behindWall(b, x, z, rq, fx, fz) {
  if (edgeDist(b, x, z) - rq > WALL_GAP) return false;
  if (fx === undefined) return true;
  const alongX = b.w >= b.d;
  const me = alongX ? z - b.z : x - b.x, them = alongX ? fz - b.z : fx - b.x;
  return me * them < 0;
}

// the cover a squad of radius rq has at (x, z) against an attack from (fx, fz) (omit the source: any
// wall it hugs counts): 'heavy' | 'light' | null
export function coverAt(s, x, z, rq, fx, fz) {
  for (const t of s.terrain) if (inRuin(t, x, z, rq)) return 'heavy';
  for (const b of s.buildings || []) if (b.hp > 0 && b.type === 'wall' && behindWall(b, x, z, rq, fx, fz)) return 'heavy';
  for (const t of s.terrain) if (inForest(t, x, z)) return 'light';
  return null;
}
export const coverOf = (s, q, fx, fz) => coverAt(s, q.x, q.z, rOf(q), fx, fz);

// damage multiplier of a hit of `kind` on a squad with cover level `c`
export function coverMult(c, kind) {
  if (!c) return 1;
  if (RANGED_HITS.includes(kind)) return c === 'heavy' ? RULES.heavyCoverRanged : RULES.lightCoverRanged;
  if (MELEE_HITS_COVER.includes(kind)) return c === 'heavy' ? RULES.heavyCoverMelee : 1;
  return 1;
}

// free spots in cover within `R` of (x, z) for squad q, best first (heavy before light, then nearest).
// `from` (optional {x,z}) is where the enemy is, so wall spots are taken on the side away from it.
export function coverSpots(s, q, x, z, R, from = null) {
  const rq = rOf(q), O = obstacles(s), out = [];
  const add = (px, pz) => {
    if (dist(px, pz, x, z) > R || pointBlocked(O, px, pz, rq * 0.85)) return;
    if (s.squads.some(o => o !== q && o.hp > 0 && dist(o.x, o.z, px, pz) < rq + rOf(o) - 0.1)) return;
    const c = coverAt(s, px, pz, rq, from?.x, from?.z);
    if (c) out.push({ x: Math.round(px * 100) / 100, z: Math.round(pz * 100) / 100, cover: c, d: dist(px, pz, q.x, q.z) });
  };
  for (const t of s.terrain) {
    if (t.kind === 'ruin') {
      const alongX = t.w >= t.d, len = alongX ? t.w : t.d;
      for (let u = -len / 2 + 0.4; u <= len / 2 - 0.4 + 1e-6; u += 0.8) add(alongX ? t.x + u : t.x, alongX ? t.z : t.z + u);
    } else if (t.kind === 'forest') {
      add(t.x, t.z);
      for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; add(t.x + Math.cos(a) * t.r * 0.55, t.z + Math.sin(a) * t.r * 0.55); }
    }
  }
  for (const b of s.buildings || []) {
    if (b.hp <= 0 || b.type !== 'wall') continue;
    const alongX = b.w >= b.d, len = alongX ? b.w : b.d, off = (alongX ? b.d : b.w) / 2 + rq + 0.2;
    for (const side of [-1, 1]) for (let u = -len / 2 + 0.5; u <= len / 2 - 0.5 + 1e-6; u += 1) {
      add(alongX ? b.x + u : b.x + side * off, alongX ? b.z + side * off : b.z + u);
    }
  }
  return out.sort((a, b) => (a.cover === b.cover ? 0 : a.cover === 'heavy' ? -1 : 1) || a.d - b.d);
}
