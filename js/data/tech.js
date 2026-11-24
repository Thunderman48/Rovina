// The tech tree: research done in the HQ and in tech buildings, in the same queue as training
// (paid when it starts, takes rounds, the building trains nothing meanwhile).
//  at       : the building type that researches it ('hq', 'forge', 'chapel', 'pit', 'sanctum')
//  tier     : 1 / 2 / 3 (the HQ's tier it belongs to; for the tree screen)
//  needs    : tech ids that must be done first; needsBuilding: a finished own building of one of these types
//  doctrine : an exclusive group: researching one item of the group locks the others for the game
//  hqTier   : the HQ upgrade itself (the HQ becomes that tier)
//  units    : [{ roles, hpPer, armor, defends, dmgMult, range, attackAp, manaMax, manaRegen, pair, skills: { kind: { add: {...}, mult: {...} } } }]
//  buildings: [{ types, hp, hpMult, fireDmg, fireRange, grave, heal, healAdd, workMult, cp, name }]
//  rules    : side-wide { farmGather, farmIncome, mineIncome, hqIncome, soulPerModel, graveBlobMult, reviveRounds, summonTtl, graveDrain }
// References: Warcraft III tiers (Town Hall -> Keep -> Castle) and Blacksmith / Graveyard / Temple of the
// Damned; Age of Empires ages and Mill / Mining Camp upgrades; StarCraft II Forge research in a building
// queue; Age of Mythology minor gods, Dawn of War commanders, C&C Generals powers for the exclusive picks.
const SOLDIERS = ['tank', 'fighter', 'ranged', 'fast'];
const SKELETONS = ['swarm', 'fighter', 'ranged', 'summon'];

export const TECH = {
  // ---------------------------------------------------------------- Kingdom
  castle:    { faction: 'kingdom', name: 'Castle', icon: 'goal', at: 'hq', cost: 60, rounds: 3, tier: 2, hqTier: 2, needsBuilding: ['barracks'],
               desc: 'Tier 2: the Keep becomes a Castle (HP 600, stronger fire). Unlocks Shieldwall and Outriders, the Blacksmith, the Chapel and a doctrine.',
               buildings: [{ types: ['hq'], hp: 600, fireDmg: 4, name: 'Castle' }] },
  citadel:   { faction: 'kingdom', name: 'Citadel', icon: 'goal', at: 'hq', cost: 100, rounds: 4, tier: 3, hqTier: 3, needs: ['castle'], needsBuilding: ['forge', 'chapel'],
               desc: 'Tier 3: the Citadel (HP 800, fire 5, +1 command point). Unlocks the strongest research and the last doctrine.',
               buildings: [{ types: ['hq'], hp: 800, fireDmg: 5, cp: 1, name: 'Citadel' }] },
  plough:    { faction: 'kingdom', name: 'Heavy Plough', icon: 'farm', at: 'hq', cost: 20, rounds: 1, tier: 1,
               desc: 'Farmers work faster: 7 AP per gold instead of 8.', rules: { farmGather: -1 } },
  rotation:  { faction: 'kingdom', name: 'Crop Rotation', icon: 'farm', at: 'hq', cost: 40, rounds: 2, tier: 2, needs: ['plough', 'castle'],
               desc: 'Every farm earns +1 gold a round by itself.', rules: { farmIncome: 1 } },
  shafts:    { faction: 'kingdom', name: 'Deep Shafts', icon: 'node', at: 'hq', cost: 35, rounds: 2, tier: 2, needs: ['castle'],
               desc: 'Mines earn +3 gold a round.', rules: { mineIncome: 3 } },
  guild:     { faction: 'kingdom', name: 'Guild Charter', icon: 'gold', at: 'hq', cost: 60, rounds: 3, tier: 3, needs: ['rotation', 'citadel'],
               desc: 'The Citadel earns +4 gold a round.', rules: { hqIncome: 4 } },
  steel1:    { faction: 'kingdom', name: 'Steel Weapons I', icon: 'attack', at: 'forge', cost: 30, rounds: 2, tier: 2,
               desc: 'Soldiers deal 15 % more damage.', units: [{ roles: SOLDIERS, dmgMult: 1.15 }] },
  steel2:    { faction: 'kingdom', name: 'Steel Weapons II', icon: 'attack', at: 'forge', cost: 50, rounds: 3, tier: 3, needs: ['steel1', 'citadel'],
               desc: 'Soldiers deal another 15 % more damage.', units: [{ roles: SOLDIERS, dmgMult: 1.15 }] },
  plate1:    { faction: 'kingdom', name: 'Plate Armour I', icon: 'defend', at: 'forge', cost: 30, rounds: 2, tier: 2,
               desc: 'Soldiers +2 armour.', units: [{ roles: SOLDIERS, armor: 2 }] },
  plate2:    { faction: 'kingdom', name: 'Plate Armour II', icon: 'defend', at: 'forge', cost: 50, rounds: 3, tier: 3, needs: ['plate1', 'citadel'],
               desc: 'Soldiers +2 more armour.', units: [{ roles: SOLDIERS, armor: 2 }] },
  bodkin:    { faction: 'kingdom', name: 'Bodkin Bolts', icon: 'range', at: 'forge', cost: 35, rounds: 2, tier: 2, needs: ['steel1'],
               desc: 'Crossbows shoot 2″ further; Piercing Bolt +2 damage.', units: [{ roles: ['ranged'], range: 2, skills: { pierce: { add: { dmg: 2, range: 2 } } } }] },
  legend:    { faction: 'kingdom', name: 'Heroic Legend', icon: 'hero', at: 'chapel', cost: 40, rounds: 2, tier: 2,
               desc: 'The Chosen +80 HP; Leap Strike reaches 2″ further.', units: [{ roles: ['hero'], hpPer: 80, skills: { leap: { add: { range: 2 } } } }] },
  valour:    { faction: 'kingdom', name: 'Valour', icon: 'rally', at: 'chapel', cost: 35, rounds: 2, tier: 2,
               desc: 'Rally reaches 2″ further and gives +2 more armour.', units: [{ roles: ['hero'], skills: { rally: { add: { radius: 2, armor: 2 } } } }] },
  hospital:  { faction: 'kingdom', name: 'Field Hospital', icon: 'heal', at: 'chapel', cost: 40, rounds: 2, tier: 2, needs: ['valour'],
               desc: 'Your squads within 4″ of a Chapel heal 6 HP per model a round.', buildings: [{ types: ['chapel'], heal: { radius: 4, hp: 6 } }] },
  chosen:    { faction: 'kingdom', name: 'Return of the Chosen', icon: 'revive', at: 'chapel', cost: 45, rounds: 3, tier: 3, needs: ['legend', 'citadel'],
               desc: 'A fallen hero comes back after 2 rounds of holding its spot instead of 3.', rules: { reviveRounds: -1 } },
  knightly:  { faction: 'kingdom', name: 'Knightly Order', icon: 'fast', at: 'hq', cost: 40, rounds: 2, tier: 2, needs: ['castle'], doctrine: 'kd2',
               desc: 'Doctrine: Outriders charge 40 % harder and get +2 armour.', units: [{ roles: ['fast'], armor: 2, skills: { charge: { mult: { dmg: 1.4 } } } }] },
  yeomanry:  { faction: 'kingdom', name: 'Free Yeomanry', icon: 'ranged', at: 'hq', cost: 40, rounds: 2, tier: 2, needs: ['castle'], doctrine: 'kd2',
               desc: 'Doctrine: Crossbows reload faster (volley 25 AP); peasants +3 armour and hit harder.',
               units: [{ roles: ['ranged'], attackAp: 25 }, { roles: ['builder'], armor: 3, dmgMult: 2 }] },
  crusade:   { faction: 'kingdom', name: 'Crusade', icon: 'attack', at: 'hq', cost: 70, rounds: 3, tier: 3, needs: ['citadel'], doctrine: 'kd3',
               desc: 'Doctrine: all soldiers deal 10 % more damage and get +1 defend.', units: [{ roles: SOLDIERS.concat(['hero']), dmgMult: 1.1, defends: 1 }] },
  fortress:  { faction: 'kingdom', name: 'Fortress Realm', icon: 'fortify', at: 'hq', cost: 70, rounds: 3, tier: 3, needs: ['citadel'], doctrine: 'kd3',
               desc: 'Doctrine: buildings +30 % HP, towers +2″ range, Palisades need half the work.',
               buildings: [{ types: ['hq', 'barracks', 'tower', 'farm', 'mine', 'banner', 'wall', 'forge', 'chapel'], hpMult: 1.3 }, { types: ['tower'], fireRange: 2 }, { types: ['wall'], workMult: 0.5 }] },

  // ---------------------------------------------------------------- Undead
  mausoleum: { faction: 'undead', name: 'Mausoleum', icon: 'goal', at: 'hq', cost: 40, rounds: 2, tier: 2, hqTier: 2, needsBuilding: ['barracks'],
               desc: 'Tier 2: the Crypt becomes a Mausoleum (HP 600, graves 12″). Unlocks Grave Guard and Wraiths (Ossuary), Necromancers (Crypt), the Charnel Pit, the Dark Sanctum and a doctrine.',
               buildings: [{ types: ['hq'], hp: 600, graveSet: 12, name: 'Mausoleum' }] },
  necropolis:{ faction: 'undead', name: 'Necropolis', icon: 'goal', at: 'hq', cost: 70, rounds: 4, tier: 3, hqTier: 3, needs: ['mausoleum'], needsBuilding: ['pit', 'sanctum'],
               desc: 'Tier 3: the Necropolis (HP 760, graves 14″). Unlocks the strongest research and the last doctrine.',
               buildings: [{ types: ['hq'], hp: 760, graveSet: 14, name: 'Necropolis' }] },
  restless:  { faction: 'undead', name: 'Restless Earth', icon: 'souls', at: 'hq', cost: 15, rounds: 1, tier: 1,
               desc: 'Graves spread 25 % more where things die.', rules: { graveBlobMult: 1.25 } },
  harvest:   { faction: 'undead', name: 'Soul Harvest', icon: 'souls', at: 'hq', cost: 30, rounds: 2, tier: 2, needs: ['mausoleum'],
               desc: 'Every model dying on your graves gives +1 soul.', rules: { soulPerModel: 1 } },
  blight:    { faction: 'undead', name: 'Spreading Blight', icon: 'souls', at: 'hq', cost: 25, rounds: 2, tier: 2, needs: ['restless'],
               desc: 'Every Undead building spreads its graves 2″ further.', buildings: [{ types: ['hq', 'barracks', 'tower', 'well', 'monolith', 'wall', 'pit', 'sanctum'], grave: 2 }] },
  massgraves:{ faction: 'undead', name: 'Mass Graves', icon: 'heal', at: 'hq', cost: 45, rounds: 3, tier: 3, needs: ['harvest', 'necropolis'],
               desc: 'Monoliths heal 4 more HP per model and spread graves 3″ further.', buildings: [{ types: ['monolith'], healAdd: 4, grave: 3 }] },
  bones1:    { faction: 'undead', name: 'Sharpened Bones I', icon: 'attack', at: 'pit', cost: 20, rounds: 2, tier: 2,
               desc: 'Skeletons deal 15 % more damage (Warband, Warriors, Archers, summons).', units: [{ roles: SKELETONS, dmgMult: 1.15 }] },
  bones2:    { faction: 'undead', name: 'Sharpened Bones II', icon: 'attack', at: 'pit', cost: 35, rounds: 3, tier: 3, needs: ['bones1', 'necropolis'],
               desc: 'Skeletons deal another 15 % more damage.', units: [{ roles: SKELETONS, dmgMult: 1.15 }] },
  plating1:  { faction: 'undead', name: 'Bone Plating I', icon: 'defend', at: 'pit', cost: 20, rounds: 2, tier: 2,
               desc: 'Skeletons +1 armour.', units: [{ roles: SKELETONS, armor: 1 }] },
  plating2:  { faction: 'undead', name: 'Bone Plating II', icon: 'defend', at: 'pit', cost: 35, rounds: 3, tier: 3, needs: ['plating1', 'necropolis'],
               desc: 'Skeletons +1 more armour.', units: [{ roles: SKELETONS, armor: 1 }] },
  swarm3:    { faction: 'undead', name: 'Endless Swarm', icon: 'swarm', at: 'pit', cost: 45, rounds: 3, tier: 3, needs: ['bones1', 'necropolis'],
               desc: 'Skeleton Warbands come three squads at a time instead of two.', units: [{ roles: ['swarm'], pair: 3 }] },
  shroud:    { faction: 'undead', name: 'Wraith Shroud', icon: 'fast', at: 'pit', cost: 30, rounds: 2, tier: 2,
               desc: 'Wraiths +2 armour; their charge hits 30 % harder.', units: [{ roles: ['fast'], armor: 2, skills: { charge: { mult: { dmg: 1.3 } } } }] },
  necromancy:{ faction: 'undead', name: 'Necromancy', icon: 'mage', at: 'sanctum', cost: 25, rounds: 2, tier: 2,
               desc: 'Necromancers +20 mana and +5 mana a round.', units: [{ roles: ['mage'], manaMax: 20, manaRegen: 5 }] },
  greater:   { faction: 'undead', name: 'Greater Summoning', icon: 'spawn', at: 'sanctum', cost: 35, rounds: 2, tier: 2, needs: ['necromancy'],
               desc: 'Summoned skeletons last 4 rounds instead of 3.', rules: { summonTtl: 1 } },
  chain:     { faction: 'undead', name: 'Chain Storm', icon: 'zone', at: 'sanctum', cost: 35, rounds: 2, tier: 2,
               desc: 'Dark Thunder jumps once more (the Lich and Necromancers).', units: [{ roles: ['hero', 'mage'], skills: { thunder: { add: { jumps: 1 } } } }] },
  phylactery:{ faction: 'undead', name: 'Phylactery', icon: 'revive', at: 'sanctum', cost: 45, rounds: 3, tier: 3, needs: ['greater', 'necropolis'],
               desc: 'The Lich comes back after 2 rounds instead of 3, and has +25 mana.', rules: { reviveRounds: -1 }, units: [{ roles: ['hero'], manaMax: 25 }] },
  bonetide:  { faction: 'undead', name: 'Bone Tide', icon: 'swarm', at: 'hq', cost: 30, rounds: 2, tier: 2, needs: ['mausoleum'], doctrine: 'ud2',
               desc: 'Doctrine: Warbands and Warriors +2 HP per model; Warriors train in 1 round.', units: [{ roles: ['swarm', 'fighter', 'summon'], hpPer: 2 }], rules: { fastWarriors: 1 } },
  darkarts:  { faction: 'undead', name: 'Dark Arts', icon: 'mage', at: 'hq', cost: 30, rounds: 2, tier: 2, needs: ['mausoleum'], doctrine: 'ud2',
               desc: 'Doctrine: the Lich and Necromancers regain 10 more mana a round; Dark Thunder hits 30 % harder.',
               units: [{ roles: ['hero', 'mage'], manaRegen: 10, skills: { thunder: { mult: { dmg: 1.3 } } } }] },
  horde:     { faction: 'undead', name: 'Endless Horde', icon: 'spawn', at: 'hq', cost: 60, rounds: 3, tier: 3, needs: ['necropolis'], doctrine: 'ud3',
               desc: 'Doctrine: Summon Warband raises one more squad (the Lich 3, Necromancers 2).', units: [{ roles: ['hero', 'mage'], skills: { summon: { add: { count: 1 } } } }] },
  plague:    { faction: 'undead', name: 'Plague of Graves', icon: 'souls', at: 'hq', cost: 60, rounds: 3, tier: 3, needs: ['necropolis'], doctrine: 'ud3',
               desc: 'Doctrine: enemy squads standing on your graves lose 1 HP per model at the end of every round.', rules: { graveDrain: 1 } },
};
for (const [id, t] of Object.entries(TECH)) t.id = id;

// tier gates: these roles train only once the HQ reached that tech
export const GATES = {
  kingdom: { tank: 'castle', fast: 'castle' },
  undead: { tank: 'mausoleum', fast: 'mausoleum', mage: 'mausoleum' },
};
// tech buildings need the HQ's tier 2
export const BUILDING_GATES = { forge: 'castle', chapel: 'castle', pit: 'mausoleum', sanctum: 'mausoleum' };
export const techOf = id => TECH[id] || null;
export const techsOf = faction => Object.values(TECH).filter(t => t.faction === faction);
// a sorted key for a side's finished tech list (squads and buildings carry it as `tk`)
export const techKey = list => (list || []).slice().sort().join(',');
export const keyList = tk => (tk ? tk.split(',') : []);

// ---- unit and building definitions with research applied (cached per key) ----
const unitCache = new Map(), bCache = new Map();
const deep = o => JSON.parse(JSON.stringify(o));
export function techUnit(base, faction, role, tk) {
  if (!tk) return base;
  const k = faction + '|' + role + '|' + tk;
  let d = unitCache.get(k);
  if (d) return d;
  d = deep(base);
  for (const id of keyList(tk)) for (const e of TECH[id]?.units || []) {
    if (!e.roles.includes(role)) continue;
    if (e.hpPer) d.hpPer += e.hpPer;
    if (e.armor) d.armor += e.armor;
    if (e.defends) d.defends = (d.defends || 0) + e.defends;
    if (e.dmgMult && d.attack) d.attack.dmg = Math.round(d.attack.dmg * e.dmgMult * 1000) / 1000;
    if (e.range && d.attack && d.attack.range !== undefined) d.attack.range += e.range;
    if (e.attackAp && d.attack) d.attack.ap = e.attackAp;
    if (d.mana && e.manaMax) d.mana.max += e.manaMax;
    if (d.mana && e.manaRegen) d.mana.regen += e.manaRegen;
    if (e.pair) d.pair = e.pair;
    for (const [kind, m] of Object.entries(e.skills || {})) {
      const sk = (d.skills || []).find(x => x.kind === kind);
      if (!sk) continue;
      for (const [f, v] of Object.entries(m.add || {})) sk[f] = Math.round(((sk[f] || 0) + v) * 1000) / 1000;
      for (const [f, v] of Object.entries(m.mult || {})) sk[f] = Math.round((sk[f] || 0) * v * 1000) / 1000;
    }
  }
  unitCache.set(k, d);
  return d;
}
export function techBuilding(base, type, tk) {
  if (!tk) return base;
  const k = type + '|' + tk;
  let d = bCache.get(k);
  if (d) return d;
  d = deep(base);
  for (const id of keyList(tk)) {
    const faction = TECH[id]?.faction;
    for (const e of TECH[id]?.buildings || []) {
      if (!e.types.includes(type)) continue;
      if (e.hp) d.hp = e.hp;
      if (e.fireDmg && d.fire) d.fire.dmg = e.fireDmg;
      if (e.fireRange && d.fire) d.fire.range += e.fireRange;
      if (e.graveSet && d.grave) d.grave = e.graveSet;
      if (e.grave && d.grave) d.grave += e.grave;
      if (e.heal) d.heal = { ...e.heal };
      if (e.healAdd && d.heal) d.heal.hp += e.healAdd;
      if (e.cp) d.cp = (d.cp || 0) + e.cp;
      if (e.name) d.name = { ...d.name, [faction]: e.name };
      if (e.workMult) d.work = Math.max(1, Math.round(d.work * e.workMult));
      if (e.hpMult) d.hpMult = (d.hpMult || 1) * e.hpMult;
    }
  }
  if (d.hpMult) { d.hp = Math.round(d.hp * d.hpMult); delete d.hpMult; }
  bCache.set(k, d);
  return d;
}
// side-wide rule bonuses from a finished tech list
export function techRules(list) {
  const r = {};
  for (const id of list || []) for (const [k, v] of Object.entries(TECH[id]?.rules || {})) r[k] = k.endsWith('Mult') ? (r[k] ?? 1) * v : (r[k] || 0) + v;
  return r;
}
