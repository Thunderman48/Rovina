// Strategy: picks a posture each round from utility scores weighted by the personality (Halo Wars 2 style
// strategy tables; utility-based personalities), with hysteresis so it doesn't flip every round.
//  build  : grow the economy and army, hold the staging point
//  attack : launch / continue the attack plan
//  defend : enemies at home (the alert manager's interrupt)
//  harass : raid with fast squads while building up
import { fightRatio } from './combat.js';
import { bdef, BUILDINGS, armySize } from '../sim/base.js';
import { dist } from '../sim/geom.js';

export function strategy(K, P, skill, mem) {
  const foes = K.enemies.filter(e => e.role !== 'builder' && !e.ttl);
  // what it believes the enemy army to be: what it sees now, but never less than 70 % of the most it
  // has seen at once (it doesn't forget an army just because it walked into the fog)
  mem.peakFoes = Math.max(Math.round((mem.peakFoes || 0) * 0.97), foes.length);
  const missing = Math.max(0, Math.round(mem.peakFoes * 0.7) - foes.length);
  const est = foes.concat(foes.slice(0, missing));
  const ratio = fightRatio(K.army, est.length ? est : []);
  // an attack also meets the enemy base's guns: its HQ (or the one it must have) and towers near it
  const base = K.ehq || K.hqSpots[0];
  const guns = K.known.filter(b => !b.build && bdef(b).fire && base && dist(b.x, b.z, base.x, base.z) < 12);
  if (!K.ehq) guns.push({ building: true, type: 'hq', hp: BUILDINGS.hq.hp, tk: '' });
  const atkRatio = fightRatio(K.army, est.concat(guns));
  const threat = K.threats.filter(e => e.role !== 'builder');
  const U = { build: 0.55 + 0.3 * P.greed + 0.2 * P.tech };
  // a small raid is left to the defense manager; only a real threat to the base pulls everything home
  if (threat.length) U.defend = 0.6 + 1.5 * Math.min(2, fightRatio(threat, K.army.filter(q => K.hq && Math.hypot(q.x - K.hq.x, q.z - K.hq.z) < 16)));
  const ready = K.round >= P.firstAttack.round && K.army.length >= P.firstAttack.army;
  const want = P.attackRatio + skill.edge;
  // a big army (24+ pop, about the old 18 squads) and a maxed-out one (the bank can't buy more) lean to attacking
  // near the population cap the bank can't buy more army: use it (maxed-out armies attack, as in most RTS AIs)
  const maxed = armySize(K.s, K.p) >= K.s.board.cap * 0.85;
  if (ready) U.attack = P.aggression * Math.min(2.2, atkRatio / want) + (armySize(K.s, K.p) >= 24 ? 0.4 : 0) + (K.round >= 30 ? 0.3 : 0) + (maxed ? 0.6 : 0);
  if (K.army.some(q => q.role === 'fast') && K.known.some(b => b.type === 'mine' || b.type === 'well' || b.type === 'farm')) U.harass = 0.45 * P.aggression + 0.1;
  let best = 'build';
  for (const [k, v] of Object.entries(U)) if (v > U[best]) best = k;
  const cur = mem.posture || 'build';
  // hysteresis: keep the current posture unless the new one is clearly better (defend always wins)
  const keep = U[cur] !== undefined && best !== 'defend' && U[best] < U[cur] + 0.15;
  mem.posture = keep ? cur : best;
  mem.ratio = ratio; mem.atkRatio = atkRatio;
  return mem.posture;
}
