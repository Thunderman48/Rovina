// One coloured icon set for the whole game (24×24 paths), drawn as inline SVG in the UI
// and onto canvas for the 3D name plates and map markers. Colours match the effects (fx.js).
// Each icon: c = colour, d = main path, s = stroke-only (line icon), w = stroke width,
// x = detail path (drawn dark on top), xf = fill colour for the detail instead of a dark line.

const AMBER_C = '#ffb020', GOLD = '#f5c542', CYAN = '#3ee6ff', LIME = '#9be15d', ORANGE = '#ff4a1c', RED = '#ff2d55', BLUE = '#3fa9ff',
  WHITE = '#f6f6f4', GREY = '#a8a8a5', PURPLE = '#a86bff', AMBER = '#ffb020', GREEN = '#34c759', STEEL = '#7aa7c7',
  MAGENTA = '#ff4fd8', VIOLET = '#d9b8ff', HEART = '#ff5a3c', FRAG = '#ff6a00', INK = '#0b0b0b';

const SHIELD = 'M12 2 20 5v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5Z';
const EYE = 'M1 12C4 6 8 4 12 4s8 2 11 8c-3 6-7 8-11 8S4 18 1 12Z';
const PERSON = 'M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 22c0-5 3.5-8 8-8s8 3 8 8Z';
const HEX = 'M12 2 21 7v10l-9 5-9-5V7Z';
const FLAG = 'M6 3h12l-2.5 4L18 11H8v11H6Z';
const CHEV2 = 'M12 2l9 8h-5l-4-3.5L8 10H3ZM12 11l9 8h-5l-4-3.5L8 19H3Z';
const SLASHCIRCLE = 'M12 3a9 9 0 1 0 .01 0ZM5.6 5.6l12.8 12.8';

export const ICONSET = {
  // ---- skills (one per skill name: 'sk-' + slug) and passives ('pv-' + kind), since 2026-11-26 ----
  'sk-leap-strike': { c: GREEN, d: 'M3 20c2-11 11-15 15-6M15 11.5l3 3.2 3.4-3.8M9 21h12', s: true, w: 2.2 },
  'sk-rally': { c: BLUE, d: 'M6 22V3M6 4h12l-3 4 3 4H6M12 6v4M10 8h4', s: true, w: 2 },
  'sk-mighty-swing': { c: RED, d: 'M3 15a9 9 0 0 1 18 0M8 3h8v6H8ZM12 9v13', s: true, w: 2 },
  'sk-lock-shields': { c: BLUE, d: 'M8 3l5.5 2v5c0 4-2.3 6.8-5.5 8C4.8 16.8 2.5 14 2.5 10V5ZM15.5 7.5l6 2v4.5c0 4-2.5 6.5-6 8-1.5-.6-2.8-1.5-3.8-2.6', s: true, w: 2 },
  'sk-shield-bash': { c: RED, d: 'M9 3l6 2.2v5.5c0 4-2.6 7-6 8.3-3.4-1.3-6-4.3-6-8.3V5.2ZM18 5l3.5-2M19 10.5h3.5M18 16l3.5 2', s: true, w: 2 },
  'sk-parry': { c: STEEL, d: 'M4 20 18 6M15 3l6 6M20 20 6 6M3 9l6-6', s: true, w: 2.2 },
  'sk-charge': { c: GREEN, d: 'M2 12h13M10 6l6 6-6 6M17 5l5 7-5 7', s: true, w: 2.2 },
  'sk-trample': { c: RED, d: 'M12 3a9 9 0 1 0 .01 0ZM8 16v-5a4 4 0 0 1 8 0v5M8 16h2M14 16h2', s: true, w: 2 },
  'sk-wheel-away': { c: GREEN, d: 'M20 7H9a5 5 0 0 0 0 10h9M14 13l4 4-4 4', s: true, w: 2.2 },
  'sk-overwatch': { c: BLUE, d: 'M2 12c3-5 6.5-7 10-7s7 2 10 7c-3 5-6.5 7-10 7S5 17 2 12ZM12 9a3 3 0 1 1-.01 0Z', s: true, w: 2 },
  'sk-piercing-bolt': { c: RED, d: 'M2 12h18M16 8l4 4-4 4M7 7v10M11 7v10', s: true, w: 2.2 },
  'sk-summon-warband': { c: PURPLE, d: 'M8 10a4 4 0 1 1 8 0v3H8ZM10 13v2M14 13v2M3 21h18M6 21l2-4M18 21l-2-4', s: true, w: 2 },
  'sk-dark-thunder': { c: VIOLET, d: 'M13 2 5 13h6l-2 9 9-12h-6l3-8Z', s: true, w: 2 },
  'sk-corpse-explosion': { c: FRAG, d: 'M12 2v5M12 17v5M2 12h5M17 12h5M5 5l3.5 3.5M15.5 15.5 19 19M19 5l-3.5 3.5M8.5 15.5 5 19M12 9.5a2.5 2.5 0 1 1-.01 0Z', s: true, w: 2 },
  'sk-grave-wall': { c: BLUE, d: 'M3 21V11a4 4 0 0 1 8 0v10M13 21V9a4 4 0 0 1 8 0v12M2 21h20', s: true, w: 2 },
  'sk-bone-bash': { c: RED, d: 'M6.5 4.5a2 2 0 1 0-2 2l11 11a2 2 0 1 0 2-2ZM17 4l3-2M19 8h3', s: true, w: 2 },
  'sk-shadow-step': { c: VIOLET, d: 'M4 20c0-6 4-9 8-9M12 11c4 0 8-3 8-9M3 9h4M17 15h4M6 4l2 2M16 18l2 2', s: true, w: 2 },
  'sk-dread-wail': { c: VIOLET, d: 'M12 9.5a2.5 2.5 0 1 1-.01 0ZM7.5 7.5a6.5 6.5 0 0 0 0 9M16.5 7.5a6.5 6.5 0 0 1 0 9M4.5 4.5a11 11 0 0 0 0 15M19.5 4.5a11 11 0 0 1 0 15', s: true, w: 2 },
  'sk-raise': { c: LIME, d: 'M12 21V8M7 13l5-5 5 5M5 3h14', s: true, w: 2.2 },
  'sk-pounce': { c: ORANGE, d: 'M3 18c3-8 9-10 14-6M13.5 9l3.5 3-4 1.5M16 17l2 4M19.5 15l2 3M12.5 18l1 4', s: true, w: 2 },
  'sk-frenzy': { c: RED, d: 'M12 2c1 4 5 5 5 10a5 5 0 0 1-10 0c0-3 2-4 2-6 1 1 2 2 2 4 1-2 1-5 1-8Z', s: true, w: 2 },
  'sk-arrow-storm': { c: RED, d: 'M6 2l2 7M12 2v7M18 2l-2 7M5 7l3 2 2-3M11 7l1 2 1-2M14 6l2 3 3-2M3 21h18M7 21v-5M12 21v-6M17 21v-5', s: true, w: 1.8 },
  'pv-berserk': { c: RED, d: 'M12 3a9 9 0 1 0 .01 0ZM7.5 9.5l3 1.5M16.5 9.5l-3 1.5M8 16.5c2.5-2 5.5-2 8 0', s: true, w: 2 },
  'pv-inspire': { c: GOLD, d: 'M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9Z', s: true, w: 2 },
  'pv-bulwark': { c: STEEL, d: 'M12 3l7 2.5v5.5c0 4.5-3 7.8-7 9.5-4-1.7-7-5-7-9.5V5.5ZM1.5 2.5l3.5 3M22.5 2.5 19 5.5', s: true, w: 2 },
  'pv-disciplined': { c: ORANGE, d: 'M5 21 12 3M11 21l7-18M3 15h8M10 15h8', s: true, w: 2 },
  'pv-pierce': { c: RED, d: 'M2 12h14M13 8l4 4-4 4M18.5 4v16M21.5 6v12', s: true, w: 2 },
  'pv-ridedown': { c: CYAN, d: 'M6 21V11a6 6 0 0 1 12 0v10M3.5 21h5M15.5 21h5', s: true, w: 2.4 },
  'pv-militia': { c: AMBER, d: 'M12 22V9M7 3v4a5 5 0 0 0 10 0V3M12 3v6', s: true, w: 2 },
  'pv-drain': { c: VIOLET, d: 'M12 3c3 4 5 6.5 5 9a5 5 0 0 1-10 0c0-2.5 2-5 5-9ZM9 19l3 3 3-3', s: true, w: 2 },
  'pv-dread': { c: PURPLE, d: 'M12 3a8 8 0 0 0-8 8v10l3-2 2.5 2L12 19l2.5 2L17 19l3 2V11a8 8 0 0 0-8-8ZM9 10.5h.01M15 10.5h.01', s: true, w: 2 },
  'pv-gravebound': { c: STEEL, d: 'M6 21V9a6 6 0 0 1 12 0v12M3 21h18M12 8v7M9 11h6', s: true, w: 2 },
  'pv-reassemble': { c: LIME, d: 'M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3M18 3v4h-4M6 21v-4h4', s: true, w: 2 },
  'pv-rend': { c: RED, d: 'M6 3c2 6 2 12-1 18M12 3c2 6 2 12-1 18M18 3c2 6 2 12-1 18', s: true, w: 2.2 },
  'pv-longshot': { c: RED, d: 'M2 12h17M16 9l3 3-3 3M5 8v8M9 9v6M13 10v4', s: true, w: 2 },
  'pv-chill': { c: CYAN, d: 'M12 2v20M3.3 7l17.4 10M20.7 7 3.3 17M9 4l3 2 3-2M9 20l3-2 3 2', s: true, w: 1.9 },
  'pv-siphon': { c: VIOLET, d: 'M12 10.5a1.5 1.5 0 1 1-.01 0ZM12 4a8 8 0 1 1-8 8M12 7.5a4.5 4.5 0 1 1-4.5 4.5', s: true, w: 2 },

  // unit types
  hero: { c: GOLD, d: 'M3 18 4.5 7l5 5L12 4l2.5 8 5-5L21 18Z', x: 'M3 21h18' },
  tank: { c: STEEL, d: SHIELD, x: 'M12 5v14M7.5 10h9' },
  swarm: { c: ORANGE, d: 'M6 4a3 3 0 1 1-.01 0ZM18 4a3 3 0 1 1-.01 0ZM12 9a3 3 0 1 1-.01 0ZM3.5 11h5v8h-5ZM15.5 11h5v8h-5ZM9.5 15h5v7h-5Z' },
  fighter: { c: ORANGE, d: 'M18.5 2H22v3.5L10.5 17 7 13.5ZM4.5 12.5l7 7-1.6 1.6-2.2-2.2L5 21.6 2.4 19l2.7-2.7-2.2-2.2Z' },
  ranged: { c: RED, d: 'M6 2.5c8 2.5 11 10.5 8.5 19M6 2.5l8.5 19M2 12h18M17 8.5 20.5 12 17 15.5', s: true, w: 2.2 },
  fast: { c: CYAN, d: 'M6 21V11a6 6 0 0 1 12 0v10', s: true, w: 3.4 },
  // tech tree: three linked nodes; revive: a rising arrow over a grave mound
  tech: { c: GOLD, d: 'M5 3.5a2.5 2.5 0 1 1-.01 0ZM5 15.5a2.5 2.5 0 1 1-.01 0ZM19 9.5a2.5 2.5 0 1 1-.01 0ZM6.5 7.2l10 3.3-1 1.6-9-3ZM6.5 16.8l9-4.1 1 1.6-10 3.8Z' },
  revive: { c: GOLD, d: 'M12 2l6 7h-4v6h-4V9H6ZM3 19a9 4 0 0 1 18 0v2H3Z' },
  mage: { c: '#b57bff', d: 'M12 1.5a3.5 3.5 0 1 1-.01 0ZM11 8h2v14h-2ZM7 10l4 2v2l-4-2ZM17 10l-4 2v2l4-2Z' },
  // resources & state
  supply: { c: GOLD, d: HEX, x: 'M12 7 16.5 9.5v5L12 17l-4.5-2.5v-5Z' },
  income: { c: GOLD, d: HEX, x: 'M12 7.5v9M7.5 12h9' },
  gold: { c: GOLD, d: 'M12 2a10 10 0 1 0 .01 0Z', x: 'M12 6.5a5.5 5.5 0 1 0 .01 0Z' },
  souls: { c: '#7dff9a', d: 'M12 2c1 4 6 6 6 12a6 6 0 0 1-12 0c0-3 2-5 3-6 0 2 1 3 2 3 0-4 0-6 1-9Z' },
  builder: { c: AMBER_C, d: 'M3 19.5l9-9 2.5 2.5-9 9ZM11 5l4-3 7 7-3 3-2-2-2 2-4-4 2-2Z' },
  farm: { c: LIME, d: 'M12 22V9M12 13c-4 0-6-3-6-6 4 0 6 3 6 6Zm0 0c4 0 6-3 6-6-4 0-6 3-6 6Zm0 5c-4 0-6-3-6-6 4 0 6 3 6 6Zm0 0c4 0 6-3 6-6-4 0-6 3-6 6Z' },
  cp: { c: CYAN, d: 'M3 18 4.5 7l5 5L12 4l2.5 8 5-5L21 18Z', x: 'M3 21h18' },
  ap: { c: LIME, d: 'M13 2 4 14h7l-2 8 10-13h-7l2-7Z' },
  hp: { c: HEART, d: 'M12 21 3.5 12.5A5 5 0 0 1 12 6a5 5 0 0 1 8.5 6.5Z' },
  tier: { c: LIME, d: CHEV2 },
  speed: { c: LIME, d: 'M3 12h9M5 7h8M5 17h8', s: true, w: 2.4, x: 'M14 5l7 7-7 7Z', xf: LIME },
  round: { c: WHITE, d: 'M6 2h12v4l-4.5 6L18 18v4H6v-4l4.5-6L6 6Z' },
  timer: { c: WHITE, d: 'M12 2a10 10 0 1 0 .01 0Z', x: 'M12 6v6l4 3' },
  goal: { c: ORANGE, d: FLAG },
  vision: { c: WHITE, d: EYE, x: 'M12 8.5a3.5 3.5 0 1 0 .01 0Z', xf: INK },
  range: { c: RED, d: 'M12 3a9 9 0 1 0 .01 0ZM12 8a4 4 0 1 0 .01 0Z', s: true, w: 2.2, x: 'M12 10.5a1.5 1.5 0 1 0 .01 0Z', xf: RED },
  cooldown: { c: GREY, d: 'M20 12a8 8 0 1 1-3-6.2M20 3v5h-5', s: true, w: 2.4 },
  army: { c: WHITE, d: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM2 21c0-4 3-7 7-7s7 3 7 7ZM16.5 11a3 3 0 1 0 0-6ZM17 14c3 .5 5 3 5 7h-4Z' },
  node: { c: GOLD, d: 'M12 2 19 9 12 22 5 9Z', x: 'M5 9h14M12 2v20' },
  // actions
  move: { c: WHITE, d: 'M3 10h11V5l8 7-8 7v-5H3Z' },
  attack: { c: ORANGE, d: 'M20.5 2 22 3.5 11 14.5 9.5 13ZM5 12.5l6.5 6.5-1.5 1.5-2-2L4.5 22 2 19.5 5.5 16l-2-2Z' },
  shoot: { c: ORANGE, d: 'M12 2v6M12 16v6M2 12h6M16 12h6M12 5a7 7 0 1 0 .01 0Z', s: true, w: 2.4 },
  wait: { c: GREY, d: 'M6 4h4v16H6ZM14 4h4v16h-4Z' },
  defend: { c: BLUE, d: SHIELD },
  tierup: { c: LIME, d: CHEV2 },
  parry: { c: GOLD, d: 'M4 4l16 16M20 4 4 20', s: true, w: 3.2, x: 'M3 8V3h5M21 8V3h-5' },
  engaged: { c: RED, d: 'M4 4l16 16M20 4 4 20', s: true, w: 3.2, x: 'M3 8V3h5M21 8V3h-5' },
  overwatch: { c: RED, d: EYE, x: 'M12 8.5a3.5 3.5 0 1 0 .01 0Z', xf: INK },
  heal: { c: GREEN, d: 'M9 3h6v6h6v6h-6v6H9v-6H3V9h6Z' },
  undo: { c: GREY, d: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3', s: true, w: 2.4 },
  release: { c: GREY, d: 'M12 3a9 9 0 1 0 .01 0ZM8 8l8 8M16 8l-8 8', s: true, w: 2.2 },
  stance: { c: WHITE, d: FLAG },
  control: { c: CYAN, d: 'M9 11V4.5a1.5 1.5 0 0 1 3 0V10h.5V3.5a1.5 1.5 0 0 1 3 0V10h.5V5a1.5 1.5 0 0 1 3 0v9c0 4-3 8-7 8-3 0-5-1.5-6.5-4l-3-5a1.5 1.5 0 0 1 2.5-1.5L9 14Z' },
  // skills
  dash: { c: CYAN, d: 'M2 8h7M2 12h9M2 16h7', s: true, w: 2.4, x: 'M12 4l10 8-10 8Z', xf: CYAN },
  shove: { c: AMBER, d: 'M2 9h10V5l8 7-8 7v-4H2Z' },
  frag: { c: FRAG, d: 'M12 7a7.5 7.5 0 1 0 .01 0Z', x: 'M10 3h4v4h-4ZM14 4.5l4-2.5' },
  fortify: { c: STEEL, d: SHIELD, x: 'M12 7.5v9M7.5 12h9' },
  disrupt: { c: VIOLET, d: 'M2 13l4-6 4 9 4-9 4 9 4-6', s: true, w: 2.6 },
  sweep: { c: MAGENTA, d: 'M12 3a9 9 0 1 1-8.5 6', s: true, w: 3, x: 'M1 3v7h7Z', xf: MAGENTA },
  rally: { c: LIME, d: CHEV2 },
  slow: { c: PURPLE, d: 'M12 3a9 9 0 1 0 .01 0Z', s: true, w: 2.4, x: 'M8 12h8', },
  zone: { c: PURPLE, d: 'M12 3a9 9 0 1 0 .01 0Z', s: true, w: 2.4 },
  // stances
  guard: { c: WHITE, d: SHIELD, x: 'M12 6v10M9 13h6' },
  hold: { c: WHITE, d: 'M2 10h20v10H2Z', x: 'M7 10v10M12 10v10M17 10v10M2 15h20' },
  holdground: { c: WHITE, d: 'M12 2a6 6 0 0 1 6 6c0 5-6 13-6 13S6 13 6 8a6 6 0 0 1 6-6Z', x: 'M12 6a2 2 0 1 0 .01 0Z', xf: INK },
  advance: { c: WHITE, d: 'M3 10h11V5l8 7-8 7v-5H3Z' },
  retreat: { c: WHITE, d: 'M21 10H10V5l-8 7 8 7v-5h11Z' },
  // buildings / economy
  build: { c: AMBER, d: 'M3 19.5l9-9 2.5 2.5-9 9ZM11 5l4-3 7 7-3 3-2-2-2 2-4-4 2-2Z' },
  queue: { c: WHITE, d: 'M3 5h18v3H3ZM3 11h12v3H3ZM3 17h7v3H3Z' },
  // events
  kill: { c: WHITE, d: 'M12 2c5 0 9 3.5 9 8 0 3-1.5 4.5-3 5.5V20h-3v-2h-2v2h-2v-2H9v2H6v-4.5C4.5 14.5 3 13 3 10c0-4.5 4-8 9-8Z', x: 'M8.5 8.5a2 2 0 1 0 .01 0ZM15.5 8.5a2 2 0 1 0 .01 0Z', xf: INK },
  miss: { c: GREY, d: SLASHCIRCLE, s: true, w: 2.4 },
  cancel: { c: GREY, d: SLASHCIRCLE, s: true, w: 2.4 },
  spawn: { c: WHITE, d: PERSON },
  lost: { c: WHITE, d: PERSON, x: 'M14 14l8 8M22 14l-8 8' },
  blocked: { c: BLUE, d: SHIELD },
};

export const ICON_COLORS = Object.fromEntries(Object.entries(ICONSET).map(([k, v]) => [k, v.c]));

// Inline SVG string
export function icon(name, size = 16, cls = '') {
  const ic = ICONSET[name];
  if (!ic) return '';
  let body;
  if (ic.s) {
    body = `<path d="${ic.d}" fill="none" stroke="${INK}" stroke-width="${(ic.w || 2) + 2.6}" stroke-linecap="round" stroke-linejoin="round"/>`
      + `<path d="${ic.d}" fill="none" stroke="${ic.c}" stroke-width="${ic.w || 2}" stroke-linecap="round" stroke-linejoin="round"/>`;
  } else {
    body = `<path d="${ic.d}" fill="${ic.c}" stroke="${INK}" stroke-width="1.5" stroke-linejoin="round" paint-order="stroke"/>`;
  }
  if (ic.x) {
    body += ic.xf
      ? `<path d="${ic.x}" fill="${ic.xf}" stroke="${INK}" stroke-width="1.2" paint-order="stroke" stroke-linecap="round" stroke-linejoin="round"/>`
      : `<path d="${ic.x}" fill="none" stroke="${INK}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  return `<svg class="ic ic-${name} ${cls}" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">${body}</svg>`;
}

// Draw onto a 2D canvas context at (x, y) with the given size
const pathCache = new Map();
const P = d => { if (!pathCache.has(d)) pathCache.set(d, new Path2D(d)); return pathCache.get(d); };
export function drawIconCanvas(g, name, x, y, size) {
  const ic = ICONSET[name];
  if (!ic || typeof Path2D === 'undefined') return;
  g.save();
  g.translate(x, y);
  g.scale(size / 24, size / 24);
  g.lineCap = 'round'; g.lineJoin = 'round';
  if (ic.s) {
    g.strokeStyle = INK; g.lineWidth = (ic.w || 2) + 2.6; g.stroke(P(ic.d));
    g.strokeStyle = ic.c; g.lineWidth = ic.w || 2; g.stroke(P(ic.d));
  } else {
    g.strokeStyle = INK; g.lineWidth = 3; g.stroke(P(ic.d));
    g.fillStyle = ic.c; g.fill(P(ic.d));
  }
  if (ic.x) {
    if (ic.xf) { g.strokeStyle = INK; g.lineWidth = 2.4; g.stroke(P(ic.x)); g.fillStyle = ic.xf; g.fill(P(ic.x)); }
    else { g.strokeStyle = INK; g.lineWidth = 1.8; g.stroke(P(ic.x)); }
  }
  g.restore();
}

// Replace <i data-ic="name"></i> placeholders inside a DOM subtree
export function hydrateIcons(root, size = 14) {
  root.querySelectorAll('i[data-ic]').forEach(el => { el.outerHTML = icon(el.dataset.ic, +(el.dataset.size || size)); });
}

// Legend for Help
export const ICON_LEGEND = [
  ['Resources', [['supply', 'Supply (money)'], ['income', 'Income per round'], ['cp', 'Command points'], ['ap', 'Action points'], ['army', 'Army size / cap'], ['node', 'Resource node'], ['round', 'Round'], ['timer', 'Planning timer'], ['goal', 'Goal']]],
  ['Unit stats', [['hp', 'Health'], ['tier', 'Tier (turn order)'], ['speed', 'Move speed'], ['defend', 'Defends'], ['vision', 'Vision'], ['range', 'Shot / turret range'], ['cooldown', 'Cooldown']]],
  ['Actions', [['move', 'Move'], ['attack', 'Attack'], ['shoot', 'Shoot'], ['wait', 'Wait'], ['tierup', 'Act earlier'], ['parry', 'Parry'], ['overwatch', 'Overwatch'], ['heal', 'Heal'], ['control', 'Control'], ['release', 'Release'], ['undo', 'Undo'], ['build', 'Build']]],
  ['Skills', [['dash', 'Dash'], ['shove', 'Shove'], ['frag', 'Frag'], ['fortify', 'Fortify'], ['disrupt', 'Disrupt'], ['sweep', 'Sweep'], ['rally', 'Rally']]],
  ['Stances', [['guard', 'Guard'], ['hold', 'Hold'], ['holdground', 'Hold ground'], ['advance', 'Advance'], ['retreat', 'Retreat']]],
  ['Events', [['kill', 'Killed'], ['blocked', 'Hit blocked'], ['slow', 'Slowed'], ['miss', 'Missed / cancelled'], ['spawn', 'Unit ready'], ['queue', 'Production queue']]],
];

// the icon of a skill (by its name) or a passive (by its kind); falls back to a generic icon
const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
export const skillIcon = sk => (sk && ICONSET['sk-' + slug(sk.name)] ? 'sk-' + slug(sk.name) : 'attack');
export const passiveIcon = pv => (pv && ICONSET['pv-' + pv.kind] ? 'pv-' + pv.kind : 'hero');
