// Influence maps (Zobrist; Louis et al.; standard in RTS AI): a coarse grid over the board where every
// known squad and building spreads its strength with a linear falloff. `own` and `threat` (enemy) maps
// tell the military manager which places are safe, contested or exposed: where to stage, where to
// retreat, which enemy targets are valuable and weakly defended.
import { power } from './combat.js';
import { bdef } from '../sim/base.js';

const CELL = 2, RADIUS = 9;

export class Influence {
  constructor(s, K) {
    this.w = Math.ceil(s.board.w / CELL); this.h = Math.ceil(s.board.h / CELL);
    this.own = new Float32Array(this.w * this.h); this.threat = new Float32Array(this.w * this.h);
    for (const q of K.army) this.add(this.own, q.x, q.z, power(q), RADIUS);
    for (const b of K.myB) if (bdef(b).fire) this.add(this.own, b.x, b.z, 12, bdef(b).fire.range);
    for (const e of K.enemies) this.add(this.threat, e.x, e.z, power(e), RADIUS);
    for (const b of K.known) if (bdef(b).fire && !b.build) this.add(this.threat, b.x, b.z, 12, bdef(b).fire.range + 1);
  }
  add(map, x, z, v, r) {
    const c0 = Math.floor(x / CELL), r0 = Math.floor(z / CELL), n = Math.ceil(r / CELL);
    for (let j = Math.max(0, r0 - n); j <= Math.min(this.h - 1, r0 + n); j++) for (let i = Math.max(0, c0 - n); i <= Math.min(this.w - 1, c0 + n); i++) {
      const d = Math.hypot((i + 0.5) * CELL - x, (j + 0.5) * CELL - z);
      if (d < r) map[j * this.w + i] += v * (1 - d / r);
    }
  }
  at(map, x, z) {
    const i = Math.min(this.w - 1, Math.max(0, Math.floor(x / CELL))), j = Math.min(this.h - 1, Math.max(0, Math.floor(z / CELL)));
    return map[j * this.w + i];
  }
  threatAt(x, z) { return this.at(this.threat, x, z); }
  ownAt(x, z) { return this.at(this.own, x, z); }
  // own minus enemy: > 0 is our ground, < 0 theirs
  balance(x, z) { return this.ownAt(x, z) - this.threatAt(x, z); }
}
