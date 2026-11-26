// Stuck-squad diagnostic: plays AI-vs-AI games and reports squads that started a move (or a builder
// walk) of 30+ AP in a round but ended it less than 0.3" from where they started, with the likely cause.
// node tools/stuck.mjs [--games 2] [--maps a,b] [--rounds 60] [--verbose]
import { createGame } from '../js/sim/state.js';
import { resolveRound } from '../js/sim/resolve.js';
import { aiOrders, aiMemory } from '../js/ai/ai.js';
import { MAP_ORDER } from '../js/data/maps.js';
import { obstacles, edgeDist } from '../js/sim/base.js';
import { pointBlocked } from '../js/sim/nav.js';
import { radiusOf } from '../js/sim/state.js';
import { dist } from '../js/sim/geom.js';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const GAMES = +arg('games', 2), ROUNDS = +arg('rounds', 60), MAPS = arg('maps', MAP_ORDER.join(',')).split(','), VERBOSE = argv.includes('--verbose');

export function stuckReport(games = GAMES, maps = MAPS, rounds = ROUNDS) {
  const out = { rounds: 0, stuck: 0, streak: 0, causes: {}, samples: [] };
  for (const map of maps) for (let seed = 1; seed <= games; seed++) {
    let s = createGame(seed, seed % 2 ? ['kingdom', 'undead'] : ['undead', 'kingdom'], map);
    const mem = [aiMemory(), aiMemory()], streak = {};
    while (s.winner === null && s.round < rounds) {
      const res = resolveRound(s, [aiOrders(s, 0, mem[0]), aiOrders(s, 1, mem[1])]);
      const evs = res.log.segments.flatMap(g => g.events);
      const walked = new Map();
      for (const e of evs) if (e.type === 'act' && (e.kind === 'move' || e.kind === 'work') && e.cost >= 30) walked.set(e.id, e.kind);
      for (const [id, kind] of walked) {
        const a = s.squads.find(q => q.id === id), b = res.state.squads.find(q => q.id === id);
        if (!a || !b || b.hp <= 0) continue;
        out.rounds++;
        // working, or a melee squad that ran into an enemy and fought it (contact fight, or any hit it dealt), isn't stuck
        const worked = evs.some(e => (e.type === 'gather' || e.type === 'built' || e.type === 'repaired' || e.type === 'contact') && (e.id === id || e.by === id) || (e.type === 'hit' && e.src === id));   // fighting (it dealt a hit) isn't being stuck
        if (dist(a.x, a.z, b.x, b.z) >= 0.3 || worked) { streak[id] = 0; continue; }
        if (kind === 'work' && evs.some(e => e.type === 'workTick' && e.id === id)) continue;
        // a builder standing at its building is working (gather ticks are paid at the end)
        if (kind === 'work' && (res.state.buildings || []).some(x => x.owner === b.owner && edgeDist(x, b.x, b.z) - radiusOf(b) < 0.8)) continue;
        out.stuck++;
        streak[id] = (streak[id] || 0) + 1;
        if (streak[id] >= 3) out.streak++;
        const O = obstacles(res.state), rq = radiusOf(b);
        const cause = pointBlocked(O, b.x, b.z, rq * 0.85) ? 'inside an obstacle'
          : res.state.squads.some(o => o.id !== id && o.hp > 0 && o.owner !== b.owner && dist(o.x, o.z, b.x, b.z) < rq + radiusOf(o) + 0.4) ? 'enemy in contact'
          : res.state.squads.some(o => o.id !== id && o.hp > 0 && o.owner === b.owner && dist(o.x, o.z, b.x, b.z) < rq + radiusOf(o) + 0.2) ? 'friend in the way'
          : 'terrain / no path';
        const key = b.role + ': ' + cause;
        out.causes[key] = (out.causes[key] || 0) + 1;
        if (out.samples.length < 40) out.samples.push(`${map} seed ${seed} round ${s.round} ${id} ${b.role} ${kind} at ${b.x.toFixed(1)},${b.z.toFixed(1)}: ${cause}`);
      }
      s = res.state;
    }
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = stuckReport();
  console.log(`walks checked ${r.rounds} · stuck ${r.stuck} (${(r.stuck / Math.max(1, r.rounds) * 100).toFixed(1)}%) · stuck 3+ rounds in a row ${r.streak}`);
  for (const [k, v] of Object.entries(r.causes).sort((a, b) => b[1] - a[1])) console.log('  ', v, k);
  if (VERBOSE) for (const l of r.samples) console.log('   ', l);
}
