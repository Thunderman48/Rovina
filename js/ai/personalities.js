// AI personalities and difficulty (skill) settings. A personality is a table of weights the strategy,
// economy and military managers read (like Age of Empires II "strategic numbers", Halo Wars 2 strategy
// tables and utility-based personalities): how aggressive and patient it is, how greedy for economy,
// how keen on tech, which squads it prefers, when it first attacks, its doctrines and research order.
//  aggression  0..1 : how readily it attacks (scales the attack utility)
//  greed       0..1 : economy weight (more farms / wells / peasants, later attacks)
//  tech        0..1 : research and tech-building weight
//  defense     0..1 : towers, walls, keeping squads home
//  attackRatio      : the predicted strength ratio (combat.js) it wants before launching an attack
//  firstAttack      : earliest round and army size for its first attack
//  mix              : preference multipliers per role when picking what to train
//  research         : priority per building (HQ / tech buildings); doctrines are listed in it
export const PERSONALITIES = {
  kingdom: [
    { id: 'warlord', name: 'Warlord', style: 'aggressive', blurb: 'Early pressure with Men-at-arms and The Chosen; Knightly Order and a Crusade.',
      aggression: 0.85, greed: 0.35, tech: 0.4, defense: 0.2, attackRatio: 1.05, firstAttack: { round: 6, army: 4 },
      mix: { fighter: 1.35, ranged: 0.85, tank: 0.8, fast: 1.3 }, farms: 2, peasants: 5,
      research: { barracks: ['whetstones', 'stables', 'shielddrill', 'drill', 'horses', 'padded'], hq: ['castle', 'knightly', 'plough', 'hardy', 'citadel', 'crusade', 'shafts', 'masonry', 'rotation', 'guild', 'picks'], forge: ['steel1', 'plate1', 'hoardings', 'firearrows', 'steel2', 'plate2', 'bodkin', 'steel3', 'plate3'], chapel: ['legend', 'sweeping', 'valour', 'chosen', 'hospital'] },
      techBuildings: ['forge', 'chapel'] },
    { id: 'steward', name: 'Steward', style: 'economic', blurb: 'Builds a big farm economy first, Free Yeomanry crossbows, then a large late army behind a Fortress Realm.',
      aggression: 0.4, greed: 0.9, tech: 0.5, defense: 0.6, attackRatio: 1.35, firstAttack: { round: 13, army: 8 },
      mix: { fighter: 1, ranged: 1.35, tank: 1.15, fast: 0.7 }, farms: 5, peasants: 10,
      research: { barracks: ['padded', 'whetstones', 'drill', 'shielddrill', 'stables', 'horses'], hq: ['plough', 'picks', 'hardy', 'castle', 'rotation', 'yeomanry', 'shafts', 'masonry', 'citadel', 'guild', 'fortress'], forge: ['plate1', 'firearrows', 'bodkin', 'steel1', 'hoardings', 'plate2', 'steel2', 'plate3', 'steel3'], chapel: ['valour', 'hospital', 'legend', 'sweeping', 'chosen'] },
      techBuildings: ['forge', 'chapel'] },
    { id: 'smithking', name: 'Smith-King', style: 'tech', blurb: 'Rushes the Blacksmith and the Citadel; heavy plate and steel, then one hard push.',
      aggression: 0.6, greed: 0.55, tech: 0.95, defense: 0.4, attackRatio: 1.2, firstAttack: { round: 10, army: 6 },
      mix: { fighter: 1.1, ranged: 1, tank: 1.3, fast: 0.9 }, farms: 3, peasants: 7,
      research: { barracks: ['whetstones', 'drill', 'padded', 'shielddrill', 'stables', 'horses'], hq: ['castle', 'plough', 'picks', 'citadel', 'knightly', 'crusade', 'masonry', 'shafts', 'rotation', 'guild', 'hardy'], forge: ['steel1', 'plate1', 'hoardings', 'firearrows', 'steel2', 'plate2', 'bodkin', 'steel3', 'plate3'], chapel: ['legend', 'sweeping', 'valour', 'chosen', 'hospital'] },
      techBuildings: ['forge', 'chapel'] },
  ],
  undead: [
    { id: 'bonetide', name: 'Bone Tide', style: 'aggressive', blurb: 'An endless skeleton swarm thrown at you early and often; Bone Tide and the Endless Swarm.',
      aggression: 0.9, greed: 0.35, tech: 0.4, defense: 0.15, attackRatio: 1.0, firstAttack: { round: 5, army: 5 },
      mix: { swarm: 1.4, fighter: 1.1, ranged: 0.8, tank: 0.8, fast: 1.1, mage: 0.8 }, wells: 2, monoliths: 1,
      research: { barracks: ['ossified', 'pact', 'vigil', 'boneshields', 'spectral', 'hollow', 'circle'], hq: ['dust', 'mausoleum', 'bonetide', 'conduits', 'restless', 'harvest', 'necropolis', 'horde', 'bonemason', 'blight', 'massgraves'], pit: ['bones1', 'swarm3', 'plating1', 'dread', 'bones2', 'plating2', 'bonespears', 'shroud', 'bones3', 'plating3'], sanctum: ['greater', 'chain', 'necromancy', 'shadowwalk', 'phylactery'] },
      techBuildings: ['pit', 'sanctum'] },
    { id: 'necrarch', name: 'Necrarch', style: 'tech', blurb: 'Necromancers and the Lich behind a skeleton screen; Dark Arts and an Endless Horde of summons.',
      aggression: 0.6, greed: 0.5, tech: 0.9, defense: 0.35, attackRatio: 1.2, firstAttack: { round: 9, army: 6 },
      mix: { swarm: 1.0, fighter: 0.9, ranged: 1.0, tank: 1.0, fast: 0.8, mage: 1.6 }, wells: 2, monoliths: 2,
      research: { barracks: ['circle', 'hollow', 'ossified', 'vigil', 'boneshields', 'pact', 'spectral'], hq: ['conduits', 'mausoleum', 'darkarts', 'dust', 'restless', 'harvest', 'necropolis', 'horde', 'bonemason', 'blight', 'massgraves'], pit: ['bones1', 'plating1', 'bonespears', 'bones2', 'swarm3', 'plating2', 'dread', 'shroud', 'bones3', 'plating3'], sanctum: ['necromancy', 'chain', 'greater', 'shadowwalk', 'phylactery'] },
      techBuildings: ['sanctum', 'pit'] },
    { id: 'blightlord', name: 'Blight Lord', style: 'defensive', blurb: 'Creeps its graves forward with Monoliths and fights on them; Plague of Graves for anyone who follows.',
      aggression: 0.45, greed: 0.75, tech: 0.6, defense: 0.7, attackRatio: 1.3, firstAttack: { round: 11, army: 8 },
      mix: { swarm: 1.1, fighter: 1.2, ranged: 1.2, tank: 1.2, fast: 0.7, mage: 1.0 }, wells: 3, monoliths: 4,
      research: { barracks: ['ossified', 'vigil', 'boneshields', 'hollow', 'circle', 'pact', 'spectral'], hq: ['conduits', 'restless', 'mausoleum', 'bonemason', 'blight', 'harvest', 'bonetide', 'dust', 'necropolis', 'plague', 'massgraves'], pit: ['plating1', 'bones1', 'dread', 'plating2', 'bonespears', 'bones2', 'swarm3', 'shroud', 'plating3', 'bones3'], sanctum: ['chain', 'greater', 'necromancy', 'shadowwalk', 'phylactery'] },
      techBuildings: ['pit', 'sanctum'] },
  ],
};
export const personalitiesOf = faction => PERSONALITIES[faction] || [];
export const personalityById = (faction, id) => personalitiesOf(faction).find(x => x.id === id) || null;
// a seeded pick (random each game, reproducible for a seed), or the one asked for
export function pickPersonality(faction, seed, p, want) {
  const list = personalitiesOf(faction);
  return personalityById(faction, want) || list[Math.abs((seed * 7919 + p * 104729 + 13) | 0) % list.length];
}

// Difficulty = skill, not resources (Brutal alone cheats: +30 % income, set by main.js).
//  delay   : rounds late the AI sees changes (reaction time)   memory : rounds it remembers unseen enemies
//  focus   : focus fire                                        kite   : ranged squads keep their distance
//  lead    : aims ahead of moving targets                      adapt  : 0..1, how much it counters what it saw
//  scout   : how keen on scouting                              edge   : added to the attack ratio it waits for
//  mistake : chance a squad order is a plain one (deliberate, seeded)
export const SKILL = {
  easy:   { delay: 1, memory: 2, focus: false, kite: false, lead: false, adapt: 0,   scout: 0.4, edge: 0.35, mistake: 0.3 },
  normal: { delay: 0, memory: 3, focus: true,  kite: false, lead: true,  adapt: 0.6, scout: 0.8, edge: 0.1,  mistake: 0.08 },
  hard:   { delay: 0, memory: 4, focus: true,  kite: true,  lead: true,  adapt: 1,   scout: 1,   edge: 0,    mistake: 0 },
  brutal: { delay: 0, memory: 4, focus: true,  kite: true,  lead: true,  adapt: 1,   scout: 1,   edge: 0,    mistake: 0 },
};
export const BRUTAL_INCOME = 1.3;
export const skillOfLevel = level => SKILL[level] || SKILL.normal;
