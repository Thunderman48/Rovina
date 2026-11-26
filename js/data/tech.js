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
               desc: 'Tier 2: the Keep becomes a Castle (HP 900, stronger fire). Opens the unit unlocks (Shieldwall Drill, Outrider Stables), the Blacksmith, the Chapel and a doctrine.',
               buildings: [{ types: ['hq'], hp: 900, fireDmg: 4, name: 'Castle' }] },
  citadel:   { faction: 'kingdom', name: 'Citadel', icon: 'goal', at: 'hq', cost: 100, rounds: 4, tier: 3, hqTier: 3, needs: ['castle'], needsBuilding: ['forge', 'chapel'],
               desc: 'Tier 3: the Citadel (HP 1200, fire 5, +1 command point). Unlocks the strongest research and the last doctrine.',
               buildings: [{ types: ['hq'], hp: 1200, fireDmg: 5, cp: 1, name: 'Citadel' }] },
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
               desc: 'Your squads within 4″ of a Chapel heal 9 HP per model a round.', buildings: [{ types: ['chapel'], heal: { radius: 4, hp: 9 } }] },
  chosen:    { faction: 'kingdom', name: 'Return of the Chosen', icon: 'revive', at: 'chapel', cost: 45, rounds: 3, tier: 3, needs: ['legend', 'citadel'],
               desc: 'A fallen hero comes back after 2 rounds of holding its spot instead of 3.', rules: { reviveRounds: -1 } },
  knightly:  { faction: 'kingdom', name: 'Knightly Order', icon: 'fast', at: 'hq', cost: 40, rounds: 2, tier: 2, needs: ['castle'], doctrine: 'kd2',
               desc: 'Doctrine: Outriders charge 40 % harder and get +2 armour.', units: [{ roles: ['fast'], armor: 2, skills: { charge: { mult: { dmg: 1.4 } } } }] },
  yeomanry:  { faction: 'kingdom', name: 'Free Yeomanry', icon: 'ranged', at: 'hq', cost: 40, rounds: 2, tier: 2, needs: ['castle'], doctrine: 'kd2',
               desc: 'Doctrine: Crossbows reload faster (volley 35 AP); peasants +3 armour and hit harder.',
               units: [{ roles: ['ranged'], attackAp: 35 }, { roles: ['builder'], armor: 3, dmgMult: 2 }] },
  crusade:   { faction: 'kingdom', name: 'Crusade', icon: 'attack', at: 'hq', cost: 70, rounds: 3, tier: 3, needs: ['citadel'], doctrine: 'kd3',
               desc: 'Doctrine: all soldiers deal 10 % more damage and get +1 defend.', units: [{ roles: SOLDIERS.concat(['hero']), dmgMult: 1.1, defends: 1 }] },
  fortress:  { faction: 'kingdom', name: 'Fortress Realm', icon: 'fortify', at: 'hq', cost: 70, rounds: 3, tier: 3, needs: ['citadel'], doctrine: 'kd3',
               desc: 'Doctrine: buildings +30 % HP, towers +2″ range, Palisades need half the work.',
               buildings: [{ types: ['hq', 'barracks', 'tower', 'farm', 'mine', 'banner', 'wall', 'forge', 'chapel'], hpMult: 1.3 }, { types: ['tower'], fireRange: 2 }, { types: ['wall'], workMult: 0.5 }] },

  // ---------------------------------------------------------------- Undead
  mausoleum: { faction: 'undead', name: 'Mausoleum', icon: 'goal', at: 'hq', cost: 40, rounds: 2, tier: 2, hqTier: 2, needsBuilding: ['barracks'],
               desc: 'Tier 2: the Crypt becomes a Mausoleum (HP 900, graves 12″). Opens the unit unlocks (Grave Vigil, Wraith Pact, Necromancer Circle), the Charnel Pit, the Dark Sanctum and a doctrine.',
               buildings: [{ types: ['hq'], hp: 900, graveSet: 12, name: 'Mausoleum' }] },
  necropolis:{ faction: 'undead', name: 'Necropolis', icon: 'goal', at: 'hq', cost: 70, rounds: 4, tier: 3, hqTier: 3, needs: ['mausoleum'], needsBuilding: ['pit', 'sanctum'],
               desc: 'Tier 3: the Necropolis (HP 1140, graves 14″). Unlocks the strongest research and the last doctrine.',
               buildings: [{ types: ['hq'], hp: 1140, graveSet: 14, name: 'Necropolis' }] },
  restless:  { faction: 'undead', name: 'Restless Earth', icon: 'souls', at: 'hq', cost: 15, rounds: 1, tier: 1,
               desc: 'Graves spread 25 % more where things die.', rules: { graveBlobMult: 1.25 } },
  harvest:   { faction: 'undead', name: 'Soul Harvest', icon: 'souls', at: 'hq', cost: 30, rounds: 2, tier: 2, needs: ['mausoleum'],
               desc: 'Every model dying on your graves gives +1 soul.', rules: { soulPerModel: 1 } },
  blight:    { faction: 'undead', name: 'Spreading Blight', icon: 'souls', at: 'hq', cost: 25, rounds: 2, tier: 2, needs: ['restless'],
               desc: 'Every Undead building spreads its graves 2″ further.', buildings: [{ types: ['hq', 'barracks', 'tower', 'well', 'monolith', 'wall', 'pit', 'sanctum'], grave: 2 }] },
  massgraves:{ faction: 'undead', name: 'Mass Graves', icon: 'heal', at: 'hq', cost: 45, rounds: 3, tier: 3, needs: ['harvest', 'necropolis'],
               desc: 'Monoliths heal 6 more HP per model and spread graves 3″ further.', buildings: [{ types: ['monolith'], healAdd: 6, grave: 3 }] },
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
               desc: 'Doctrine: Warbands and Warriors +3 HP per model; Warriors train in 1 round.', units: [{ roles: ['swarm', 'fighter', 'summon'], hpPer: 3 }], rules: { fastWarriors: 1 } },
  darkarts:  { faction: 'undead', name: 'Dark Arts', icon: 'mage', at: 'hq', cost: 30, rounds: 2, tier: 2, needs: ['mausoleum'], doctrine: 'ud2',
               desc: 'Doctrine: the Lich and Necromancers regain 10 more mana a round; Dark Thunder hits 30 % harder.',
               units: [{ roles: ['hero', 'mage'], manaRegen: 10, skills: { thunder: { mult: { dmg: 1.3 } } } }] },
  horde:     { faction: 'undead', name: 'Endless Horde', icon: 'spawn', at: 'hq', cost: 60, rounds: 3, tier: 3, needs: ['necropolis'], doctrine: 'ud3',
               desc: 'Doctrine: Summon Warband raises one more squad (the Lich 3, Necromancers 2).', units: [{ roles: ['hero', 'mage'], skills: { summon: { add: { count: 1 } } } }] },
  plague:    { faction: 'undead', name: 'Plague of Graves', icon: 'souls', at: 'hq', cost: 60, rounds: 3, tier: 3, needs: ['necropolis'], doctrine: 'ud3',
               desc: 'Doctrine: enemy squads standing on your graves lose 1 HP per model at the end of every round.', rules: { graveDrain: 1 } },

  // ---------------------------------------------------------------- longer tree (2026-11-25)
  // unit unlocks (Barracks / Ossuary, after Tier 2): elite squads need their own research
  drill:     { faction: 'kingdom', name: 'Shieldwall Drill', icon: 'tank', at: 'barracks', cost: 35, rounds: 2, tier: 2, needs: ['castle'],
               desc: 'Unlocks Shieldwall squads at the Barracks.' },
  stables:   { faction: 'kingdom', name: 'Outrider Stables', icon: 'fast', at: 'barracks', cost: 45, rounds: 3, tier: 2, needs: ['castle'],
               desc: 'Unlocks Outriders at the Barracks.' },
  vigil:     { faction: 'undead', name: 'Grave Vigil', icon: 'tank', at: 'barracks', cost: 25, rounds: 2, tier: 2, needs: ['mausoleum'],
               desc: 'Unlocks Grave Guard at the Ossuary.' },
  pact:      { faction: 'undead', name: 'Wraith Pact', icon: 'fast', at: 'barracks', cost: 30, rounds: 3, tier: 2, needs: ['mausoleum'],
               desc: 'Unlocks Wraiths at the Ossuary.' },
  circle:    { faction: 'undead', name: 'Necromancer Circle', icon: 'mage', at: 'barracks', cost: 35, rounds: 3, tier: 2, needs: ['mausoleum'],
               desc: 'Unlocks Necromancers at the Crypt.' },
  // level III of the weapon / armour lines (StarCraft-style rising costs: about x1.6 and a round longer)
  steel3:    { faction: 'kingdom', name: 'Steel Weapons III', icon: 'attack', at: 'forge', cost: 80, rounds: 4, tier: 3, needs: ['steel2'],
               desc: 'Soldiers deal another 15 % more damage.', units: [{ roles: SOLDIERS, dmgMult: 1.15 }] },
  plate3:    { faction: 'kingdom', name: 'Plate Armour III', icon: 'defend', at: 'forge', cost: 80, rounds: 4, tier: 3, needs: ['plate2'],
               desc: 'Soldiers +2 more armour.', units: [{ roles: SOLDIERS, armor: 2 }] },
  bones3:    { faction: 'undead', name: 'Sharpened Bones III', icon: 'attack', at: 'pit', cost: 55, rounds: 4, tier: 3, needs: ['bones2'],
               desc: 'Skeletons deal another 15 % more damage.', units: [{ roles: SKELETONS, dmgMult: 1.15 }] },
  plating3:  { faction: 'undead', name: 'Bone Plating III', icon: 'defend', at: 'pit', cost: 55, rounds: 4, tier: 3, needs: ['plating2'],
               desc: 'Skeletons +1 more armour.', units: [{ roles: SKELETONS, armor: 1 }] },
  // small upgrades
  whetstones:{ faction: 'kingdom', name: 'Whetstones', icon: 'attack', at: 'barracks', cost: 15, rounds: 1, tier: 1,
               desc: 'Men-at-arms deal 10 % more damage.', units: [{ roles: ['fighter'], dmgMult: 1.1 }] },
  padded:    { faction: 'kingdom', name: 'Padded Jacks', icon: 'defend', at: 'barracks', cost: 15, rounds: 1, tier: 1,
               desc: 'Crossbows +1 armour.', units: [{ roles: ['ranged'], armor: 1 }] },
  hardy:     { faction: 'kingdom', name: 'Hardy Peasants', icon: 'builder', at: 'hq', cost: 15, rounds: 1, tier: 1,
               desc: 'Peasants +6 HP per model.', units: [{ roles: ['builder'], hpPer: 6 }] },
  picks:     { faction: 'kingdom', name: 'Sharpened Picks', icon: 'node', at: 'hq', cost: 20, rounds: 1, tier: 1,
               desc: 'Peasants mine faster: 9 AP per gold instead of 10.', rules: { mineGather: -1 } },
  masonry:   { faction: 'kingdom', name: 'Masonry', icon: 'fortify', at: 'hq', cost: 35, rounds: 2, tier: 2, needs: ['castle'],
               desc: 'All your buildings +15 % HP.', buildings: [{ types: ['hq', 'barracks', 'tower', 'farm', 'mine', 'banner', 'wall', 'forge', 'chapel'], hpMult: 1.15 }] },
  hoardings: { faction: 'kingdom', name: 'Hoardings', icon: 'range', at: 'forge', cost: 30, rounds: 2, tier: 2,
               desc: 'Watchtowers and the Keep fire for +1 damage per shot.', buildings: [{ types: ['tower', 'hq'], fireAdd: 1 }] },
  horses:    { faction: 'kingdom', name: 'Horse Breeding', icon: 'fast', at: 'barracks', cost: 30, rounds: 2, tier: 2, needs: ['stables'],
               desc: 'Outriders move 1″ further a round.', units: [{ roles: ['fast'], move: 1 }] },
  dust:      { faction: 'undead', name: 'Grave Dust', icon: 'attack', at: 'hq', cost: 10, rounds: 1, tier: 1,
               desc: 'Skeleton Warbands deal 10 % more damage.', units: [{ roles: ['swarm', 'summon'], dmgMult: 1.1 }] },
  ossified:  { faction: 'undead', name: 'Ossified Skin', icon: 'defend', at: 'barracks', cost: 10, rounds: 1, tier: 1,
               desc: 'Skeleton Warriors +1 armour.', units: [{ roles: ['fighter'], armor: 1 }] },
  hollow:    { faction: 'undead', name: 'Hollow Bones', icon: 'ranged', at: 'barracks', cost: 10, rounds: 1, tier: 1,
               desc: 'Bone Archers move 0.6″ further a round.', units: [{ roles: ['ranged'], move: 0.6 }] },
  conduits:  { faction: 'undead', name: 'Soul Conduits', icon: 'souls', at: 'hq', cost: 20, rounds: 1, tier: 1,
               desc: 'Soul Wells earn +1 soul a round.', rules: { wellIncome: 1 } },
  bonemason: { faction: 'undead', name: 'Bone Masonry', icon: 'fortify', at: 'hq', cost: 30, rounds: 2, tier: 2, needs: ['mausoleum'],
               desc: 'All your buildings +15 % HP.', buildings: [{ types: ['hq', 'barracks', 'tower', 'well', 'monolith', 'wall', 'pit', 'sanctum'], hpMult: 1.15 }] },
  dread:     { faction: 'undead', name: 'Dread Spires', icon: 'range', at: 'pit', cost: 25, rounds: 2, tier: 2,
               desc: 'Bone Spires and the Crypt fire for +1 damage per shot.', buildings: [{ types: ['tower', 'hq'], fireAdd: 1 }] },
  spectral:  { faction: 'undead', name: 'Spectral Speed', icon: 'fast', at: 'barracks', cost: 25, rounds: 2, tier: 2, needs: ['pact'],
               desc: 'Wraiths move 1″ further a round.', units: [{ roles: ['fast'], move: 1 }] },
  // ability upgrades: a squad type gains a skill
  shielddrill:{ faction: 'kingdom', name: 'Shield Drill', icon: 'fortify', at: 'barracks', cost: 40, rounds: 2, tier: 2, needs: ['castle'],
               desc: 'Men-at-arms gain Lock Shields (hits from the front deal 30 % this round).',
               units: [{ roles: ['fighter'], addSkill: { kind: 'wall', name: 'Lock Shields', cat: 'defense', ap: 15, mult: 0.3, cosHalf: 0.5, cd: 1 } }] },
  firearrows:{ faction: 'kingdom', name: 'Fire Arrows', icon: 'shoot', at: 'forge', cost: 45, rounds: 3, tier: 2,
               desc: 'Crossbows gain Fire Volley: a circle of burning bolts (2.4 per model) within 14″, arcing over walls.',
               units: [{ roles: ['ranged'], addSkill: { kind: 'storm', name: 'Fire Volley', cat: 'attack', ranged: true, ap: 35, dmg: 2.4, range: 14, radius: 2, cd: 2 } }] },
  sweeping:  { faction: 'kingdom', name: 'Sweeping Blow', icon: 'sweep', at: 'chapel', cost: 50, rounds: 3, tier: 2,
               desc: 'The Chosen gains Sweep: a full circle swing (14) around him.',
               units: [{ roles: ['hero'], addSkill: { kind: 'sweep', name: 'Sweep', cat: 'attack', ap: 30, dmg: 14, reach: 1.6, cd: 2 } }] },
  boneshields:{ faction: 'undead', name: 'Bone Shields', icon: 'fortify', at: 'barracks', cost: 30, rounds: 2, tier: 2, needs: ['mausoleum'],
               desc: 'Skeleton Warriors gain Grave Wall (hits from the front deal 30 % this round).',
               units: [{ roles: ['fighter'], addSkill: { kind: 'wall', name: 'Grave Wall', cat: 'defense', ap: 15, mult: 0.3, cosHalf: 0.5, cd: 1 } }] },
  bonespears:{ faction: 'undead', name: 'Bone Spears', icon: 'range', at: 'pit', cost: 35, rounds: 3, tier: 2,
               desc: 'Bone Archers gain Bone Spear: a line that hits every enemy on it (2.8 per model), 15″.',
               units: [{ roles: ['ranged'], addSkill: { kind: 'pierce', name: 'Bone Spear', cat: 'attack', ranged: true, ap: 35, dmg: 2.8, range: 15, width: 0.7, cd: 2 } }] },
  shadowwalk:{ faction: 'undead', name: 'Shadow Walk', icon: 'disrupt', at: 'sanctum', cost: 45, rounds: 3, tier: 2, needs: ['pact'],
               desc: 'Wraiths gain Shadow Step: vanish and reappear up to 6″ away, no parting blows.',
               units: [{ roles: ['fast'], addSkill: { kind: 'step', name: 'Shadow Step', cat: 'move', ap: 20, range: 6, cd: 2 } }] },
};

// a short effect label for each research, shown on its tech tree node (the detail panel has the full text)
const CHIPS = {
  castle: 'Tier 2 · HP 900', citadel: 'Tier 3 · +1 CP', plough: 'Farming 7 AP', rotation: 'Farms +1', shafts: 'Mines +3', guild: 'Keep +4',
  steel1: '+15 % dmg', steel2: '+15 % dmg', plate1: '+2 armour', plate2: '+2 armour', bodkin: '+2″ range',
  legend: 'Hero +80 HP', valour: 'Rally +2 armour', hospital: 'Heal 6 / model', chosen: 'Revive 2 rnds',
  knightly: 'Charge ×1.4', yeomanry: 'Volley 35 AP', crusade: '+10 % dmg, +1 def', fortress: 'Bldg +30 % HP',
  mausoleum: 'Tier 2 · HP 900', necropolis: 'Tier 3 · HP 1140', restless: 'Graves ×1.25', harvest: '+1 soul / model',
  blight: 'Graves +2″', massgraves: 'Heal +4, graves +3″',
  bones1: '+15 % dmg', bones2: '+15 % dmg', plating1: '+1 armour', plating2: '+1 armour', swarm3: 'Pairs → 3',
  shroud: '+2 armour', necromancy: '+20 mana', greater: 'Summons 4 rnds', chain: '+1 jump', phylactery: 'Revive 2 rnds',
  bonetide: '+3 HP / model', darkarts: '+10 mana / rnd', horde: '+1 summon', plague: 'Drain 1 / model',
  drill: 'Unlocks Shieldwall', stables: 'Unlocks Outriders', vigil: 'Unlocks Grave Guard', pact: 'Unlocks Wraiths', circle: 'Unlocks Necromancers',
  steel3: '+15 % dmg', plate3: '+2 armour', bones3: '+15 % dmg', plating3: '+1 armour',
  whetstones: 'M-a-a +10 % dmg', padded: 'Crossbows +1 arm', hardy: 'Peasants +6 HP', picks: 'Mining 9 AP', masonry: 'Bldg +15 % HP', hoardings: 'Tower fire +1', horses: 'Outriders +1″',
  dust: 'Warband +10 % dmg', ossified: 'Warriors +1 arm', hollow: 'Archers +0.6″', conduits: 'Wells +1', bonemason: 'Bldg +15 % HP', dread: 'Spire fire +1', spectral: 'Wraiths +1″',
  shielddrill: '+Lock Shields', firearrows: '+Fire Volley', sweeping: 'Hero +Sweep', boneshields: '+Grave Wall', bonespears: '+Bone Spear', shadowwalk: 'Wraiths +Step',
};
for (const [id, c] of Object.entries(CHIPS)) if (TECH[id]) TECH[id].chip = c;
for (const [id, t] of Object.entries(TECH)) t.id = id;

// tier gates: these roles train only once the HQ reached that tech
// elite squads need their own unlock research (each needs the HQ's Tier 2 first)
export const GATES = {
  kingdom: { tank: 'drill', fast: 'stables' },
  undead: { tank: 'vigil', fast: 'pact', mage: 'circle' },
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
    if (e.move) d.move = Math.round((d.move + e.move) * 100) / 100;
    if (e.addSkill && !(d.skills || []).some(k => k.kind === e.addSkill.kind)) d.skills = (d.skills || []).concat([{ ...e.addSkill }]);
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
      if (e.fireAdd) d.fireAdd = (d.fireAdd || 0) + e.fireAdd;
    }
  }
  if (d.hpMult) { d.hp = Math.round(d.hp * d.hpMult); delete d.hpMult; }
  if (d.fireAdd) { if (d.fire) d.fire.dmg += d.fireAdd; delete d.fireAdd; }   // after any tier's fire
  bCache.set(k, d);
  return d;
}
// side-wide rule bonuses from a finished tech list
export function techRules(list) {
  const r = {};
  for (const id of list || []) for (const [k, v] of Object.entries(TECH[id]?.rules || {})) r[k] = k.endsWith('Mult') ? (r[k] ?? 1) * v : (r[k] || 0) + v;
  return r;
}
