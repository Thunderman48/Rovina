// Headless tests for the simulation. Run: node tests/sim.test.mjs
import { RULES, FACTIONS, BUILDINGS, trainCost, skillOf, pairOf, squadRadius } from '../js/data/units.js';
import { createGame, addSquad, defOf, radiusOf, emptyOrders, emptyPlan, apFor } from '../js/sim/state.js';
import { resolveRound, damageAfter, engagedWith, losCut } from '../js/sim/resolve.js';
import { cpUsage, validateOrders, actionCost } from '../js/sim/orders.js';
import { aiOrders, aiMemory, aiPersonality } from '../js/ai/ai.js';
import { legacyOrders, legacyMemory } from '../js/ai/legacy.js';
import { PERSONALITIES, SKILL, BRUTAL_INCOME, pickPersonality } from '../js/ai/personalities.js';
import { fightRatio } from '../js/ai/combat.js';
import { MATCHUPS } from '../js/ai/matchups.js';
import { canSee, visibleTo } from '../js/sim/vision.js';
import { soulDecayOf, incomeParts, edgeDist, placeError, addBuilding, incomeOf, obstacles, startQueues, armySize, spreadGraves, finishTech, techError, gateOf, validateQueue, bdef, bname, tkOf, ruleOf, bonusCp } from '../js/sim/base.js';
import { TECH } from '../js/data/tech.js';
import { builderPlan } from '../js/sim/builders.js';
import { coverOf, coverMult } from '../js/sim/cover.js';
import { stuckReport } from '../tools/stuck.mjs';
import { buildStancePlan } from '../js/sim/stances.js';
import { autoSkills } from '../js/sim/skills.js';
import { knownEnemyHq } from '../js/sim/vision.js';
import { Nav, walkAP, pointBlocked } from '../js/sim/nav.js';
import { MAPS, MAP_ORDER } from '../js/data/maps.js';

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { fail++; console.log('  FAIL ' + name + '\n       ' + (e.stack || e).toString().split('\n').slice(0, 3).join('\n       ')); }
}
function ok(c, msg = 'assertion failed') { if (!c) throw new Error(msg); }
const eq = (a, b, msg) => ok(a === b, `${msg || 'expected equal'}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);

// an empty board (open ground in the middle of the mat) with chosen squads
function arena(list) {
  const s = createGame(7);
  s.squads = []; s.nextId = 1;
  // HQs at fixed spots for the tests
  for (const b of s.buildings) { b.z = 16; b.x = b.owner === 0 ? 3.5 : 44.5; }
  for (const [owner, role, x, z, extra] of list) Object.assign(addSquad(s, owner, role, x, z), extra || {});
  s.explored = s.explored.map(g => '1'.repeat(g.length));   // the whole table counts as seen (tests of the seen rule set their own)
  return s;
}
const orders = (squads = {}, stances = {}) => ({ squads, stances });
const plan = (actions, extra = {}) => ({ ...emptyPlan(), actions, ...extra });
const holdAll = s => { const o = [orders(), orders()]; for (const q of s.squads) o[q.owner].stances[q.id] = 'hold'; return o; };
const events = log => log.segments.flatMap(sg => sg.events.map(e => ({ ...e, seg: sg })));

console.log('Simulation');

test('createGame deploys small starting armies (kingdom: hero, warrior, builder; undead: hero, a warband pair)', () => {
  const s = createGame(1);
  eq(s.squads.filter(q => q.owner === 0).map(q => q.role).sort().join(), 'builder,fighter,hero');
  eq(s.squads.filter(q => q.owner === 1).map(q => q.role).sort().join(), 'hero,swarm,swarm', 'the swarm deploys as a pair');
  for (const q of s.squads) { eq(q.models, defOf(q).models); eq(q.hp, defOf(q).models * defOf(q).hpPer); }
});

test('resolution is deterministic', () => {
  const run = () => {
    let s = createGame(42); const mem = [aiMemory(s), aiMemory(s)];
    const out = [];
    for (let r = 0; r < 6; r++) { const res = resolveRound(s, [aiOrders(s, 0, mem[0]), aiOrders(s, 1, mem[1])]); s = res.state; out.push(JSON.stringify(res.log)); }
    return JSON.stringify(s) + out.join('');
  };
  eq(run(), run(), 'two runs differ');
});

test('resolve does not mutate the input state', () => {
  const s = createGame(3); const before = JSON.stringify(s);
  resolveRound(s, [aiOrders(s, 0), aiOrders(s, 1)]);
  eq(JSON.stringify(s), before);
});

test('tiers act fastest first (6 before 5 before 4)', () => {
  const s = createGame(1);
  const { log } = resolveRound(s, [orders(), orders()]);
  const tiers = log.segments.filter(g => g.kind === 'tier').map(g => g.tier);
  for (let i = 1; i < tiers.length; i++) ok(tiers[i] < tiers[i - 1], 'order ' + tiers);
});

test('AP is time: a 40 AP move takes 40 steps and covers tier × moveFactor × 40 inches', () => {
  const s = arena([[0, 'fighter', 10, 16], [1, 'fighter', 40, 16]]);
  const o = holdAll(s);
  o[0].squads.q1 = plan([{ kind: 'move', pts: [{ x: 30, z: 16 }], ap: 40 }]);
  const { state, log } = resolveRound(s, o);
  const q = state.squads.find(x => x.id === 'q1');
  const want = defOf(q).tier * RULES.moveFactor * 40;
  ok(Math.abs(q.x - 10 - want) < 1e-6, `moved ${q.x - 10} want ${want}`);
  const seg = log.segments.find(g => g.kind === 'tier' && g.squads.includes('q1'));
  eq(seg.len, 40);
});

test('act earlier: an upgraded squad acts in a higher tier', () => {
  const s = arena([[0, 'fighter', 10, 16], [1, 'fighter', 40, 16]]);
  const o = holdAll(s);
  o[0].squads.q1 = plan([{ kind: 'wait', ap: 10 }], { upgrades: 1 });
  const { log } = resolveRound(s, o);
  const prep = events(log).find(e => e.type === 'prep' && e.id === 'q1');
  eq(prep.tier, defOf(s.squads[0]).tier + 1);
});

test('a strike hits its target; damage = per model × models × strikeMult', () => {
  const s = arena([[0, 'fighter', 20, 16], [1, 'fighter', 22.4, 16]]);
  const o = holdAll(s);
  delete o[1].stances.q2; o[1].stances.q2 = 'hold';
  o[0].squads.q1 = plan([{ kind: 'strike', t: 'q2', x: 22.4, z: 16 }]);
  const { log } = resolveRound(s, o);
  const hit = events(log).find(e => e.type === 'hit' && e.src === 'q1');
  ok(hit, 'no hit'); eq(hit.kind, 'strike');
  const def = defOf(s.squads[0]);
  eq(def.attack.kind, 'strike');
  eq(hit.raw, Math.round(def.attack.dmg * def.models * RULES.strikeMult));
});

test('a strike hits only its target (a target attack, not an area)', () => {
  const s = arena([[0, 'fighter', 20, 16], [1, 'fighter', 22.4, 15.2], [1, 'fighter', 22.4, 17.6]]);
  const o = holdAll(s);
  o[0].squads.q1 = plan([{ kind: 'strike', t: 'q3', x: 22.4, z: 17.6 }]);
  const { log } = resolveRound(s, o);
  const hits = events(log).filter(e => e.type === 'hit' && e.src === 'q1');
  eq(hits.map(h => h.dst).join(), 'q3');
});

test('a strike with no enemy near its aim point (and no target) whiffs', () => {
  const s = arena([[0, 'fighter', 20, 16], [1, 'fighter', 22.4, 16]]);
  const o = holdAll(s);
  o[0].squads.q1 = plan([{ kind: 'strike', x: 15, z: 16 }]);
  const { log } = resolveRound(s, o);
  ok(!events(log).some(e => e.type === 'hit' && e.src === 'q1'), 'should miss');
  ok(events(log).some(e => e.type === 'release' && e.id === 'q1' && e.miss), 'a miss event');
});

test('a strike lunges at a target that stepped out of reach (up to strikeLunge AP of movement)', () => {
  const s = arena([[0, 'fighter', 20, 16], [1, 'fighter', 24.4, 16]]);
  const o = holdAll(s);
  // the target stands just out of reach and walks 1" further away before the blow lands (not engaged)
  o[0].squads.q1 = plan([{ kind: 'strike', t: 'q2', x: 24.4, z: 16 }]);
  o[1].squads.q2 = plan([{ kind: 'move', pts: [{ x: 25.4, z: 16 }], ap: 17 }]);
  const { state, log } = resolveRound(s, o);
  const rel = events(log).find(e => e.type === 'release' && e.id === 'q1');
  ok(rel.lunge > 0 && rel.lunge <= defOf(s.squads[0]).tier * RULES.moveFactor * RULES.strikeLunge + 1e-6, 'lunged ' + rel.lunge);
  eq(rel.hit.join(), 'q2');
  ok(state.squads.find(q => q.id === 'q1').x > 20.05, 'the striker moved forward');
});

test('a faster squad that runs far enough escapes even the lunge', () => {
  // the enemy Wraiths (tier 6) move away well beyond reach + lunge before the tier-5 strike lands
  const s = arena([[0, 'fighter', 20, 16], [1, 'fast', 24.4, 16]]);
  const o = holdAll(s);
  o[0].squads.q1 = plan([{ kind: 'strike', t: 'q2', x: 24.4, z: 16 }]);
  o[1].squads.q2 = plan([{ kind: 'move', pts: [{ x: 30, z: 16 }], ap: 60 }]);
  const { log } = resolveRound(s, o);
  ok(!events(log).some(e => e.type === 'hit' && e.src === 'q1'), 'wraiths should have escaped');
});

test('no lunge while locked in melee with another enemy', () => {
  const s = arena([[0, 'fighter', 20, 16], [1, 'fighter', 20, 18.2], [1, 'fighter', 24.5, 16]]);
  const o = holdAll(s);
  o[0].squads.q1 = plan([{ kind: 'strike', t: 'q3', x: 24.5, z: 16 }]);
  const { state, log } = resolveRound(s, o);
  const rel = events(log).find(e => e.type === 'release' && e.id === 'q1');
  ok(rel.miss && !rel.lunge, 'missed without lunging');
  eq(state.squads.find(q => q.id === 'q1').x, 20);
});

test('a strike at a target that died hits another enemy in reach instead', () => {
  const s = arena([[0, 'fighter', 20, 16], [1, 'fighter', 22.4, 15.2], [1, 'fighter', 22.4, 17.6]]);
  s.squads[1].hp = 1; s.squads[1].models = 1;
  const o = holdAll(s);
  o[0].squads.q1 = plan([{ kind: 'strike', t: 'q2', x: 22.4, z: 15.2 }, { kind: 'strike', t: 'q2', x: 22.4, z: 15.2 }]);
  const { log } = resolveRound(s, o);
  const hits = events(log).filter(e => e.type === 'hit' && e.src === 'q1').map(h => h.dst);
  eq(hits.join(), 'q2,q3');
});

test('a strike cannot track a squad its side could not see (it falls back to the aim point)', () => {
  const s = arena([[0, 'fighter', 6, 3], [1, 'fighter', 44, 29]]);
  const o = holdAll(s);
  o[0].squads.q1 = plan([{ kind: 'strike', t: 'q2', x: 8, z: 3 }]);
  const { log } = resolveRound(s, o);
  const rel = events(log).find(e => e.type === 'release' && e.id === 'q1');
  ok(rel.miss && !rel.lunge, 'no hidden tracking');
});

test('an old swing order becomes a strike at its aim point', () => {
  const s = arena([[0, 'fighter', 20, 16], [1, 'fighter', 22.4, 16]]);
  const v = validateOrders(s, 0, { squads: { q1: plan([{ kind: 'strike', x: 22.4, z: 16 }]) }, stances: {} });
  eq(v.squads.q1.actions[0].kind, 'strike');
  const o = holdAll(s); o[0].squads.q1 = plan([{ kind: 'strike', x: 22.4, z: 16 }]);
  ok(events(resolveRound(s, o).log).some(e => e.type === 'hit' && e.src === 'q1' && e.kind === 'strike'), 'it hits');
});

test('buildings are hit by their real footprint, not a round approximation', () => {
  // an enemy Palisade 3 x 0.5 along x at (40, 6): a squad off its end, 1" clear of the footprint
  // edge + reach, can't strike it; one touching its long side can
  const s = arena([[0, 'fighter', 40, 6 + 0.25 + 1.34 + 0.6]]);
  const w = addBuilding(s, 1, 'wall', 40, 6, 0, true);
  const q = s.squads[0], reach = defOf(q).attack.reach;
  q.x = 40 + 1.5 + radiusOf(q) + reach + 1 + 1.9; q.z = 6;   // beyond reach + lunge off the end
  let o = holdAll(s); o[0].squads.q1 = plan([{ kind: 'strike', t: w.id, x: 40, z: 6 }]);
  ok(!events(resolveRound(s, o).log).some(e => e.type === 'hit' && e.dst === w.id), 'too far off the end');
  q.x = 40; q.z = 6 + 0.25 + radiusOf(q) + 0.2;
  o = holdAll(s); o[0].squads.q1 = plan([{ kind: 'strike', t: w.id, x: 40, z: 6 }]);
  ok(events(resolveRound(s, o).log).some(e => e.type === 'hit' && e.dst === w.id), 'touching the long side');
});

test('your own buildings never stop your shots; enemy buildings still take them', () => {
  const s = arena([[0, 'ranged', 30, 4], [1, 'fighter', 30, 14]]);
  const own = addBuilding(s, 0, 'tower', 30, 8, 0, true);
  let o = holdAll(s); o[0].squads.q1 = plan([{ kind: 'volley', x: 30, z: 14 }]);
  eq(events(resolveRound(s, o).log).find(e => e.type === 'release' && e.id === 'q1').hit.join(), 'q2', 'past its own tower');
  own.owner = 1;
  o = holdAll(s); o[0].squads.q1 = plan([{ kind: 'volley', x: 30, z: 14 }]);
  eq(events(resolveRound(s, o).log).find(e => e.type === 'release' && e.id === 'q1').hit.join(), own.id, 'an enemy tower soaks it');
});

test('a new site pushes your own squads out of its footprint', () => {
  const s = createGame(1, ['undead', 'kingdom'], 'crossing');
  const hq = s.buildings.find(b => b.owner === 0);
  const q = s.squads.find(x => x.owner === 0 && x.role !== 'hero');
  q.x = hq.x + 5; q.z = hq.z; s.supply[0] = 200;
  const r = resolveRound(s, [{ squads: {}, stances: {}, builds: [{ type: 'barracks', x: hq.x + 5, z: hq.z, rot: 0 }] }, { squads: {}, stances: {} }]);
  const b = r.state.buildings.find(x => x.owner === 0 && x.type === 'barracks');
  ok(b, 'the site started');
  const q2 = r.state.squads.find(x => x.id === q.id);
  ok(edgeDist(b, q2.x, q2.z) >= radiusOf(q2) - 0.1, 'the squad stands outside it');
  ok(events(r.log).some(e => e.type === 'pushed' && e.id === q.id), 'a pushed event');
});

test('strikes hit buildings', () => {
  const s = arena([[0, 'fighter', 40, 16]]);
  const hq = s.buildings.find(b => b.owner === 1);
  const o = holdAll(s);
  o[0].squads.q1 = plan([{ kind: 'strike', t: hq.id, x: hq.x, z: hq.z }]);
  const { log } = resolveRound(s, o);
  ok(events(log).some(e => e.type === 'hit' && e.src === 'q1' && e.dst === hq.id), 'the HQ is hit');
});

test('models are removed as HP falls, and wounded squads hit weaker', () => {
  const s = arena([[0, 'fighter', 20, 16], [1, 'fighter', 22.4, 16]]);
  const q2 = s.squads[1], d2 = defOf(q2);
  q2.hp = d2.hpPer * 2; q2.models = 2;
  const o = holdAll(s);
  o[1].squads.q2 = plan([{ kind: 'strike', x: 20, z: 16 }]);
  const { log } = resolveRound(s, o);
  const hit = events(log).find(e => e.type === 'hit' && e.src === 'q2');
  ok(hit, 'no hit'); eq(hit.raw, Math.round(d2.attack.dmg * 2 * RULES.strikeMult));
  const after = events(log).find(e => e.type === 'hit' && e.dst === 'q1');
  const q1def = defOf(s.squads[0]);
  eq(after.models, Math.ceil(after.hp / q1def.hpPer));
});

test('a defend halves the hit and armour reduces damage', () => {
  ok(damageAfter(20, 0, true) < damageAfter(20, 0, false));
  ok(damageAfter(20, 20, false) < damageAfter(20, 0, false));
  ok(damageAfter(1, 100, true) >= 1, 'minimum 1 damage');
});

test('ruins are walk-in heavy cover: volleys pass them; a squad standing in one takes half', () => {
  // ruin wall at x 19.9-24.1, z 13.1-13.7
  const s = arena([[0, 'ranged', 22, 8], [1, 'fighter', 22, 13.4], [1, 'fighter', 30, 13.4]]);
  const o = holdAll(s);
  o[0].squads.q1 = plan([{ kind: 'volley', x: 22, z: 19 }]);
  const { log } = resolveRound(s, o);
  const hit = events(log).find(e => e.type === 'hit' && e.src === 'q1');
  eq(hit.dst, 'q2'); eq(hit.cover, 'heavy');
  const cb = FACTIONS.kingdom.units.ranged;
  eq(hit.dmg, damageAfter(cb.attack.dmg * cb.models * RULES.heavyCoverRanged, Math.max(0, defOf(s.squads[1]).armor - cb.passive.armor), hit.defended), 'heavy cover (and Armour-piercing)');
  ok(!pointBlocked(obstacles(s), 22, 13.4, 1), 'a ruin does not block movement');
});

test('cover: heavy (ruins, behind walls from the far side), light (forests), by hit kind', () => {
  const s = arena([[1, 'fighter', 22, 13.4], [1, 'fighter', 15, 7.5], [1, 'fighter', 40, 20]]);
  const [inRuin, inForest, open] = s.squads;
  eq(coverOf(s, inRuin), 'heavy'); eq(coverOf(s, inForest), 'light'); eq(coverOf(s, open), null);
  eq(coverMult('heavy', 'volley'), RULES.heavyCoverRanged); eq(coverMult('heavy', 'strike'), RULES.heavyCoverMelee);
  eq(coverMult('light', 'volley'), RULES.lightCoverRanged); eq(coverMult('light', 'strike'), 1);
  // a Palisade running along x at z 24: a squad just south of it is covered from the north only
  const w = addBuilding(s, 1, 'wall', 40, 24, 0, true);
  open.x = 40; open.z = 24 - w.d / 2 - radiusOf(open) - 0.2;
  eq(coverOf(s, open, 40, 30), 'heavy', 'shot from the far side');
  eq(coverOf(s, open, 40, 15), null, 'shot from its own side');
});

test('stance squads step into nearby cover', () => {
  // a crossbow on Guard 2" from the ruin, an enemy far away: it walks into the ruin
  const s = arena([[0, 'ranged', 22, 10.8], [1, 'fighter', 22, 28]]);
  const { state } = resolveRound(s, [orders({}, { q1: 'guard' }), { squads: {}, stances: { q2: 'hold' } }]);
  eq(coverOf(state, state.squads.find(q => q.id === 'q1')), 'heavy');
});

test('volley in the open hits the first enemy on the line', () => {
  const s = arena([[0, 'ranged', 8, 4], [1, 'fighter', 16, 4], [1, 'tank', 20, 4]]);
  const o = holdAll(s);
  o[0].squads.q1 = plan([{ kind: 'volley', x: 20, z: 4 }]);
  const { log } = resolveRound(s, o);
  const rel = events(log).find(e => e.type === 'release' && e.id === 'q1');
  eq(rel.hit.join(), 'q2');
});

test('squads do not walk through each other', () => {
  const s = arena([[0, 'fighter', 10, 4], [1, 'tank', 14, 4]]);
  const o = holdAll(s);
  o[0].squads.q1 = plan([{ kind: 'move', pts: [{ x: 18, z: 4 }], ap: 100 }]);
  const { state } = resolveRound(s, o);
  const [a, b] = state.squads;
  ok(Math.hypot(a.x - b.x, a.z - b.z) >= radiusOf(a) + radiusOf(b) - 0.05, 'overlap');
});

test('movement goes around rocks and slows in forests', () => {
  const s = createGame(1);
  const nav = Nav.for(s.terrain, 1, 't');
  const pts = nav.path(10.5, 25, 16.5, 25);   // rock at 13.5,25
  ok(pts.length >= 2, 'path should bend round the rock');
  const open = walkAP(s.terrain, 4, 2, [{ x: 20, z: 2 }], 50, 5);
  const wood = walkAP(s.terrain, 12, 7.5, [{ x: 28, z: 7.5 }], 50, 5);
  ok(wood.x - 12 < open.x - 4, 'forest should be slower');
});

test('command points: 3 squads plus the hero and builders', () => {
  const s = arena([[0, 'hero', 6, 6], [0, 'builder', 6, 9], [0, 'builder', 6, 12], [0, 'fighter', 9, 4], [0, 'tank', 9, 8], [0, 'ranged', 9, 12], [0, 'fast', 9, 16], [0, 'fighter', 9, 20]]);
  const o = emptyOrders();
  for (const q of s.squads.filter(q => q.owner === 0)) o.squads[q.id] = plan([{ kind: 'wait', ap: 10 }]);
  const cp = cpUsage(s, 0, o);
  eq(cp.accepted.length, RULES.cp + 3, 'hero and both builders are free');
  const v = validateOrders(s, 0, o);
  eq(Object.keys(v.squads).length, RULES.cp + 3);
});

test('orders over 100 AP are trimmed by validation', () => {
  const s = createGame(1);
  const o = emptyOrders();
  o.squads.q1 = plan([{ kind: 'strike', x: 30, z: 16 }, { kind: 'strike', x: 30, z: 16 }, { kind: 'strike', x: 30, z: 16 }, { kind: 'strike', x: 30, z: 16 }, { kind: 'strike', x: 30, z: 16 }]);
  const v = validateOrders(s, 0, o);
  const used = v.squads.q1.actions.length * defOf(s.squads[0]).attack.ap;
  ok(used <= RULES.ap, 'used ' + used);
});

test('AI vs AI: most games finish (no round limit; on the big maps the AI attacks in waves)', () => {
  const finished = (map, seeds) => seeds.filter(seed => {
    let s = createGame(seed, ['kingdom', 'undead'], map); const mem = [aiMemory(), aiMemory()];
    while (s.winner === null && s.round < 120) s = resolveRound(s, [aiOrders(s, 0, mem[0]), aiOrders(s, 1, mem[1])]).state;
    return s.winner !== null;
  }).length;
  const c = finished('crossing', [1, 2, 3, 4, 5, 6]), t = finished('twinrivers', [1, 2, 3, 4]);
  ok(c >= 4, 'crossing: ' + c + ' of 6 finished');
  ok(t >= 3, 'twin rivers: ' + t + ' of 4 finished');
});

console.log('M2 tactics');

test('charge rushes down the lane and hits the first enemy squad', () => {
  const s = arena([[0, 'fast', 10, 4], [1, 'fighter', 17, 4], [1, 'tank', 22, 4]]);
  const o = holdAll(s);
  o[0].squads.q1 = plan([{ kind: 'charge', x: 30, z: 4 }]);
  const { state, log } = resolveRound(s, o);
  const imp = events(log).find(e => e.type === 'hit' && e.src === 'q1' && e.kind === 'charge');
  ok(imp, 'no charge impact'); eq(imp.dst, 'q2');
  const q1 = state.squads.find(q => q.id === 'q1'), q2 = state.squads.find(q => q.id === 'q2');
  ok(Math.hypot(q1.x - q2.x, q1.z - q2.z) <= radiusOf(q1) + radiusOf(q2) + 0.35, 'should end in contact (the struck squad shrinks as it loses a model)');
  ok(q1.cd.charge > 0, 'charge goes on cooldown');
});

test('a skill on cooldown is dropped from the orders', () => {
  const s = arena([[0, 'fast', 10, 4, { cd: { charge: 1 } }], [1, 'fighter', 17, 4]]);
  const o = holdAll(s);
  o[0].squads.q1 = plan([{ kind: 'charge', x: 30, z: 4 }]);
  const { log } = resolveRound(s, o);
  ok(!events(log).some(e => e.type === 'act' && e.kind === 'charge'), 'charge should not happen');
});

test('stepping away from an engaged enemy costs AP and gives it a parting blow', () => {
  const s = arena([[0, 'fighter', 20, 16], [1, 'fighter', 22.2, 16]]);
  ok(engagedWith(s.squads[0], s.squads).length === 1, 'should start engaged');
  const o = holdAll(s);
  o[0].squads.q1 = plan([{ kind: 'move', pts: [{ x: 10, z: 16 }], ap: 60 }]);
  const { state, log } = resolveRound(s, o);
  ok(events(log).some(e => e.type === 'disengage' && e.id === 'q1'), 'disengage event');
  ok(events(log).some(e => e.type === 'hit' && e.kind === 'parting' && e.dst === 'q1'), 'parting blow');
  const q1 = state.squads.find(q => q.id === 'q1');
  const free = defOf(q1).tier * RULES.moveFactor * 60;
  ok(20 - q1.x < free - 1, 'disengaging should cost distance');
});

test('wraiths ignore engagement', () => {
  const s = arena([[1, 'fast', 20, 16], [0, 'fighter', 22.4, 16]]);
  eq(engagedWith(s.squads[0], s.squads).length, 0);
});

test('a parry negates the first melee hit and ripostes', () => {
  const s = arena([[0, 'fighter', 20, 16], [1, 'fighter', 22.2, 16]]);
  const o = holdAll(s);
  delete o[1].stances.q2;
  o[1].squads.q2 = { ...plan([]), parry: true, defends: 0 };
  o[0].squads.q1 = plan([{ kind: 'strike', x: 23, z: 16 }]);
  const { log } = resolveRound(s, o);
  ok(events(log).some(e => e.type === 'parry' && e.id === 'q2'), 'parry event');
  ok(!events(log).some(e => e.type === 'hit' && e.dst === 'q2' && e.kind === 'strike'), 'strike negated');
  ok(events(log).some(e => e.type === 'hit' && e.dst === 'q1' && e.kind === 'riposte'), 'riposte');
});

test('overwatch fires once at an enemy moving into the front cone, even in another tier', () => {
  const s = arena([[0, 'ranged', 10, 2], [1, 'fast', 30, 2]]);
  const o = holdAll(s);
  o[0].squads.q1 = { ...plan([]), overwatch: { x: 20, z: 2 } };
  o[1].squads.q2 = plan([{ kind: 'move', pts: [{ x: 18, z: 2 }], ap: 100 }]);
  const { log } = resolveRound(s, o);
  const shots = events(log).filter(e => e.type === 'release' && e.id === 'q1' && e.overwatch);
  eq(shots.length, 1, 'one overwatch shot');
  eq(shots[0].hit.join(), 'q2');
  eq(shots[0].seg.tier, 6, 'fired during the wraiths\' tier');
});

test('Arrow Storm hits a circle, then recharges', () => {
  const s = arena([[1, 'ranged', 22, 8], [0, 'fighter', 22, 19]]);
  const o = holdAll(s);
  o[1].squads.q1 = plan([{ kind: 'volley', x: 22, z: 19 }, { kind: 'storm', x: 22, z: 19 }]);
  const { state, log } = resolveRound(s, o);
  const rel = events(log).filter(e => e.type === 'release' && e.id === 'q1');
  eq(rel[0].kind, 'volley'); eq(rel[0].hit.join(), 'q2', 'ruins no longer stop volleys');
  eq(rel[1].kind, 'storm'); eq(rel[1].hit.join(), 'q2');
  ok(state.squads.find(q => q.id === 'q1').cd.storm > 0, 'storm goes on cooldown');
});

test('only fighters can parry', () => {
  const s = arena([[0, 'tank', 20, 16], [1, 'fighter', 22.2, 16]]);
  const o = holdAll(s);
  o[0].squads.q1 = { ...plan([]), parry: true };
  o[1].squads.q2 = plan([{ kind: 'strike', x: 20, z: 16 }]);
  const { log } = resolveRound(s, o);
  ok(!events(log).some(e => e.type === 'parry'), 'a tank parry order is dropped');
});

test('volleys into a forest deal reduced damage (cover)', () => {
  const s = arena([[0, 'ranged', 15, 1.5], [1, 'fighter', 15, 7.5]]);   // forest at 15,7.5
  const o = holdAll(s);
  for (const k of Object.keys(o[1].stances)) delete o[1].stances[k];
  o[1].squads.q2 = { ...plan([]), defends: 0 };
  o[0].squads.q1 = plan([{ kind: 'volley', x: 15, z: 7.5 }]);
  const { log } = resolveRound(s, o);
  const hit = events(log).find(e => e.type === 'hit' && e.src === 'q1');
  ok(hit && hit.cover, 'should be in cover');
  ok(hit.dmg < damageAfter(hit.raw, defOf(s.squads[1]).armor, false), 'cover reduces damage');
});

test('Rally gives nearby allies extra armour and a defend', () => {
  const s = arena([[0, 'hero', 30, 16], [0, 'ranged', 32, 17], [1, 'ranged', 32, 26]]);
  const o = holdAll(s);
  o[0].squads.q1 = plan([{ kind: 'rally', x: 30, z: 16 }]);
  o[1].squads.q3 = plan([{ kind: 'wait', ap: 40 }, { kind: 'volley', x: 32, z: 17 }]);
  const { log } = resolveRound(s, o);
  const buff = events(log).find(e => e.type === 'buff');
  ok(buff && buff.ids.includes('q2') && buff.armor === 4, 'rally reaches the crossbows with +4 armour');
  const h = events(log).find(e => e.type === 'hit' && e.dst === 'q2');
  ok(h, 'the volley lands');
  eq(h.dmg, damageAfter(h.raw * (h.cover ? RULES.coverMult : 1), FACTIONS.kingdom.units.ranged.armor + 4, true), 'armour + 4 and the extra defend apply');
});

test('charges weave through their own lines and end beside friends', () => {
  const s = arena([[0, 'fast', 8, 3], [0, 'fighter', 12, 3], [1, 'tank', 17.5, 3]]);
  const o = holdAll(s);
  o[0].squads.q1 = plan([{ kind: 'charge', x: 22, z: 3 }]);
  const { state, log } = resolveRound(s, o);
  ok(events(log).some(e => e.type === 'hit' && e.kind === 'charge' && e.dst === 'q3'), 'charge should reach the enemy');
  const [a, b] = state.squads;
  ok(Math.hypot(a.x - b.x, a.z - b.z) >= radiusOf(a) + radiusOf(b) - 0.05, 'no overlap with the friend');
});

test('balance report: AI vs AI with both factions on both sides', () => {
  const wins = { kingdom: 0, undead: 0, draw: 0 };
  for (let seed = 1; seed <= 6; seed++) for (const fac of [['kingdom', 'undead'], ['undead', 'kingdom']]) {
    let s = createGame(seed, fac); const mem = [aiMemory(), aiMemory()];
    while (s.winner === null) { const o = [aiOrders(s, 0, mem[0]), aiOrders(s, 1, mem[1])]; s = resolveRound(s, o).state; }
    if (s.winner === -1) wins.draw++; else wins[fac[s.winner]]++;
  }
  console.log('       wins over 12 games:', JSON.stringify(wins));
  ok(wins.kingdom > 0 && wins.undead > 0, 'both factions should be able to win');
});

console.log('M3 skills');

test('heroes have three skills, one of each colour, usable in the same round', () => {
  for (const f of ['kingdom', 'undead']) {
    const def = createGame(1, [f, f]).squads.find(q => q.role === 'hero');
    const cats = defOf(def).skills.map(k => k.cat).sort().join();
    eq(cats, f === 'kingdom' ? 'attack,defense,move' : 'attack,attack,defense', f);
  }
  const s = arena([[0, 'hero', 10, 16], [1, 'fighter', 16, 16], [0, 'fighter', 9, 18]]);
  const o = holdAll(s);
  o[0].squads.q1 = plan([{ kind: 'rally', x: 10, z: 16 }, { kind: 'leap', x: 13.2, z: 16 }, { kind: 'mighty', x: 16, z: 16 }]);
  const { state, log } = resolveRound(s, o);
  const acts = events(log).filter(e => e.type === 'act' && e.id === 'q1').map(e => e.kind).join();
  eq(acts, 'rally,leap,mighty');
  const q1 = state.squads.find(q => q.id === 'q1');
  ok(q1.cd.rally > 0 && q1.cd.leap > 0 && q1.cd.mighty > 0, 'each skill has its own cooldown');
  ok(events(log).some(e => e.type === 'hit' && e.kind === 'leap' && e.dst === 'q2'), 'Leap Strike hits at the landing');
  ok(events(log).some(e => e.type === 'hit' && e.kind === 'mighty' && e.dst === 'q2'), 'Mighty Swing hits after the leap');
});

test('the same skill cannot be used twice in a round', () => {
  const s = arena([[0, 'hero', 10, 16], [1, 'fighter', 30, 16]]);
  const o = holdAll(s);
  o[0].squads.q1 = plan([{ kind: 'mighty', x: 30, z: 16 }, { kind: 'mighty', x: 30, z: 16 }]);
  const { log } = resolveRound(s, o);
  eq(events(log).filter(e => e.type === 'act' && e.kind === 'mighty').length, 1);
});

test('Lock Shields blunts hits from the front only', () => {
  const run = (bx) => {
    const s = arena([[0, 'tank', 20, 16], [1, 'fighter', bx, 16]]);
    s.squads[0].fx = 1; s.squads[0].fz = 0;
    const o = holdAll(s);
    for (const k of Object.keys(o[0].stances)) delete o[0].stances[k];
    o[0].squads.q1 = { ...plan([{ kind: 'wall', x: 20, z: 16 }]), defends: 0 };
    o[1].squads.q2 = plan([{ kind: 'strike', x: 20, z: 16 }]);
    const { log } = resolveRound(s, o);
    return events(log).find(e => e.type === 'hit' && e.dst === 'q1');
  };
  const front = run(22.2), back = run(17.8);
  ok(front.walled && !back.walled, 'only the front is shielded');
  ok(front.dmg < back.dmg, 'front hit is smaller');
});

test('Piercing Bolt hits every squad on the line', () => {
  const s = arena([[0, 'ranged', 6, 3], [1, 'fighter', 11, 3], [1, 'tank', 15, 3]]);
  const o = holdAll(s);
  o[0].squads.q1 = plan([{ kind: 'pierce', x: 20, z: 3 }]);
  const { log } = resolveRound(s, o);
  const rel = events(log).find(e => e.type === 'release' && e.kind === 'pierce');
  eq(rel.hit.sort().join(), 'q2,q3');
});

test('mage: the Necromancer casts the same spell again with mana, pays per cast, regains mana each round', () => {
  const N = FACTIONS.undead.units.hero, th = N.skills.find(k => k.kind === 'thunder');
  const s = arena([[1, 'hero', 30, 16], [0, 'fighter', 24, 16]]);
  eq(s.squads[0].mana, N.mana.start);
  const o = holdAll(s);
  o[1].squads.q1 = plan([{ kind: 'thunder', x: 24, z: 16 }, { kind: 'thunder', x: 24, z: 16 }, { kind: 'thunder', x: 24, z: 16 }]);
  const v = validateOrders(s, 1, o[1]);
  eq(v.squads.q1.actions.length, Math.floor(N.mana.start / th.mana), 'only as many casts as the mana allows');
  const { state, log } = resolveRound(s, o);
  eq(events(log).filter(e => e.type === 'release' && e.kind === 'thunder').length, 2, 'cast twice in one round (no cooldown)');
  const q1 = state.squads.find(q => q.id === 'q1');
  eq(q1.mana, N.mana.start - 2 * th.mana + N.mana.regen, 'paid per cast, then regained');
  ok(!q1.cd.thunder, 'mages have no cooldowns');
});

test('Dark Thunder strikes the target, then chains to nearby enemies with weaker jumps', () => {
  const s = arena([[1, 'hero', 30, 4], [0, 'fighter', 22, 4], [0, 'fighter', 19, 4.5], [0, 'ranged', 16, 5], [0, 'tank', 6, 4]]);
  const o = holdAll(s);
  o[1].squads.q1 = plan([{ kind: 'thunder', x: 22, z: 4 }]);
  const { log } = resolveRound(s, o);
  const rel = events(log).find(e => e.type === 'release' && e.kind === 'thunder');
  eq(rel.hit.join(), 'q2,q3,q4', 'first target, then the two in reach; the far tank is out of reach');
  const raw = events(log).filter(e => e.type === 'hit' && e.kind === 'thunder').map(e => e.raw);
  ok(raw[0] > raw[1] && raw[1] > raw[2], 'each jump is weaker: ' + raw);
});

test('Summon Warband: two squads rise when it is cast (hittable, but they don\'t act that round) and crumble after 3 more rounds; not in the army cap', () => {
  // a kingdom tower fires after all the tiers: at the nearest enemy, which by then is a summoned squad
  const s = arena([[1, 'hero', 31, 4]]);
  addBuilding(s, 0, 'tower', 22, 4, 0, true);
  const o = holdAll(s);
  o[1].squads.q1 = plan([{ kind: 'summon', x: 27.5, z: 4 }]);
  let r = resolveRound(s, o);
  const mid = events(r.log).filter(e => e.type === 'spawn' && e.mid);
  eq(mid.length, 2, 'they appear during the round');
  ok(!events(r.log).some(e => e.type === 'act' && mid.some(m => m.id === e.id)), 'and do nothing that round');
  ok(events(r.log).some(e => e.type === 'hit' && mid.some(m => m.id === e.dst)), 'but can be hit at once');
  r.state.buildings = r.state.buildings.filter(b => b.type !== 'tower');   // no more tower fire from here on
  const sum = r.state.squads.filter(q => q.role === 'summon');
  eq(sum.length, 2, 'two squads'); ok(sum.every(q => q.ttl === RULES.summonTtl), 'ttl ' + sum.map(q => q.ttl));
  eq(armySize(r.state, 1), 1, 'summons are not in the army cap');
  for (let i = 0; i < 2; i++) r = resolveRound(r.state, holdAll(r.state));
  eq(r.state.squads.filter(q => q.role === 'summon').length, 2, 'still there after 2 more rounds');
  r = resolveRound(r.state, holdAll(r.state));
  eq(r.state.squads.filter(q => q.role === 'summon').length, 0, 'crumbled at the end of their 3rd round');
  ok(events(r.log).filter(e => e.type === 'crumble').length === 2);
});

test('Corpse Explosion bursts a summoned squad and hits the enemies around it (no souls)', () => {
  const s = arena([[1, 'hero', 30, 16], [0, 'fighter', 22.2, 16], [0, 'tank', 21, 17.8]]);
  const z = addSquad(s, 1, 'summon', 21, 16); z.ttl = 2;
  addBuilding(s, 1, 'well', 31.5, 19.5, 0, true);
  const o = holdAll(s);
  o[1].squads.q1 = plan([{ kind: 'explode', x: 21, z: 16 }]);
  const { state, log } = resolveRound(s, o);
  const rel = events(log).find(e => e.type === 'release' && e.kind === 'explode');
  ok(rel && rel.burst === z.id && rel.hit.length === 2, 'both enemies caught: ' + JSON.stringify(rel));
  ok(!state.squads.some(q => q.id === z.id), 'the summoned squad is gone');
  const raw = events(log).find(e => e.type === 'hit' && e.kind === 'explode').raw;
  const sk = FACTIONS.undead.units.hero.skills.find(k => k.kind === 'explode');
  eq(raw, sk.base + sk.perModel * FACTIONS.undead.units.summon.models);
  eq(raw, 23, 'a full summoned Warband (5 models) bursts for 23 (8 + 3 per model)');
});

test('summoned skeletons are Skeleton Warbands with a timed life', () => {
  const U = FACTIONS.undead.units, { role, summoned, ...rest } = U.summon, { role: r2, pair, ...sw } = U.swarm;
  eq(JSON.stringify(rest), JSON.stringify(sw), 'same name, models, HP, armour, tier, look, attack');
  ok(summoned && role === 'summon' && U.summon.pair === undefined, 'a summon, not a pair');
  eq(U.summon.name, 'Skeleton Warband');
});

test('Mighty Swing stuns: the target\'s actions wait; leftover stun carries into the next round', () => {
  const s = arena([[0, 'hero', 20, 16], [1, 'fighter', 22.4, 16]]);
  const o = holdAll(s);
  o[0].squads.q1 = plan([{ kind: 'mighty', x: 22.4, z: 16 }]);
  o[1].squads.q2 = plan([{ kind: 'wait', ap: 40 }, { kind: 'move', pts: [{ x: 30, z: 16 }], ap: 30 }]);
  const { state, log } = resolveRound(s, o);
  ok(events(log).some(e => e.type === 'stun' && e.id === 'q2'), 'stunned');
  const sk = FACTIONS.kingdom.units.hero.skills.find(k => k.kind === 'mighty');
  ok(sk.stun === 25 && sk.reach > FACTIONS.kingdom.units.hero.attack.reach, 'longer reach than the basic swing');
  ok(events(log).some(e => e.type === 'stunned' && e.id === 'q2'), 'its actions were held up');
});

test('Leap Strike clears a wall and shoves enemies at the landing', () => {
  const s = arena([[0, 'hero', 16, 16], [1, 'fighter', 23.6, 16.2]]);   // ruin wall at x 20.2
  const o = holdAll(s);
  o[0].squads.q1 = plan([{ kind: 'leap', x: 22.2, z: 16 }]);
  const { state, log } = resolveRound(s, o);
  const q1 = state.squads.find(q => q.id === 'q1');
  ok(q1.x > 20.6, 'landed beyond the wall');
  const land = events(log).find(e => e.type === 'land');
  ok(land && land.pushed.includes('q2'), 'enemy shoved');
});

test('Wraiths drift through squads', () => {
  const s = arena([[1, 'fast', 8, 3], [0, 'tank', 12, 3]]);
  const o = holdAll(s);
  o[1].squads.q1 = plan([{ kind: 'move', pts: [{ x: 17, z: 3 }], ap: 100 }]);
  const { state } = resolveRound(s, o);
  ok(state.squads.find(q => q.id === 'q1').x > 14, 'passed through the tank');
});

console.log('M3 fog of war');

test('sight: range, walls, deep forests, and squads hidden inside forests', () => {
  const t = createGame(1).terrain;
  ok(canSee(t, 4, 2, 11, 12, 2), 'open ground in range');
  ok(!canSee(t, 4, 2, 11, 16, 2), 'out of range');
  ok(canSee(t, 22, 8, 12, 22, 19), 'ruins are cover, not sight blockers');   // wall at x 19.9-24.1, z 13.1-13.7
  ok(!canSee(t, 13.5, 21.5, 12, 13.5, 28.6), 'a rock blocks sight');          // rock 13.5,25 r1.2
  ok(!canSee(t, 9, 7.5, 12, 21, 7.5), 'through a whole forest is blocked'); // forest 15,7.5 r3.2
  ok(!canSee(t, 9, 7.5, 12, 15, 7.5), 'inside a forest: only seen up close');
  ok(canSee(t, 11.5, 7.5, 12, 14, 7.5), 'seen from within 4 inches');
});

test('stance squads ignore enemies they cannot see', () => {
  // an enemy behind a rock, inside guard range but out of sight
  const s = arena([[0, 'fighter', 13.5, 21.5], [1, 'fighter', 13.5, 28.6]]);
  ok(!visibleTo(s, 0).has('q2'), 'hidden behind the rock');
  const { log } = resolveRound(s, [orders({}, { q1: 'guard' }), { squads: {}, stances: { q2: 'hold' } }]);
  ok(!events(log).some(e => e.type === 'act' && e.id === 'q1'), 'guard squad does not react');
});

console.log('Revive, auto skills, the swarm, forests');
test('a fallen hero comes back after its side holds the spot for 3 rounds (enemies inside don\'t stop it)', () => {
  const s = arena([[0, 'hero', 20, 4, { hp: 1 }], [1, 'ranged', 30, 4], [0, 'fighter', 17, 4]]);
  const o = holdAll(s); o[1].squads.q2 = plan([{ kind: 'volley', x: 20, z: 4 }]);
  let r = resolveRound(s, o);
  ok(!r.state.squads.some(q => q.role === 'hero' && q.owner === 0), 'the hero fell');
  const z = r.state.revive[0]; ok(z && Math.abs(z.x - 20) < 0.5 && Math.abs(z.z - 4) < 0.5, 'a revive zone where it fell');
  // nobody inside: no progress
  const away = r.state; away.squads.find(q => q.id === 'q3').x = 8;
  let r2 = resolveRound(away, holdAll(away));
  eq(r2.state.revive[0].progress, 0, 'empty zone: no progress');
  // a squad (and an enemy) inside: 3 rounds
  const st = r.state; st.squads.find(q => q.id === 'q3').x = 19; st.squads.find(q => q.id === 'q2').x = 22; st.squads.find(q => q.id === 'q2').z = 5;
  r = { state: st };
  for (let i = 0; i < 3; i++) r = resolveRound(r.state, holdAll(r.state));
  const h = r.state.squads.find(q => q.owner === 0 && q.role === 'hero');
  ok(h, 'revived'); eq(h.hp, Math.round(FACTIONS.kingdom.units.hero.hpPer * RULES.reviveHp), 'at half HP');
  ok(!r.state.revive[0], 'the zone is gone');
});

test('stance squads use their skills on their own unless auto skills is switched off', () => {
  const mk = auto => { const s = arena([[0, 'hero', 20, 4], [1, 'fighter', 22.6, 4]]); if (!auto) s.squads[0].auto = false; s.squads[0].stance = 'guard'; return s; };
  const used = s => events(resolveRound(s, [orders(), { squads: {}, stances: { q2: 'hold' } }]).log).some(e => e.type === 'act' && e.id === 'q1' && ['mighty', 'rally', 'leap'].includes(e.kind));
  ok(used(mk(true)), 'auto: the hero swings its Mighty Swing');
  ok(!used(mk(false)), 'off: basic swings only');
  const s = mk(true);
  const r = resolveRound(s, [{ squads: {}, stances: {}, auto: { q1: false } }, orders()]);
  eq(r.state.squads[0].auto, false, 'switched off by order');
});

test('the Skeleton Warband: trains in pairs over 2 rounds, 5 models x 14 HP, armour 2, a smaller base, slow', () => {
  const U = FACTIONS.undead.units;
  eq(U.swarm.pair, 2); eq(U.swarm.models, 5); eq(U.swarm.hpPer, 14); eq(U.swarm.armor, 2); eq(U.swarm.tier, 3, 'tier 3: 3.6" a round'); eq(U.swarm.attack.dmg, 2.8); eq(U.fighter.name, 'Skeleton Warriors');
  eq(RULES.trainRounds.swarm, 2); eq(FACTIONS.undead.train.swarm, 20);
  ok(squadRadius(U.swarm, 5) < squadRadius({ ...U.swarm, compact: undefined }, 5) * 0.81, 'a compact base');
  const s = arena([[1, 'fighter', 40, 4]]); s.supply[1] = 100;
  const crypt = s.buildings.find(b => b.owner === 1 && b.type === 'hq');
  let r = resolveRound(s, [orders(), { squads: {}, stances: {}, queue: { trains: { [crypt.id]: ['swarm'] } } }]);
  eq(r.state.squads.filter(q => q.owner === 1 && q.role === 'swarm').length, 0, 'not yet after one round');
  r = resolveRound(r.state, [orders(), { squads: {}, stances: {} }]);
  eq(r.state.squads.filter(q => q.owner === 1 && q.role === 'swarm').length, 2, 'two squads from one training');
  eq(armySize(r.state, 1), 3, 'both count toward the cap');
  const full = arena([[1, 'fighter', 40, 4]]); full.supply[1] = 100; full.board.cap = 2;
  eq(startQueues(full, 1, { tq: { [crypt.id]: ['swarm'] } }).trains[crypt.id][0].wait, 'cap', 'needs room for both');
});

test('buildings only on ground the side has seen; undead buildings only on their graves', () => {
  const s = createGame(2);
  const far = s.board.w - 14;
  eq(placeError(s, 0, 'tower', far, 10), 'You haven\'t seen that spot yet');
  // once a squad has looked there, it is allowed
  const q = s.squads.find(x => x.owner === 0 && x.role === 'fighter'); q.x = far - 4; q.z = 10;
  const r = resolveRound(s, [{ squads: {}, stances: { [q.id]: 'hold' } }, orders()]);
  ok(placeError(r.state, 0, 'tower', far, 10) !== 'You haven\'t seen that spot yet', 'seen now');
  const u = arena([[1, 'fighter', 40, 4]]);
  eq(placeError(u, 1, 'tower', 30, 9.5), 'Undead buildings must stand on your graves');
  eq(placeError(u, 1, 'tower', 40, 12), '', 'on the Crypt\'s graves');
  ok(placeError(u, 1, 'well', 31.5, 12.5) === 'Undead buildings must stand on your graves', 'a Soul Well needs graves too');
});

test('forests slow movement less, and you can build anywhere', () => {
  eq(RULES.forestSlow, 0.75);
  const s = arena([[0, 'builder', 7, 9], [1, 'fighter', 41, 23]]);
  eq(placeError(s, 0, 'tower', 34, 10), '', 'a tower in the enemy half is allowed');
});

console.log('Stances');
test('squads start on Advance (builders on Guard)', () => {
  const s = createGame(1);
  ok(s.squads.filter(q => q.role !== 'builder').every(q => q.stance === 'advance'));
  ok(s.squads.filter(q => q.role === 'builder').every(q => q.stance === 'guard'));
});

test('Advance with a target point marches there over the rounds, then guards it', () => {
  const s = arena([[0, 'fighter', 6, 4]]);
  let r = resolveRound(s, [{ squads: {}, stances: {}, goals: { q1: { x: 14, z: 6 } } }, orders()]);
  let q = r.state.squads[0];
  ok(q.goal && q.stance === 'advance', 'goal stored, stance advance');
  ok(q.x > 9, 'walked toward it: ' + q.x);
  r = resolveRound(r.state, [orders(), orders()]);
  q = r.state.squads[0];
  ok(Math.hypot(q.x - 14, q.z - 6) <= RULES.goalReach + 0.6, 'arrived');
  const x1 = q.x;
  r = resolveRound(r.state, [orders(), orders()]);
  ok(Math.abs(r.state.squads[0].x - x1) < 0.3, 'and stays there');
  r = resolveRound(r.state, [{ squads: {}, stances: {}, goals: { q1: null } }, orders()]);
  ok(!r.state.squads[0].goal, 'cleared');
});

test('Advance treats squads, buildings and the HQ alike: the nearest one is attacked', () => {
  // an enemy tower right next to the squad, an enemy squad further away (both seen)
  const s = arena([[0, 'fighter', 30, 8], [1, 'fighter', 30, 17]]);
  const tw = addBuilding(s, 1, 'tower', 33, 8, 0, true);
  s.intel[0].known[tw.id] = { id: tw.id, owner: 1, type: 'tower', x: tw.x, z: tw.z, r: tw.r, hp: tw.hp, build: 0 };
  const { log } = resolveRound(s, [orders(), { squads: {}, stances: { q2: 'hold' } }]);
  ok(events(log).some(e => e.type === 'hit' && e.src === 'q1' && e.dst === tw.id), 'it attacks the nearer tower, not the squad');
});

test('Retreat falls back to the nearest own mine / soul well, else the HQ', () => {
  const s = arena([[0, 'fighter', 24, 12], [0, 'tank', 24, 26]]);
  addBuilding(s, 0, 'mine', 16.5, 19.5, 0, true);
  s.squads[1].hp = 1; s.squads[1].models = 1;
  const r = resolveRound(s, [orders({}, { q1: 'retreat', q2: 'retreat' }), orders()]);
  const q1 = r.state.squads.find(q => q.id === 'q1'), q2 = r.state.squads.find(q => q.id === 'q2');
  const pl = buildStancePlan(s, { ...s.squads[0], stance: 'retreat' }, []), end = pl.actions[0].pts.slice(-1)[0];
  ok(Math.hypot(end.x - 16.5, end.z - 19.5) < 5, 'its path ends at the mine');
  ok(Math.hypot(q1.x - 24, q1.z - 12) > 2, 'and it walks');
  ok(Math.hypot(q2.x - 16.5, q2.z - 19.5) < Math.hypot(24 - 16.5, 26 - 19.5), 'the other too (nearest fallback)');
  eq(r.state.squads[0].stance, 'retreat');
});

test('a building locked onto a squad keeps training it; queued squads go first', () => {
  const s = arena([[0, 'builder', 7, 9], [1, 'fighter', 41, 23]]); s.supply[0] = 300;
  const b = addBuilding(s, 0, 'barracks', 6, 4, 0, true);
  const qo = (queue = {}) => ({ squads: {}, stances: {}, queue }), ob = () => ({ squads: {}, stances: {} });
  let r = resolveRound(s, [qo({ repeat: { [b.id]: 'fighter' }, trains: { [b.id]: ['ranged'] } }), ob()]);
  let B = r.state.buildings.find(x => x.id === b.id);
  eq(B.repeat, 'fighter'); eq(B.train.role, 'ranged', 'the queue first');
  for (let i = 0; i < 2; i++) r = resolveRound(r.state, [ob(), ob()]);
  B = r.state.buildings.find(x => x.id === b.id);
  eq(B.train?.role, 'fighter', 'then the locked squad, with no new orders');
  for (let i = 0; i < 2; i++) r = resolveRound(r.state, [ob(), ob()]);
  eq(r.state.buildings.find(x => x.id === b.id).train?.role, 'fighter', 'and again');
  ok(r.state.squads.filter(q => q.owner === 0 && q.role === 'fighter').length >= 1, 'the first locked fighter is out');
  r = resolveRound(r.state, [qo({ repeat: { [b.id]: null } }), ob()]);
  ok(!r.state.buildings.find(x => x.id === b.id).repeat, 'unlocked');
});

test('fast squads hit hard but rarely (2 swings a round)', () => {
  for (const f of ['kingdom', 'undead']) {
    const a = FACTIONS[f].units.fast.attack;
    eq(Math.floor(RULES.ap / a.ap), 2, f);
    ok(a.dmg * FACTIONS[f].units.fast.models >= 25, f + ' strong per hit');
  }
});

test('the AI only targets what it sees or remembers', () => {
  const s = arena([[0, 'fighter', 6, 3], [1, 'fighter', 44, 29]]);
  const mem = aiMemory();
  aiOrders(s, 1, mem);
  ok(!mem.seen.q1, 'nothing seen across the board');
});

console.log('M3 base & economy');

const ob = (builds = [], trains = []) => ({ squads: {}, stances: {}, builds, trains });

test('a new game: an HQ each at a seeded spot, faction currencies, four free resource sites', () => {
  const s = createGame(1);
  eq(s.buildings.filter(b => b.type === 'hq').length, 2);
  eq(s.supply.join(), FACTIONS.kingdom.eco.start + ',' + FACTIONS.undead.eco.start);
  eq(s.shrines.length, 4); ok(s.shrines.every(x => x.owner === -1));
  const spots = new Set();
  for (let sd = 1; sd < 30; sd++) spots.add(createGame(sd).buildings[0].z);
  ok(spots.size === 3, 'three HQ spots in use: ' + [...spots]);
  eq(JSON.stringify(createGame(5).buildings), JSON.stringify(createGame(5).buildings), 'deterministic per seed');
});

const k = () => arena([[0, 'builder', 7, 9], [1, 'fighter', 41, 23]]);
test('placement: own third only, sites only on resource sites, faction lists', () => {
  const s = k();
  eq(placeError(s, 0, 'barracks', 6, 4), '', 'a valid spot');
  ok(placeError(s, 0, 'barracks', 30, 9), 'outside your third');
  ok(placeError(s, 0, 'barracks', 3.5, 16), 'on top of the HQ');
  eq(placeError(s, 0, 'barracks', 7, 9), '', 'your own squads make way (they are pushed out when it starts)');
  const en = s.squads.find(q => q.owner === 1); const ex = en.x, ez = en.z; en.x = 7; en.z = 9;
  ok(placeError(s, 0, 'barracks', 7, 9), 'an enemy squad blocks'); en.x = ex; en.z = ez;
  eq(placeError(s, 0, 'mine', 16.5, 19.5), '', 'a mine on a site');
  ok(placeError(s, 0, 'mine', 10, 10), 'a mine off a site');
  ok(placeError(s, 0, 'well', 16.5, 19.5), 'the kingdom has no soul wells');
  ok(placeError(s, 1, 'farm', 40, 4), 'the undead have no farms');
});

const workOrder = (s, q, f) => ({ [q.id]: plan(builderPlan(s, q, f, 100).actions) });
test('a builder puts up a new building over its work (a farm takes it into a second round)', () => {
  const s = k();
  const q = s.squads[0], f = { type: 'farm', x: 6, z: 5, w: 2.6, d: 2.2 };
  const o = [ob([{ type: 'farm', x: 6, z: 5 }]), ob()];
  o[0].squads = workOrder(s, q, f);
  let r = resolveRound(s, o);
  let b = r.state.buildings.find(x => x.type === 'farm');
  ok(b && b.build > 0 && b.build < BUILDINGS.farm.work, 'site placed and worked on');
  eq(r.state.supply[0], FACTIONS.kingdom.eco.start - BUILDINGS.farm.cost + FACTIONS.kingdom.eco.hq, 'paid; no farm income yet');
  r = resolveRound(r.state, [ob(), ob()]);
  b = r.state.buildings.find(x => x.type === 'farm');
  eq(b.build, 0, 'finished in round 2 (the builder kept at it)'); eq(b.hp, BUILDINGS.farm.hp, 'full hp');
  ok(events(r.log).some(x => x.type === 'built' && x.by === q.id), 'built by the builder');
});

test('two builders stack; a builder further away walks over and works when it arrives', () => {
  const s = arena([[0, 'builder', 7, 4], [0, 'builder', 7, 9.5], [0, 'builder', 10, 28]]);
  const b = addBuilding(s, 0, 'tower', 7, 6.8, 0, false);
  const o = holdAll(s);
  for (const id of ['q1', 'q2']) o[0].squads[id] = plan([{ kind: 'work', x: b.x, z: b.z, ap: 100 }]);
  o[0].squads.q3 = plan([{ kind: 'work', x: b.x, z: b.z, ap: 100 }]);
  const r = resolveRound(s, o);
  eq(r.state.buildings.find(x => x.id === b.id).build, 0, '2 x 100 AP of work finishes a 200-work tower');
  const q3 = r.state.squads.find(q => q.id === 'q3');
  ok(Math.hypot(q3.x - 10, q3.z - 28) > 5, 'the far builder walked toward it');
  ok(!events(r.log).some(e => e.type === 'workFail'), 'nobody failed');
});

test('a far-away site is reached and built even with squads in the way (no failures across seeds)', () => {
  let fails = 0, built = 0, tried = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const s = createGame(seed);
    const q = s.squads.find(x => x.owner === 0 && x.role === 'builder');
    for (const [dx, dz] of [[6, 3], [5, 0], [3, 4], [3, -4], [-1, 6]]) {
      const x = q.x + dx, z = q.z + dz;
      if (placeError(s, 0, 'barracks', x, z, 0)) continue;
      const bp = builderPlan(s, q, { type: 'barracks', ...{ x, z, w: 3.5, d: 2.5 } }, 100);
      if (!bp.actions.length) continue;
      const o = [ob([{ type: 'barracks', x, z }]), ob()];
      o[0].squads = { [q.id]: plan(bp.actions) };
      const r = resolveRound(s, o); tried++;
      if (events(r.log).some(e => e.type === 'workFail')) fails++;
      const q2 = r.state.squads.find(o => o.id === q.id);
      if (r.state.buildings.some(b => b.type === 'barracks' && b.owner === 0 && b.build < BUILDINGS.barracks.work) || Math.hypot(q2.x - q.x, q2.z - q.z) > 4) built++;
      break;
    }
  }
  eq(fails, 0, 'no failed work'); ok(tried >= 6, 'tried ' + tried); eq(built, tried, 'every builder worked or made real progress');
});

test('builders keep at their task next round without new orders, then go gathering', () => {
  const s = arena([[0, 'builder', 7, 2.4]]);
  const b = addBuilding(s, 0, 'barracks', 7, 6.5, 0, false);
  addBuilding(s, 0, 'farm', 4, 9, 0, true);
  const o = holdAll(s); delete o[0].stances.q1;
  o[0].squads.q1 = plan([{ kind: 'wait', ap: 40 }, { kind: 'work', x: b.x, z: b.z, ap: 60 }]);
  let r = resolveRound(s, o);
  ok(r.state.buildings.find(x => x.id === b.id).build > 0, 'not finished in round 1');
  eq(r.state.squads[0].task.kind, 'build');
  for (let i = 0; i < 4 && r.state.buildings.find(x => x.id === b.id).build > 0; i++) r = resolveRound(r.state, [ob(), ob()]);
  eq(r.state.buildings.find(x => x.id === b.id).build, 0, 'finished over the next rounds with no orders');
  r = resolveRound(r.state, [ob(), ob()]);
  eq(r.state.squads[0].task.kind, 'gather', 'walks to the farm');
  r = resolveRound(r.state, [ob(), ob()]);
  ok(events(r.log).some(e => e.type === 'gather' && e.owner === 0 && e.amount >= 7), 'and gathers a full round there');
});

test('gathering: four farmers per (big) farm, two per mine; builders are not in the army cap', () => {
  const s = arena([[0, 'builder', 11, 2.5], [0, 'builder', 11, 5], [0, 'builder', 11, 7.5], [0, 'builder', 11, 10], [0, 'builder', 7, 11]]);
  const f = addBuilding(s, 0, 'farm', 6.5, 6, 0, true);
  const o = [ob(), ob()];
  for (const q of s.squads) o[0].squads[q.id] = plan([{ kind: 'work', x: f.x, z: f.z, ap: 100 }]);
  const r = resolveRound(s, o);
  const g = events(r.log).filter(e => e.type === 'gather');
  eq(g.filter(e => e.owner === 0).length, 4, 'four farmers at the farm');
  ok(events(r.log).some(e => e.type === 'workFail' && e.full), 'the fifth is turned away');
  eq(armySize(s, 0), 0, 'builders do not count toward the army cap');
  eq(BUILDINGS.farm.w * BUILDINGS.farm.d > 14, true, 'farms are big');
});

test('a builder on Hold stays put', () => {
  const s = arena([[0, 'builder', 10, 3]]);
  addBuilding(s, 0, 'farm', 7, 9, 0, true);
  const r = resolveRound(s, holdAll(s));
  eq(r.state.squads[0].x, 10); ok(!events(r.log).some(e => e.type === 'gather'));
});

test('builders repair damaged buildings', () => {
  const s = arena([[0, 'builder', 7, 4]]);
  const b = addBuilding(s, 0, 'tower', 7, 6, 0, true); b.hp = 50;
  const o = holdAll(s); o[0].squads.q1 = plan([{ kind: 'work', x: 7, z: 6, ap: 40 }]);
  const r = resolveRound(s, o);
  eq(r.state.buildings.find(x => x.id === b.id).hp, 94, '40 AP x 220 HP / 200 work');
});

test('builders cost no command points; the HQ trains builders, barracks soldiers', () => {
  const s = createGame(1);
  const sq = {}; for (const q of s.squads.filter(q => q.owner === 0)) sq[q.id] = plan([]);
  const u = cpUsage(s, 0, { squads: sq });
  eq(u.accepted.length, 3, 'hero + builder (free) + the warrior');
  const hq = s.buildings.find(b => b.owner === 0 && b.type === 'hq');
  const v = validateOrders(s, 0, ob([], [{ bid: hq.id, role: 'builder' }]));
  eq(v.queue.tq[hq.id].length, 1);
  eq(validateOrders(s, 0, ob([], [{ bid: hq.id, role: 'fighter' }])).queue.tq[hq.id].length, 1, 'the Keep also trains Men-at-arms');
  eq(validateOrders(s, 0, ob([], [{ bid: hq.id, role: 'ranged' }])).queue.tq[hq.id].length, 0, 'but no other soldiers');
  const hq1 = s.buildings.find(b => b.owner === 1 && b.type === 'hq');
  eq(validateOrders(s, 1, ob([], [{ bid: hq1.id, role: 'swarm' }])).queue.tq[hq1.id].length, 1, 'the crypt raises skeleton warbands (the swarm)');
  eq(validateOrders(s, 1, ob([], [{ bid: hq1.id, role: 'builder' }])).queue.tq[hq1.id].length, 0, 'the undead have no builders');
});

test('training takes rounds: a fighter appears at the end of its second round', () => {
  const s = k();
  const b = addBuilding(s, 0, 'barracks', 6, 4, 0, true);
  const n0 = s.squads.filter(q => q.owner === 0).length;
  let r = resolveRound(s, [ob([], [{ bid: b.id, role: 'fighter' }]), ob()]);
  eq(r.state.squads.filter(q => q.owner === 0).length, n0, 'not yet');
  eq(r.state.buildings.find(x => x.id === b.id).train.left, 1, 'one round to go');
  eq(r.state.supply[0], FACTIONS.kingdom.eco.start - trainCost('kingdom', 'fighter') + incomeOf(r.state, 0), 'paid up front');
  r = resolveRound(r.state, [ob(), ob()]);
  eq(r.state.squads.filter(q => q.owner === 0).length, n0 + 1);
  ok(events(r.log).some(e => e.type === 'spawn' && e.role === 'fighter'));
  eq(RULES.trainRounds.tank, 3); eq(RULES.trainRounds.builder, 1);
});

// ---- production queues ----
const qo = (queue = {}, extra = {}) => ({ squads: {}, stances: {}, queue, ...extra });
console.log('Production queues');
test('training queue: each squad is paid when it starts, and they come out one after another', () => {
  const s = k(); s.supply[0] = 100;
  const b = addBuilding(s, 0, 'barracks', 6, 4, 0, true);
  let r = resolveRound(s, [qo({ trains: { [b.id]: ['fighter', 'fighter', 'ranged'] } }), ob()]);
  let B = r.state.buildings.find(x => x.id === b.id);
  eq(B.train.role, 'fighter'); eq(B.queue.join(), 'fighter,ranged', 'two still waiting');
  eq(r.state.supply[0], 100 - trainCost('kingdom', 'fighter') + incomeOf(r.state, 0), 'only the first is paid');
  r = resolveRound(r.state, [ob(), ob()]);
  ok(events(r.log).some(e => e.type === 'spawn' && e.role === 'fighter'), 'first fighter out after 2 rounds');
  r = resolveRound(r.state, [ob(), ob()]);
  B = r.state.buildings.find(x => x.id === b.id);
  eq(B.train.role, 'fighter', 'the next one started the round after, with no new orders'); eq(B.queue.join(), 'ranged');
});

test('an unaffordable front item waits and nothing behind it jumps ahead', () => {
  const s = k(); s.supply[0] = 25;
  const b = addBuilding(s, 0, 'barracks', 6, 4, 0, true);
  const fc = startQueues(s, 0, { tq: { [b.id]: ['ranged', 'fighter'] } });
  eq(fc.trains[b.id][0].wait, 'gold'); eq(fc.trains[b.id][0].need, 1); eq(fc.trains[b.id][1].wait, 'line');
  let r = resolveRound(s, [qo({ trains: { [b.id]: ['ranged', 'fighter'] } }), ob()]);
  let B = r.state.buildings.find(x => x.id === b.id);
  eq(B.train, null, 'the crossbows wait (25 < 26) and the fighter (24) does not jump ahead'); eq(r.state.supply[0], 25 + incomeOf(r.state, 0));
  r = resolveRound(r.state, [ob(), ob()]);
  eq(r.state.buildings.find(x => x.id === b.id).train.role, 'ranged', 'starts once income arrives');
});

test('the army cap holds the queue; cancelling a waiting item is free, stopping training refunds it', () => {
  const s = k(); s.supply[0] = 100;
  const b = addBuilding(s, 0, 'barracks', 6, 4, 0, true);
  s.board.cap = armySize(s, 0);
  eq(startQueues(s, 0, { tq: { [b.id]: ['fighter'] } }).trains[b.id][0].wait, 'cap');
  s.board.cap = 8;
  let r = resolveRound(s, [qo({ trains: { [b.id]: ['fighter', 'tank'] } }), ob()]);
  const paid = r.state.supply[0];
  r = resolveRound(r.state, [qo({ trains: { [b.id]: [] }, cancel: [b.id] }), ob()]);
  const B = r.state.buildings.find(x => x.id === b.id);
  eq(B.train, null); eq(B.queue.length, 0);
  eq(r.state.supply[0], paid + trainCost('kingdom', 'fighter') + incomeOf(r.state, 0), 'fighter refunded, the tank cost nothing');
  ok(events(r.log).some(e => e.type === 'trainCancel'));
});

test('queues hold at most 5 items', () => {
  const s = k(); s.supply[0] = 400;
  const b = addBuilding(s, 0, 'barracks', 6, 4, 0, true);
  const v = validateOrders(s, 0, qo({ trains: { [b.id]: Array(7).fill('fighter') }, builds: [4, 13, 20, 23, 26, 29, 11].map(z => ({ type: 'wall', x: 9, z })) }));
  eq(v.queue.tq[b.id].length, RULES.queueMax); eq(v.queue.bq.length, RULES.queueMaxBuild);
});

test('base queue: one builder takes one site at a time; two builders start two at once', () => {
  const one = k(); one.supply[0] = 200;
  const q2 = [{ type: 'farm', x: 6, z: 5 }, { type: 'tower', x: 10, z: 13 }];
  let r = resolveRound(one, [qo({ builds: q2 }), ob()]);
  eq(r.state.buildings.filter(b => b.owner === 0 && b.build > 0).length, 1, 'one site');
  eq(r.state.bq[0].length, 1); eq(r.state.bq[0][0].type, 'tower', 'the tower waits for a free builder');
  eq(startQueues(r.state, 0).builds[0].wait, 'builders');
  for (let i = 0; i < 6 && r.state.bq[0].length; i++) r = resolveRound(r.state, [ob(), ob()]);
  eq(r.state.bq[0].length, 0, 'the tower started once the farm was done');
  ok(r.state.buildings.some(b => b.type === 'farm' && !b.build));
  const two = arena([[0, 'builder', 7, 9], [0, 'builder', 9, 8], [1, 'fighter', 41, 23]]); two.supply[0] = 200;
  r = resolveRound(two, [qo({ builds: q2 }), ob()]);
  eq(r.state.buildings.filter(b => b.owner === 0 && b.build > 0).length, 2, 'both start in the same round');
  ok(r.state.squads.filter(q => q.owner === 0).every(q => q.task && q.task.kind === 'build'), 'and each builder took one');
  ok(new Set(r.state.squads.filter(q => q.owner === 0).map(q => q.task.bid)).size === 2, 'different sites');
});

test('an idle builder walks to a far queued site (no distance limit)', () => {
  const s = arena([[0, 'builder', 7, 4]]); s.supply[0] = 100;
  let r = resolveRound(s, [qo({ builds: [{ type: 'tower', x: 12, z: 28 }] }), ob()]);
  const b = r.state.buildings.find(x => x.type === 'tower');
  ok(b, 'site placed'); eq(r.state.squads[0].task?.bid, b.id, 'the builder took it');
  for (let i = 0; i < 4; i++) r = resolveRound(r.state, [ob(), ob()]);
  ok(r.state.buildings.find(x => x.id === b.id).build < BUILDINGS.tower.work, 'and works on it');
});

test('queued builds: a squad on the spot makes it wait; a building on it drops it; reorder keeps ids', () => {
  const s = k(); s.supply[0] = 200;
  let r = resolveRound(s, [qo({ builds: [{ type: 'tower', x: 7, z: 9 }] }), holdAll(s)[1]]);   // the builder stands there
  // the builder is on Hold? no: it has no orders, so it may walk off; the item either waited or started
  const st = r.state;
  const w = startQueues(st, 0, { bq: [{ qid: 'x', type: 'wall', x: st.squads[0].x, z: st.squads[0].z, rot: 0 }] });
  eq(w.builds[0].wait === 'blocked' || w.builds[0].wait === 'builders', true, 'a squad on the spot: wait, not drop');
  const t = k(); t.supply[0] = 10;   // too poor: items wait in the queue
  r = resolveRound(t, [qo({ builds: [{ type: 'farm', x: 6, z: 5 }, { type: 'wall', x: 9, z: 13 }] }), ob()]);
  const ids = r.state.bq[0].map(i => i.qid);
  eq(ids.length, 2); ok(ids[0] && ids[1] && ids[0] !== ids[1], 'stable ids');
  r = resolveRound(r.state, [qo({ builds: r.state.bq[0].slice().reverse() }), ob()]);
  eq(r.state.bq[0].length >= 1, true);
  ok(events(r.log).some(e => e.type === 'construct' && e.btype === 'wall' && e.qid === ids[1]) || r.state.bq[0][0].qid === ids[1], 'the wall moved to the front');
  const u = r.state; u.supply[0] = 0;
  const far = u.bq[0].find(i => i.type === 'farm');
  addBuilding(u, 0, 'barracks', far.x, far.z, 0, true);
  r = resolveRound(u, [ob(), ob()]);
  ok(events(r.log).some(e => e.type === 'queueDrop' && e.qid === far.qid), 'a building on the spot drops it');
  ok(!r.state.bq[0].some(i => i.qid === far.qid));
});

test('queues are deterministic and survive several rounds without orders', () => {
  const run = () => { const s = k(); s.supply[0] = 30; const b = addBuilding(s, 0, 'barracks', 6, 4, 0, true);
    let r = resolveRound(s, [qo({ trains: { [b.id]: ['fighter', 'ranged', 'fighter'] }, builds: [{ type: 'farm', x: 6, z: 9.5 }] }), ob()]);
    for (let i = 0; i < 8; i++) r = resolveRound(r.state, [ob(), ob()]);
    return r.state; };
  const a = run();
  eq(JSON.stringify(a), JSON.stringify(run()));
  ok(a.squads.filter(q => q.owner === 0 && q.role !== 'builder').length >= 2, 'queued squads came out over the rounds');
});

test('gold: a finished mine owns its site and pays every round', () => {
  const s = k();
  addBuilding(s, 0, 'mine', 16.5, 19.5, 0, true);
  const r = resolveRound(s, holdAll(s));
  eq(r.state.shrines[0].owner, 0);
  eq(r.state.supply[0], FACTIONS.kingdom.eco.start + FACTIONS.kingdom.eco.hq + BUILDINGS.mine.income);
  ok(placeError(r.state, 1, 'well', 16.5, 19.5), 'the site is taken');
});

test('souls: only models dying on undead grave ground pay (either side); the graves spread there', () => {
  // a kingdom model dies inside the soul well's graveyard (souls); another dies next to the warriors far from any graves (none)
  const s = arena([[1, 'fighter', 18.4, 19.5], [0, 'fighter', 20.3, 19.5, { hp: 2, models: 1 }], [1, 'fighter', 30, 29], [0, 'fighter', 31.9, 29, { hp: 2, models: 1 }]]);
  const w = addBuilding(s, 1, 'well', 16.5, 19.5, 0, true); w.grave = 5;
  const o = holdAll(s);
  o[1].squads.q1 = plan([{ kind: 'strike', x: 20.3, z: 19.5 }]);
  o[1].squads.q3 = plan([{ kind: 'strike', x: 31.9, z: 29 }]);
  const r = resolveRound(s, o);
  const souls = events(r.log).filter(e => e.type === 'souls');
  ok(events(r.log).filter(e => e.type === 'hit' && e.lost).length === 2, 'two models fell');
  ok(souls.length === 1 && souls[0].owner === 1 && souls[0].amount === RULES.soulPerModel, 'only the one on the graves: ' + JSON.stringify(souls));
  eq(r.state.supply[1], Math.min(FACTIONS.undead.eco.start + RULES.soulPerModel + BUILDINGS.well.income + FACTIONS.undead.eco.hq, 1e9) - soulDecayOf(FACTIONS.undead.eco.start + RULES.soulPerModel + BUILDINGS.well.income + FACTIONS.undead.eco.hq));
  const w2 = r.state.buildings.find(b => b.id === w.id);
  eq(w2.grave, BUILDINGS.well.grave, 'the well keeps its own reach');
  const blob = r.state.graves[1].find(g => g.blob);
  ok(blob && Math.abs(blob.x - 21.5) < 0.01 && Math.abs(blob.z - 19.5) < 0.01 && blob.r === RULES.graveBlob, 'a small grave area at the nearest edge: ' + JSON.stringify(blob));
});

test('graves spread where things die: a small area at the nearest edge, merging, no maximum', () => {
  const s = arena([[1, 'fighter', 40, 4]]);
  s.graves[1] = [{ x: 20, z: 16, r: 4 }];
  const c = () => ({ x: 20, z: 16, r: 4, patch: s.graves[1][0] });
  // one model dies 1" east of the centre: a 0.8" area on the east edge
  const g1 = spreadGraves(s, 1, c(), 21, 16, 1);
  eq(g1.x, 24); eq(g1.z, 16); eq(g1.r, RULES.graveBlob);
  eq(s.graves[1][0].r, 4, 'the graveyard itself does not widen');
  // four more die on the same side: they merge (areas add up), creeping that way
  const g2 = spreadGraves(s, 1, c(), 22, 16, 4);
  ok(g2 === g1 && Math.abs(g2.r - RULES.graveBlob * Math.sqrt(5)) < 0.01, 'merged: ' + JSON.stringify(g2));
  // a death on the north side spreads north instead
  const g3 = spreadGraves(s, 1, c(), 20, 14, 1);
  ok(g3 !== g1 && g3.z < 13 && Math.abs(g3.x - 20) < 0.01, 'north edge: ' + JSON.stringify(g3));
  // it keeps going past other grave ground it would sit inside (the nearest real edge)
  s.graves[1].push({ x: 20, z: 22.5, r: 3 });
  const g4 = spreadGraves(s, 1, c(), 20, 18, 1);
  ok(g4.z > 24.5, 'past the overlapping graves: ' + JSON.stringify(g4));
  // no maximum: many deaths keep growing the area
  const east = () => Math.max(...s.graves[1].filter(g => g.blob).map(g => g.x + g.r));
  const before = east();
  for (let i = 0; i < 20; i++) spreadGraves(s, 1, c(), 21, 16, 6);
  ok(east() > before + 4, 'no maximum: the graves keep creeping east: ' + before + ' -> ' + east());
  const area = s.graves[1].filter(g => g.blob && g.x > 22).reduce((n, g) => n + g.r * g.r, 0);
  ok(Math.abs(area - RULES.graveBlob ** 2 * 125) < 0.5, 'the area adds up: ' + area);
  eq(RULES.graveDeathGrow, undefined);
});

test('graveyards spread almost at once to their building\'s reach; a destroyed building leaves its graves', () => {
  const s = arena([[1, 'fighter', 40, 4]]);
  const crypt = s.buildings.find(b => b.owner === 1 && b.type === 'hq');
  eq(createGame(1).buildings.find(b => b.owner === 1).grave, RULES.graveHqStart, 'the Crypt starts on graves');
  const w = addBuilding(s, 1, 'well', 31.5, 12.5, 0, true);
  let r = resolveRound(s, holdAll(s));
  eq(r.state.buildings.find(b => b.id === w.id).grave, BUILDINGS.well.grave, 'graves spread at once: the full 10" by the end of the round');
  eq(r.state.buildings.find(b => b.id === crypt.id).grave, BUILDINGS.hq.grave, 'the Crypt at its full reach');
  // a new undead site spreads half its graves the moment it is placed
  const q = arena([[1, 'fighter', 40, 4]]); q.supply[1] = 100;
  const r1 = resolveRound(q, [orders(), { squads: {}, stances: {}, queue: { builds: [{ type: 'tower', x: 40, z: 12 }] } }]);
  const tw = r1.state.buildings.find(b => b.type === 'tower');
  eq(tw.grave, BUILDINGS.tower.grave, 'full by the end of its first round');
  ok(events(r1.log).some(e => e.type === 'graves' && e.id === tw.id));
  r.state.buildings.find(b => b.id === w.id).hp = 0;
  r = resolveRound(r.state, holdAll(r.state));
  ok(r.state.graves[1].some(g => g.x === 31.5 && g.r === BUILDINGS.well.grave), 'its graveyard stays');
  ok(placeError(r.state, 1, 'barracks', 24, 16) === '' || placeError(r.state, 1, 'barracks', 24, 16) !== 'Only in your third of the table', 'and you can build anywhere');
});

test('tech: research shares the training queue, is paid when it starts, and finishes for the whole side', () => {
  const s = k(); s.supply[0] = 200;
  const hq = s.buildings.find(b => b.owner === 0 && b.type === 'hq');
  addBuilding(s, 0, 'barracks', 6, 4, 0, true);
  // the Castle needs a Barracks; queue it with Men-at-arms behind it
  let r = resolveRound(s, [qo({ trains: { [hq.id]: ['tech:castle', 'fighter'] } }), ob()]);
  let H = r.state.buildings.find(b => b.id === hq.id);
  eq(H.train.tech, 'castle'); eq(H.queue.join(), 'fighter', 'the fighter waits behind the research');
  eq(r.state.supply[0], 200 - TECH.castle.cost + incomeOf(s, 0));
  ok(events(r.log).some(e => e.type === 'research' && e.tech === 'castle'));
  for (let i = 0; i < TECH.castle.rounds - 1; i++) r = resolveRound(r.state, [ob(), ob()]);
  ok(r.state.tech[0].includes('castle'), 'researched after ' + TECH.castle.rounds + ' rounds');
  H = r.state.buildings.find(b => b.id === hq.id);
  eq(BUILDINGS.hq.hp, 440); eq(bdef(H).hp, 600); eq(H.hp, 600, 'the Keep became a Castle (HP grows)'); eq(H.tier, 2);
  eq(bname(H, 'kingdom'), 'Castle');
  ok(events(r.log).some(e => e.type === 'researched' && e.tech === 'castle'));
});

test('tech: gates, prerequisites, doctrines and tech buildings', () => {
  const s = k(); s.supply[0] = 500;
  const hq = s.buildings.find(b => b.owner === 0 && b.type === 'hq');
  const bar = addBuilding(s, 0, 'barracks', 6, 4, 0, true);
  // tier gates: no Shieldwall or Outriders before the Castle; no Blacksmith either
  eq(gateOf(s, 0, 'tank'), 'castle'); eq(gateOf(s, 0, 'fighter'), '');
  let v = validateQueue(s, 0, { queue: { trains: { [bar.id]: ['tank', 'fighter'] } } });
  eq(v.tq[bar.id].join(), 'fighter', 'the gated Shieldwall is refused');
  eq(placeError(s, 0, 'forge', 9, 13), 'Needs the Castle');
  // prerequisites: Crop Rotation needs the Plough and the Castle; queued after them in the line it is fine
  eq(techError(s, 0, 'rotation', hq), 'Needs Heavy Plough');
  v = validateQueue(s, 0, { queue: { trains: { [hq.id]: ['tech:plough', 'tech:castle', 'tech:rotation'] } } });
  eq(v.tq[hq.id].join(), 'tech:plough,tech:castle,tech:rotation');
  // at the wrong building / twice
  eq(techError(s, 0, 'steel1', hq), 'Researched at the Blacksmith');
  v = validateQueue(s, 0, { queue: { trains: { [hq.id]: ['tech:plough', 'tech:plough'] } } });
  eq(v.tq[hq.id].length, 1, 'the same research only once');
  // doctrines: one pick locks the other
  finishTech(s, 0, 'castle');
  eq(gateOf(s, 0, 'tank'), ''); eq(placeError(s, 0, 'forge', 9, 13), '');
  v = validateQueue(s, 0, { queue: { trains: { [hq.id]: ['tech:knightly', 'tech:yeomanry'] } } });
  eq(v.tq[hq.id].join(), 'tech:knightly', 'only one doctrine of a pair');
  finishTech(s, 0, 'knightly');
  eq(techError(s, 0, 'yeomanry', hq), 'You chose Knightly Order');
  // the Citadel needs a Blacksmith or a Chapel
  eq(techError(s, 0, 'citadel', hq, [], [], true), 'Needs a Blacksmith or Chapel');
});

test('tech: effects reach squads, buildings and side rules', () => {
  const s = arena([[0, 'fighter', 10, 16], [0, 'ranged', 10, 20], [1, 'swarm', 40, 4], [1, 'hero', 40, 10]]);
  const mf = s.squads[0], cb = s.squads[1];
  const dmg0 = defOf(mf).attack.dmg, arm0 = defOf(mf).armor, hp0 = mf.hp, rng0 = defOf(cb).attack.range;
  finishTech(s, 0, 'steel1'); finishTech(s, 0, 'plate1'); finishTech(s, 0, 'bodkin'); finishTech(s, 0, 'legend');
  ok(Math.abs(defOf(mf).attack.dmg - dmg0 * 1.15) < 0.01, 'Steel Weapons I'); eq(defOf(mf).armor, arm0 + 2, 'Plate Armour I');
  eq(defOf(cb).attack.range, rng0 + 2, 'Bodkin Bolts');
  eq(mf.hp, hp0, 'no HP change without an HP research');
  eq(FACTIONS.kingdom.units.fighter.attack.dmg, dmg0, 'the base data is untouched');
  // a squad trained later gets it too; JSON clone keeps it
  const z = addSquad(s, 0, 'fighter', 12, 12);
  eq(defOf(z).armor, arm0 + 2);
  eq(defOf(JSON.parse(JSON.stringify(z))).armor, arm0 + 2, 'survives a clone');
  // HP research raises current HP with the max
  const sw = s.squads[2], swHp = sw.hp;
  finishTech(s, 1, 'bonetide');
  eq(sw.hp, swHp + 2 * sw.models, 'Bone Tide: +2 HP per model now');
  // pair 3, summon count, revive, souls, grave areas, income
  finishTech(s, 1, 'swarm3'); eq(pairOf('undead', 'swarm', tkOf(s, 1)), 3, 'Endless Swarm');
  finishTech(s, 1, 'horde'); eq(skillOf(defOf(s.squads[3]), 'summon').count, 3, 'Endless Horde');
  finishTech(s, 1, 'harvest'); eq(ruleOf(s, 1, 'soulPerModel'), 1);
  finishTech(s, 1, 'restless'); eq(ruleOf(s, 1, 'graveBlobMult', 1), 1.25);
  finishTech(s, 1, 'phylactery'); eq(RULES.reviveRounds + ruleOf(s, 1, 'reviveRounds'), RULES.reviveRounds - 1);
  const inc0 = incomeOf(s, 0); finishTech(s, 0, 'castle'); finishTech(s, 0, 'citadel'); finishTech(s, 0, 'guild');
  eq(incomeOf(s, 0), inc0 + 4, 'Guild Charter: Keep +4');
  eq(bonusCp(s, 0), 1, 'the Citadel: +1 command point');
});

test('tech: Endless Swarm trains three squads; a destroyed tech building keeps its research', () => {
  const s = arena([[0, 'fighter', 10, 4]]); s.supply[1] = 200;
  finishTech(s, 1, 'swarm3');
  const crypt = s.buildings.find(b => b.owner === 1 && b.type === 'hq');
  let r = resolveRound(s, [orders(), { squads: {}, stances: {}, queue: { trains: { [crypt.id]: ['swarm'] } } }]);
  r = resolveRound(r.state, [orders(), { squads: {}, stances: {} }]);
  eq(r.state.squads.filter(q => q.owner === 1 && q.role === 'swarm').length, 3);
  // research survives losing the building that did it
  const t = arena([[0, 'fighter', 10, 4]]); t.supply[1] = 200;
  finishTech(t, 1, 'mausoleum');
  const pit = addBuilding(t, 1, 'pit', 38, 13, 0, true);
  const r2 = resolveRound(t, [orders(), { squads: {}, stances: {}, queue: { trains: { [pit.id]: ['tech:bones1'] } } }]);
  ok(r2.state.buildings.find(b => b.id === pit.id).train.tech === 'bones1');
  finishTech(r2.state, 1, 'plating1');
  r2.state.buildings = r2.state.buildings.filter(b => b.id !== pit.id);
  ok(r2.state.tech[1].includes('plating1') && defOf(addSquad(r2.state, 1, 'fighter', 40, 20)).armor === FACTIONS.undead.units.fighter.armor + 1, 'kept');
});

test('tech: the AI tiers up and researches in an AI-vs-AI game', () => {
  let s = createGame(1, ['kingdom', 'undead'], 'crossing'); const mem = [aiMemory(), aiMemory()];
  while (s.winner === null && s.round < 40) s = resolveRound(s, [aiOrders(s, 0, mem[0]), aiOrders(s, 1, mem[1])]).state;
  ok(s.tech[0].length + s.tech[1].length >= 3, 'research done: ' + JSON.stringify(s.tech));
});

test('the Monolith: an ordinary Undead building on graves that heals and spreads graves', () => {
  ok(FACTIONS.undead.buildings.includes('monolith'), 'in the build menu');
  for (const r of ['hero', 'mage']) ok(!skillOf(FACTIONS.undead.units[r], 'monolith'), r + ' has no Monolith skill');
  const u = arena([[1, 'fighter', 40, 4]]);
  eq(placeError(u, 1, 'monolith', 28, 11), 'Undead buildings must stand on your graves', 'not off graves');
  eq(placeError(u, 1, 'monolith', 38, 13), '', 'on the Crypt\'s graves');
  eq(BUILDINGS.monolith.cp, undefined, 'no command point');
  ok(!FACTIONS.undead.buildings.includes('banner') && FACTIONS.kingdom.buildings.includes('banner'), 'the Kingdom keeps its Banner');
  // queued, it starts, takes a rising slot, and rises in 2 rounds
  u.supply[1] = 99;
  const r = resolveRound(u, [orders(), { squads: {}, stances: { q1: 'hold' }, builds: [{ type: 'monolith', x: 38, z: 13, rot: 0 }] }]);
  const m = r.state.buildings.find(b => b.type === 'monolith');
  ok(m && m.build > 0 && m.grave === BUILDINGS.monolith.grave, 'a rising Monolith with its graves');
  const fc = startQueues(r.state, 1, { bq: [{ qid: 'a', type: 'wall', x: 41, z: 22, rot: 1 }, { qid: 'b', type: 'wall', x: 41, z: 10, rot: 1 }] });
  ok(fc.builds[0].starts && fc.builds[1].wait === 'rising', 'it takes one of the 2 rising slots: ' + JSON.stringify(fc.builds));
  const t = resolveRound(r.state, holdAll(r.state)).state;
  eq(t.buildings.find(b => b.type === 'monolith').build, 0, 'risen after 2 rounds');
  // healing: a hurt squad next to a finished Monolith regains HP at the end of the round
  const h = arena([[1, 'fighter', 30, 12, { hp: 20, models: 3 }]]);
  addBuilding(h, 1, 'monolith', 30, 9.5, 0, true);
  const hr = resolveRound(h, holdAll(h));
  eq(hr.state.squads[0].hp, 20 + BUILDINGS.monolith.heal.hp * 3); ok(events(hr.log).some(e => e.type === 'heal'));
});

test('a side loses only when its HQ falls (no squads and no barracks is not a loss)', () => {
  const s = arena([[0, 'fighter', 10, 16]]);
  const r = resolveRound(s, holdAll(s));
  eq(r.state.winner, null, 'the Undead have no squads and no barracks but still have the Crypt');
});

test('Necromancers: a weaker caster troop with mana; its summon raises one squad', () => {
  const N = FACTIONS.undead.units.mage;
  ok(N && N.mana && N.models === 2); eq(FACTIONS.undead.units.hero.name, 'Lich');
  const s = arena([[1, 'mage', 30, 16]]);
  const o = holdAll(s); o[1].squads.q1 = plan([{ kind: 'summon', x: 27, z: 16 }]);
  const r = resolveRound(s, o);
  eq(r.state.squads.filter(q => q.role === 'summon').length, 1, 'one squad');
  eq(r.state.squads[0].mana, N.mana.start - N.skills.find(k => k.kind === 'summon').mana + N.mana.regen);
});

test('Undead economy: a steady Crypt and Soul Wells; cheap squads dying on graves pay back more than they cost; souls above the threshold decay', () => {
  eq(FACTIONS.undead.eco.hq, 6); eq(BUILDINGS.well.income, 6);
  eq(soulDecayOf(RULES.soulKeep), 0); eq(soulDecayOf(RULES.soulKeep + 50), Math.floor(50 * RULES.soulDecay));
  const U = FACTIONS.undead.units, back = r => U[r].models * RULES.soulPerModel;
  const per = r => FACTIONS.undead.train[r] / (U[r].pair || 1);
  ok(back('swarm') > per('swarm') && back('fighter') > per('fighter'), 'cheap: profit');
  ok(back('tank') < per('tank') && back('fast') < per('fast'), 'elite: loss');
});

test('undead buildings rise out of the ground with no builders (two at a time) and mend', () => {
  const s = arena([[1, 'fighter', 40, 4]]); s.supply[1] = 200;
  let r = resolveRound(s, [ob(), qo({ builds: [{ type: 'tower', x: 40, z: 10 }, { type: 'barracks', x: 39, z: 22 }, { type: 'wall', x: 38, z: 13 }] })]);
  eq(r.state.buildings.filter(b => b.owner === 1 && b.build > 0).length, 2, 'two rise at once');
  eq(r.state.bq[1].length, 1, 'the third waits');
  eq(startQueues(r.state, 1).builds[0].wait, 'rising');
  const tw = r.state.buildings.find(b => b.type === 'tower');
  eq(tw.build, BUILDINGS.tower.work - RULES.riseWork, 'rose by riseWork at the end of the round');
  for (let i = 0; i < 3; i++) r = resolveRound(r.state, [ob(), ob()]);
  const t2 = r.state.buildings.find(b => b.type === 'tower');
  eq(t2.build, 0, 'finished by itself'); eq(t2.hp, BUILDINGS.tower.hp);
  t2.hp = 50; r = resolveRound(r.state, [ob(), ob()]);
  eq(r.state.buildings.find(b => b.type === 'tower').hp, 50 + Math.round(BUILDINGS.tower.hp * RULES.undeadMend), 'mends a little every round');
});

test('the enemy HQ is unknown until seen, then remembered', () => {
  const s = arena([[0, 'fast', 20, 16]]);
  let r = resolveRound(s, holdAll(s));
  ok(!knownEnemyHq(r.state, 0), 'not seen from the middle');
  const s2 = arena([[0, 'fast', 36, 16]]);
  r = resolveRound(s2, holdAll(s2));
  ok(knownEnemyHq(r.state, 0), 'scouted');
  const t = r.state; t.squads = [];
  ok(knownEnemyHq(resolveRound(t, holdAll(t)).state, 0), 'remembered after the scout is gone');
});

test('watchtowers fire in a Buildings segment after the tiers', () => {
  const s = arena([[1, 'fighter', 10, 8]]);
  addBuilding(s, 0, 'tower', 5, 8, 0, true);
  const { log } = resolveRound(s, holdAll(s));
  const seg = log.segments.find(g => g.kind === 'tier' && g.tier === 0);
  ok(seg, 'buildings segment');
  ok(seg.events.some(e => e.type === 'hit' && e.dst === 'q1'), 'tower hits');
});

test('buildings block movement and shots, and can be attacked', () => {
  const s = arena([[0, 'fighter', 6, 5], [1, 'ranged', 14, 5]]);
  const w = addBuilding(s, 0, 'wall', 10, 5, 1, true);   // a palisade across the line
  const o = holdAll(s);
  o[1].squads.q2 = plan([{ kind: 'volley', x: 6, z: 5 }]);
  const { log } = resolveRound(s, o);
  const rel = events(log).find(e => e.type === 'release' && e.id === 'q2');
  eq(rel.hit.join(), w.id, 'the volley hits the palisade');
});

test('destroying the enemy HQ wins', () => {
  const s = arena([[0, 'fighter', 42.4, 16]]);
  const hq = s.buildings.find(b => b.owner === 1 && b.type === 'hq'); hq.hp = 5;
  const o = holdAll(s);
  o[0].squads.q1 = plan([{ kind: 'strike', x: 44.5, z: 16 }]);
  const r = resolveRound(s, o);
  eq(r.state.winner, 0);
});

console.log('M4 online');

test('online: host and guest stay in sync (same seed, orders sent as JSON, guest re-resolves)', () => {
  for (const factions of [['kingdom', 'undead'], ['undead', 'undead']]) {
    let host = createGame(4242, factions), guest = createGame(4242, factions);
    eq(JSON.stringify(host), JSON.stringify(guest), 'same start');
    const mem = [aiMemory(), aiMemory()];
    for (let r = 0; r < 6 && host.winner === null; r++) {
      const orders = JSON.parse(JSON.stringify([aiOrders(host, 0, mem[0]), aiOrders(guest, 1, mem[1])]));
      const h = resolveRound(host, orders);
      const wire = JSON.parse(JSON.stringify({ orders, post: h.state }));   // the 'result' message
      const g = resolveRound(guest, wire.orders);
      eq(JSON.stringify(g.state), JSON.stringify(wire.post), 'round ' + host.round + ' matches');
      host = h.state; guest = wire.post;
    }
  }
});

test('mirror match: the second army gets the alternate paint scheme', () => {
  const s = createGame(3, ['kingdom', 'kingdom']);
  eq(s.players[1].paint, 'kingdomAlt');
  ok(s.squads.filter(q => q.owner === 1).every(q => q.paint === 'kingdomAlt') && s.squads.filter(q => q.owner === 0).every(q => q.paint === 'kingdom'));
  eq(createGame(3, ['kingdom', 'undead']).players[1].paint, 'undead');
});

console.log('M5 maps');

test('every map: point-symmetric terrain, deployments clear of obstacles, HQ spots on the board', () => {
  for (const id of MAP_ORDER) {
    const s = createGame(5, ['kingdom', 'undead'], id), W = s.board.w, H = s.board.h;
    eq(s.map, id);
    const key = t => t.kind + Math.round(t.x * 10) + ',' + Math.round(t.z * 10);
    const set = new Set(s.terrain.filter(t => t.kind !== 'board').map(key));
    for (const t of s.terrain) if (t.kind !== 'board') ok(set.has(key({ ...t, x: W - t.x, z: H - t.z })), id + ': mirror of ' + key(t));
    for (const q of s.squads) ok(!pointBlocked(obstacles(s), q.x, q.z, radiusOf(q) * 0.9), id + ': ' + q.role + ' deploys clear');
    for (const b of s.buildings) ok(b.x > 0 && b.x < W && b.z > 0 && b.z < H, id + ': HQ on the board');
    eq(s.shrines.length, MAPS[id].sites.length * 2);
  }
});

test('lakes block movement but not sight or shots', () => {
  const s = createGame(2, ['kingdom', 'undead'], 'highland');
  const lake = s.terrain.find(t => t.kind === 'lake');
  ok(pointBlocked(s.terrain, lake.x, lake.z, 0.5), 'cannot stand in the lake');
  ok(canSee(s.terrain, lake.x - lake.r - 1, lake.z, 12, lake.x + lake.r + 1, lake.z), 'can see across');
  ok(losCut(s.terrain, lake.x - lake.r - 1, lake.z, lake.x + lake.r + 1, lake.z) === 1, 'can shoot across');
});

test('big maps: build zone, army cap and pathing follow the map', () => {
  const s = createGame(3, ['kingdom', 'undead'], 'greatfield');
  eq(s.board.zone, Math.round(80 / 3)); eq(s.board.cap, RULES.armyCap + 8); eq(RULES.armyCap, 30);
  const nav = Nav.for(obstacles(s), 1, 'gf');
  ok(nav.path(5, 5, 75, 47).length > 0, 'a path across the great field');
  ok(!placeError(s, 0, 'farm', 22, 20) || placeError(s, 0, 'farm', 22, 20) !== 'Only in your third of the table', 'x 22 is in your third on an 80 wide table');
});

test('AI difficulty: the AI income multiplier', () => {
  const s = createGame(1, ['kingdom', 'undead'], 'crossing', { incomeMult: [1, 1.25] });
  eq(incomeOf(s, 1), Math.round(FACTIONS.undead.eco.hq * 1.25));
  eq(incomeOf(s, 0), FACTIONS.kingdom.eco.hq);
});

test('online sync on the biggest map', () => {
  let host = createGame(77, ['undead', 'kingdom'], 'greatfield'), guest = createGame(77, ['undead', 'kingdom'], 'greatfield');
  const mem = [aiMemory(), aiMemory()];
  for (let r = 0; r < 4; r++) {
    const orders = JSON.parse(JSON.stringify([aiOrders(host, 0, mem[0]), aiOrders(guest, 1, mem[1])]));
    const h = resolveRound(host, orders), g = resolveRound(guest, orders);
    eq(JSON.stringify(g.state), JSON.stringify(h.state), 'round ' + host.round);
    host = h.state; guest = JSON.parse(JSON.stringify(h.state));
  }
});

test('AI attack plan: on a big map the AI gathers, then its attack reaches a passive player\'s base', () => {
  let s = createGame(3, ['kingdom', 'undead'], 'greatfield'); const mem = aiMemory();
  const phases = new Set(); let closest = 1e9;
  const hq0 = () => s.buildings.find(b => b.owner === 0 && b.type === 'hq');
  for (let r = 0; r < 30 && s.winner === null; r++) {
    const ai = aiOrders(s, 1, mem);
    phases.add(mem.atk.state);
    const passive = { squads: {}, stances: Object.fromEntries(s.squads.filter(q => q.owner === 0).map(q => [q.id, 'hold'])) };   // squads start on Advance now
    s = resolveRound(s, [passive, ai]).state;
    const h = hq0(); if (h) for (const q of s.squads.filter(q => q.owner === 1 && q.role !== 'builder')) closest = Math.min(closest, Math.hypot(q.x - h.x, q.z - h.z));
  }
  ok(phases.has('gather') && phases.has('attack'), 'gathers and attacks: ' + [...phases]);
  ok(closest < 14 || s.winner === 1, 'the wave reached the base (closest ' + closest.toFixed(1) + ')');
});

console.log('M6 the AI');

const aiGame = (seed, fac, map, rounds, opts = [{}, {}]) => {
  let s = createGame(seed, fac, map); const mem = [aiMemory(), aiMemory()];
  const seen = [new Set(), new Set()];
  while (s.winner === null && s.round < rounds) {
    s = resolveRound(s, [aiOrders(s, 0, mem[0], opts[0]), aiOrders(s, 1, mem[1], opts[1])]).state;
    for (const p of [0, 1]) seen[p].add(mem[p].atk.state);
  }
  return { s, mem, seen };
};

test('AI: deterministic (same seed and memory -> the same orders)', () => {
  const run = () => { let s = createGame(11, ['kingdom', 'undead'], 'twinrivers'); const mem = [aiMemory(), aiMemory()], out = [];
    for (let r = 0; r < 10; r++) { const o = [aiOrders(s, 0, mem[0]), aiOrders(s, 1, mem[1])]; out.push(JSON.stringify(o)); s = resolveRound(s, o).state; }
    return out.join('\n'); };
  eq(run(), run());
});

test('AI: fog of war (moving enemy squads it cannot see does not change its orders)', () => {
  const { s, mem } = aiGame(4, ['kingdom', 'undead'], 'crossing', 14);
  for (const p of [0, 1]) {
    const vis = visibleTo(s, p), s2 = JSON.parse(JSON.stringify(s));
    let moved = 0;
    for (const q of s2.squads) if (q.owner !== p && q.hp > 0 && !vis.has(q.id)) {
      const x = q.x, z = q.z; q.x += 0.7; q.hp = Math.max(1, q.hp - 3);
      if (visibleTo(s2, p).has(q.id)) { q.x = x; q.z = z; } else moved++;
    }
    const a = aiOrders(s, p, JSON.parse(JSON.stringify(mem[p]))), b = aiOrders(s2, p, JSON.parse(JSON.stringify(mem[p])));
    eq(JSON.stringify(b), JSON.stringify(a), 'side ' + p + ' (' + moved + ' hidden squads moved)');
  }
});

test('AI: never orders more squads by hand than its command points allow', () => {
  let s = createGame(6, ['undead', 'kingdom'], 'highland'); const mem = [aiMemory(), aiMemory()];
  for (let r = 0; r < 30 && s.winner === null; r++) {
    const o = [aiOrders(s, 0, mem[0]), aiOrders(s, 1, mem[1])];
    for (const p of [0, 1]) eq(cpUsage(s, p, o[p]).rejected.length, 0, 'round ' + s.round + ' side ' + p);
    s = resolveRound(s, o).state;
  }
});

test('AI: combat prediction favours the bigger and the better army', () => {
  const s = arena([[0, 'fighter', 10, 10], [0, 'fighter', 10, 13], [0, 'fighter', 10, 16], [1, 'fighter', 30, 10], [1, 'swarm', 30, 13]]);
  const A = s.squads.filter(q => q.owner === 0), B = s.squads.filter(q => q.owner === 1);
  ok(fightRatio(A, B) > 1.2, 'three Men-at-arms beat a Warrior and a Warband: ' + fightRatio(A, B).toFixed(2));
  ok(fightRatio(B, A) < 0.8, 'and the other way round');
  ok(fightRatio(A.slice(0, 1), A.slice(0, 2)) < fightRatio(A.slice(0, 2), A.slice(0, 1)), 'more of the same is stronger');
  // the matchup table (combat simulator) knows ranged squads beat slow melee in the open
  ok(MATCHUPS['kingdom>undead'].ranged.fighter > 0.3, 'Crossbows beat Skeleton Warriors');
  ok(MATCHUPS['undead>kingdom'].ranged.fighter > 0.3, 'Bone Archers beat Men-at-arms');
});

test('AI: difficulty is skill; only Brutal cheats (+30 % income)', () => {
  ok(SKILL.easy.delay > 0 && !SKILL.easy.focus && SKILL.easy.mistake > 0, 'easy is slow and sloppy');
  ok(SKILL.hard.focus && SKILL.hard.kite && !SKILL.hard.mistake, 'hard is sharp');
  eq(JSON.stringify(SKILL.brutal), JSON.stringify(SKILL.hard), 'brutal plays like hard');
  eq(BRUTAL_INCOME, 1.3);
  ok(!/aiMult = \{ easy/.test(String(createGame)), 'no income change for easy / hard');
});

test('AI: personalities are a seeded pick (or the one asked for), three per faction', () => {
  for (const f of ['kingdom', 'undead']) {
    eq(PERSONALITIES[f].length, 3, f);
    const ids = new Set();
    for (let seed = 1; seed <= 30; seed++) ids.add(pickPersonality(f, seed, 1).id);
    eq(ids.size, 3, f + ': every personality comes up');
    eq(pickPersonality(f, 5, 1).id, pickPersonality(f, 5, 1).id, 'same seed, same pick');
  }
  const s = createGame(3, ['kingdom', 'undead']), mem = aiMemory();
  eq(aiPersonality(s, 1, mem, { personality: 'necrarch' }).id, 'necrarch');
  aiOrders(s, 1, mem);
  eq(mem.personality.id, 'necrarch', 'kept in memory');
});

test('AI: every personality builds, researches and attacks', () => {
  for (const f of ['kingdom', 'undead']) for (const P of PERSONALITIES[f]) {
    const fac = f === 'kingdom' ? ['kingdom', 'undead'] : ['undead', 'kingdom'];
    // a personality on the back foot may not attack in one game: it must in at least one of two
    const games = [2, 3].map(seed => aiGame(seed, fac, 'twinrivers', 45, [{ personality: P.id }, {}]));
    for (const { s } of games) {
      const built = (s.buildings || []).filter(b => b.owner === 0).length;
      ok(built >= 3 || s.winner !== null, P.id + ' builds (' + built + ')');
    }
    // a side whose army is beaten early can't afford research: it must research in at least one game
    ok(games.some(({ s }) => (s.tech[0] || []).length >= 1 || s.winner === 1), P.id + ' researches');
    ok(games.some(({ s, seen }) => seen[0].has('attack') || s.winner !== null), P.id + ' attacks: ' + games.map(g => [...g.seen[0]]).join(' / '));
  }
});

test('AI: the new AI beats the legacy AI with both factions', () => {
  let wins = 0, games = 0;
  for (const seed of [1, 2]) for (const fac of [['kingdom', 'undead'], ['undead', 'kingdom']]) {
    let s = createGame(seed, fac, 'crossing'); const mem = [aiMemory(), legacyMemory()];
    while (s.winner === null && s.round < 100) s = resolveRound(s, [aiOrders(s, 0, mem[0]), legacyOrders(s, 1, mem[1])]).state;
    games++; if (s.winner === 0) wins++;
  }
  ok(wins >= 3, 'new AI won ' + wins + ' of ' + games);
});

test('AI: thinking time stays small on the biggest map', () => {
  let s = createGame(8, ['kingdom', 'undead'], 'greatfield'); const mem = [aiMemory(), aiMemory()];
  let ms = 0, n = 0;
  for (let r = 0; r < 35 && s.winner === null; r++) {
    const t0 = performance.now(); const o = [aiOrders(s, 0, mem[0]), aiOrders(s, 1, mem[1])]; ms += performance.now() - t0; n += 2;
    s = resolveRound(s, o).state;
  }
  ok(ms / n < 150, 'average ' + (ms / n).toFixed(1) + ' ms per AI turn');
});

test('squads and peasants do not get stuck (tools/stuck.mjs)', () => {
  const r = stuckReport(1, ['crossing', 'twinrivers'], 35);
  ok(r.streak <= 1, 'stuck 3+ rounds in a row: ' + r.streak + ' ' + JSON.stringify(r.causes));
  ok(r.stuck / Math.max(1, r.rounds) < 0.04, 'stuck walks ' + r.stuck + ' of ' + r.rounds);
});

console.log('M7 economy, passives, no-build zone, tech chips');

test('income is itemised: the parts add up, and the round logs gathering, souls and decay', () => {
  let s = createGame(5, ['kingdom', 'undead'], 'crossing');
  const mem = [aiMemory(), aiMemory()];
  for (let r = 0; r < 14; r++) {
    const res = resolveRound(s, [aiOrders(s, 0, mem[0]), aiOrders(s, 1, mem[1])]);
    for (const p of [0, 1]) {
      const e = events(res.log).find(x => x.type === 'income' && x.owner === p);
      const P = e.parts;
      eq(P.hq + P.mine + P.well + P.farm + P.other + P.brutal, e.amount, 'flat parts add up (side ' + p + ')');
      const gathered = events(res.log).filter(x => x.type === 'gather' && x.owner === p).reduce((n, x) => n + x.amount, 0);
      eq(Object.values(P.gathered).reduce((n, v) => n + v, 0), gathered, 'gathered matches the gather events');
      const souls = events(res.log).filter(x => x.type === 'souls' && x.owner === p).reduce((n, x) => n + x.amount, 0);
      eq(P.souls, souls, 'souls match');
    }
    s = res.state;
  }
});

test('souls above the threshold decay at the end of the round', () => {
  const s = arena([[0, 'fighter', 10, 4]]); s.supply[1] = 200;
  const r = resolveRound(s, [orders(), orders()]);
  const e = events(r.log).find(x => x.type === 'income' && x.owner === 1);
  eq(e.parts.decay, soulDecayOf(200 + e.amount));
  eq(r.state.supply[1], 200 + e.amount - e.parts.decay);
  ok(r.state.supply[0] >= 60, 'gold never decays');
});

test('a Warband dying on your graves returns more souls than it cost', () => {
  const U = FACTIONS.undead.units;
  ok(U.swarm.models * RULES.soulPerModel > FACTIONS.undead.train.swarm / U.swarm.pair);
});

test('passives: every unit type has one; Rend stacks cut damage and AP, then run out', () => {
  for (const f of ['kingdom', 'undead']) for (const [r, u] of Object.entries(FACTIONS[f].units)) ok(u.passive && u.passive.name && u.passive.desc, f + ' ' + r);
  const s = arena([[1, 'swarm', 20, 16], [0, 'fighter', 22.3, 16]]);
  const o = holdAll(s); o[1].squads.q1 = plan([{ kind: 'strike', t: 'q2', x: 22.3, z: 16 }, { kind: 'strike', t: 'q2', x: 22.3, z: 16 }]);
  let r = resolveRound(s, o);
  const mf = r.state.squads.find(q => q.id === 'q2');
  eq(mf.rend.n, 2, 'two hits, two stacks');
  eq(apFor(mf), Math.round(RULES.ap * (1 - 2 * 0.05)), 'less AP');
  r = resolveRound(r.state, [orders(), orders()]);
  ok(!r.state.squads.find(q => q.id === 'q2').rend, 'it lasts through its next round (with less AP), then runs out');
  // max 10 stacks
  eq(FACTIONS.undead.units.swarm.passive.max, 10);
  const t = arena([[1, 'swarm', 20, 16], [0, 'fighter', 22.3, 16]]); t.squads[1].rend = { n: 10, dmg: 0.05, ap: 0.05, until: t.round + 1 };
  const o2 = holdAll(t); o2[1].squads.q1 = plan([{ kind: 'strike', t: 'q2', x: 22.3, z: 16 }]);
  eq(resolveRound(t, o2).state.squads.find(q => q.id === 'q2').rend.n, 10, 'capped at 10');
});

test('passives: Soul Drain heals the Lich; Berserk hits harder when low; Bulwark blunts shots', () => {
  const s = arena([[1, 'hero', 20, 16], [0, 'fighter', 28, 16]]);
  s.squads[0].hp = 100;
  const o = holdAll(s); o[1].squads.q1 = plan([{ kind: 'volley', x: 28, z: 16 }]);
  const r = resolveRound(s, o);
  ok(events(r.log).some(e => e.type === 'heal' && e.id === 'q1' && e.drain), 'drained');
  const b = arena([[0, 'hero', 20, 16], [1, 'fighter', 22, 16]]);
  const full = () => { const o = holdAll(b); o[0].squads.q1 = plan([{ kind: 'strike', t: 'q2', x: 22, z: 16 }]); return events(resolveRound(b, o).log).find(e => e.type === 'hit' && e.src === 'q1').raw; };
  const hi = full(); b.squads[0].hp = 50; const lo = full();
  ok(lo > hi * 1.4, 'berserk: ' + hi + ' -> ' + lo);
  const w = arena([[1, 'ranged', 20, 6], [0, 'tank', 20, 16], [0, 'fighter', 30, 16]]);
  const shoot = id => { const o = holdAll(w); o[1].squads.q1 = plan([{ kind: 'volley', x: w.squads.find(q => q.id === id).x, z: 16 }]); return events(resolveRound(w, o).log).find(e => e.type === 'hit' && e.src === 'q1'); };
  w.squads[2].x = 20; w.squads[1].x = 40;
  const vsFighter = shoot('q3');
  w.squads[2].x = 40; w.squads[1].x = 20;
  const vsTank = shoot('q2');
  ok(vsTank.dmg < damageAfter(vsTank.raw, FACTIONS.kingdom.units.tank.armor, vsTank.defended), 'bulwark cuts it');
  ok(vsFighter, 'control');
});

test('passives: Grave-bound, Reassemble and Chilling Touch', () => {
  const s = arena([[1, 'fighter', 40, 16], [1, 'tank', 42, 20]]);
  s.squads[0].hp = 20; s.squads[0].models = 2;
  const r = resolveRound(s, holdAll(s));
  ok(events(r.log).some(e => e.type === 'heal' && e.id === 'q1' && e.reassemble), 'warriors reassemble on the Crypt graves');
  const c = arena([[1, 'fast', 20, 16], [0, 'fighter', 22.6, 16]]);
  const o = holdAll(c); o[1].squads.q1 = plan([{ kind: 'strike', t: 'q2', x: 22.6, z: 16 }]); o[0].squads.q2 = { ...plan([]), defends: 3 };
  const ev = events(resolveRound(c, o).log);
  ok(ev.some(e => e.type === 'chill' && e.id === 'q2'), 'a defend stripped');
});

test('no building within 16" of an enemy building your side has seen', () => {
  const s = createGame(1, ['kingdom', 'undead'], 'crossing');
  const ehq = s.buildings.find(b => b.owner === 1 && b.type === 'hq');
  for (const p of [0, 1]) s.explored[p] = s.explored[p].replace(/0/g, '1');   // pretend the side has seen it all
  const spot = { x: ehq.x - 2 - 10, z: ehq.z };
  const known = s.intel[0].known[ehq.id];
  if (!known) s.intel[0].known[ehq.id] = { id: ehq.id, owner: 1, type: 'hq', x: ehq.x, z: ehq.z, w: ehq.w, d: ehq.d, hp: ehq.hp };
  ok(/enemy building/.test(placeError(s, 0, 'tower', spot.x, spot.z)), 'blocked near the seen HQ: ' + placeError(s, 0, 'tower', spot.x, spot.z));
  delete s.intel[0].known[ehq.id];
  ok(!/enemy building/.test(placeError(s, 0, 'tower', spot.x, spot.z)), 'unseen: the zone does not apply');
});

test('every research has a short effect chip for the tech tree', () => {
  for (const t of Object.values(TECH)) ok(t.chip && t.chip.length <= 20, t.id + ': ' + t.chip);
});

console.log('M8 shooters locked in melee');

test('a shooter locked in melee: its planned volley becomes a melee strike at the enemy it fights', () => {
  const s = arena([[0, 'ranged', 20, 16], [1, 'fighter', 22.6, 16], [1, 'fighter', 30, 16]]);
  ok(engagedWith(s.squads[0], s.squads).length, 'engaged');
  const o = holdAll(s); o[0].squads.q1 = plan([{ kind: 'volley', x: 30, z: 16 }]);
  const ev = events(resolveRound(s, o).log);
  ok(ev.some(e => e.type === 'toMelee' && e.id === 'q1' && e.from === 'volley' && e.t === 'q2'), 'converted');
  const hit = ev.find(e => e.type === 'hit' && e.src === 'q1');
  eq(hit.kind, 'strike'); eq(hit.dst, 'q2');
  eq(hit.raw, Math.round(FACTIONS.kingdom.units.ranged.melee.dmg * 4 * RULES.strikeMult), 'its weaker melee attack');
});

test('ranged skills (tagged) turn into strikes while locked in melee, and cost nothing', () => {
  const s = arena([[0, 'ranged', 20, 16], [1, 'fighter', 22.6, 16]]);
  const o = holdAll(s); o[0].squads.q1 = plan([{ kind: 'pierce', x: 30, z: 16 }]);
  const r = resolveRound(s, o);
  ok(events(r.log).some(e => e.type === 'toMelee' && e.from === 'pierce'), 'converted');
  ok(!(r.state.squads.find(q => q.id === 'q1').cd || {}).pierce, 'no cooldown spent');
  ok(FACTIONS.undead.units.hero.skills.find(k => k.kind === 'thunder').ranged && !FACTIONS.undead.units.hero.skills.find(k => k.kind === 'summon').ranged, 'Dark Thunder is ranged, Summon is not');
});

test('not engaged: volleys fire as usual; shooters may also order a melee Strike', () => {
  const s = arena([[0, 'ranged', 20, 16], [1, 'fighter', 24, 16]]);
  let o = holdAll(s); o[0].squads.q1 = plan([{ kind: 'volley', x: 24, z: 16 }]);
  ok(!events(resolveRound(s, o).log).some(e => e.type === 'toMelee'), 'no conversion');
  o = holdAll(s); o[0].squads.q1 = plan([{ kind: 'strike', t: 'q2', x: 24, z: 16 }]);
  const v = validateOrders(s, 0, o[0]);
  eq(v.squads.q1.actions[0].kind, 'strike', 'a melee order is allowed');
  eq(actionCost(s.squads[0], v.squads.q1.actions[0]), FACTIONS.kingdom.units.ranged.melee.ap);
  ok(events(resolveRound(s, o).log).some(e => e.type === 'hit' && e.src === 'q1' && e.kind === 'strike'), 'it strikes (with a lunge)');
});

test('stance shooters locked in melee strike back; auto skills skip ranged skills', () => {
  const s = arena([[1, 'ranged', 20, 16], [0, 'fighter', 22.6, 16]]);
  const plan1 = buildStancePlan(s, s.squads[0], s.squads.filter(q => q.owner === 0));
  ok(plan1.actions.some(a => a.kind === 'strike') && !plan1.actions.some(a => a.kind === 'volley' || a.kind === 'storm'), JSON.stringify(plan1.actions.map(a => a.kind)));
});

test('auto skills rotate: a skill used last round scores lower than another usable one', () => {
  // the Chosen next to an enemy: Mighty Swing and Rally both apply; after a round with Mighty Swing it rallies first
  const s = arena([[0, 'hero', 20, 16], [0, 'fighter', 20, 18.6], [1, 'fighter', 22.2, 16]]);
  const hero = s.squads[0];
  const pick = () => { const pl = emptyPlan(); autoSkills(s, hero, s.squads[2], s.squads.filter(q => q.owner === 1), s.squads.filter(q => q.owner === 0), pl, 100); return pl.actions.map(a => a.kind); };
  const first = pick();
  hero.lastSk = [first[0]];
  const second = pick();
  ok(first[0] !== second[0], 'first ' + first + ', then ' + second);
});

test('Crossbows a bit weaker, the Lich hits harder', () => {
  eq(FACTIONS.kingdom.units.ranged.attack.dmg, 3.4); eq(skillOf(FACTIONS.kingdom.units.ranged, 'pierce').dmg, 4.5);
  eq(FACTIONS.undead.units.hero.attack.dmg, 13); eq(skillOf(FACTIONS.undead.units.hero, 'thunder').dmg, 17);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
