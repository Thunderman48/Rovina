// The AI opponent: layered managers, after the AIs of real RTS games (UAlbertaBot's manager hierarchy,
// 0 A.D. Petra's queue / attack / defense managers, the Halo Wars 2 commander's strategy and alerts).
// Each round, from its own side's view only:
//   perception (what it knows) -> influence maps -> strategy (posture) -> economy & production (queue
//   manager) -> military (task per squad: defend, scout, raid, attack plan) -> tactics (orders + micro)
// Deterministic: everything random is seeded from the game seed, the round and the side.
// The old AI lives on in ./legacy.js as a benchmark.
import { emptyOrders } from '../sim/state.js';
import { perceive } from './perception.js';
import { Influence } from './influence.js';
import { strategy } from './strategy.js';
import { economy } from './economy.js';
import { military } from './military.js';
import { tactics } from './tactics.js';
import { learn } from './learning.js';
import { pickPersonality, skillOfLevel } from './personalities.js';

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function aiOrders(s, p, memory = aiMemory(), opts = {}) {
  const level = opts.level || memory.level || 'normal';
  memory.level = level;
  const P = aiPersonality(s, p, memory, opts), skill = skillOfLevel(level);
  const o = { ...emptyOrders(), goals: {} };
  const rnd = rng(((s.seed | 0) * 31 + s.round * 977 + p * 7) | 0);
  const K = perceive(s, p, memory, skill);
  learn(K, memory);
  const inf = new Influence(s, K);
  K.inf = inf;
  const posture = strategy(K, P, skill, memory);
  if (s.buildings) Object.assign(o, economy(K, P, skill, posture, memory, o));
  const tasks = military(K, P, skill, posture, memory, inf);
  tactics(K, P, skill, memory, inf, tasks, o, rnd);
  return o;
}

// the personality this AI plays (a seeded pick unless one is asked for); kept in its memory
export function aiPersonality(s, p, memory, opts = {}) {
  const fac = s.players[p].faction;
  if (!memory.personality || memory.personality.faction !== fac || (opts.personality && memory.personality.id !== opts.personality))
    memory.personality = { ...pickPersonality(fac, s.seed | 0, p, opts.personality), faction: fac };
  return memory.personality;
}

export function aiMemory() { return { seen: {}, prev: {} }; }
