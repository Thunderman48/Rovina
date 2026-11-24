# Rovina: complete game and balance reference

This document describes **every rule, number and behaviour** of the game (Rovina, at the site root) so the
game can be understood and balanced from this file alone. Tables marked *generated* are produced from
the game's data files by `npm run doc` (`node tools/gendoc.mjs`) and are always exact; the prose
around them describes the code in `js/sim/` (rules), `js/ai/` (the AI) and `js/data/` (numbers).

- Units: distances are **inches (″)** on the table; time is **AP** (action points). 1 round = 100 AP.
- Coordinates: x runs left → right (player 0 starts on the left, x small), z runs top → bottom.
- Player 0 = left side (host online / you vs AI); player 1 = right side. Maps are point-symmetric:
  a point (x, z) mirrors to (W − x, H − z).
- Everything in the sim is **deterministic**: same state + same orders = same result, on every machine.

Contents: 1 Overview · 2 Round structure · 3 Orders and limits · 4 Stances · 5 Combat ·
6 Movement and collisions · 7 Units (generated) · 8 Skills (generated) · 9 Derived combat numbers
(generated) · 10 Economy (generated + rules) · 11 Buildings and builders · 12 Fog of war and intel ·
13 Maps (generated) · 14 AI · 15 Online · 16 Balance status · 17 Tuning guide · 18 Change log ·
19 Keeping this document up to date · 20 Design references

---

## 1. Overview and win conditions

Two armies (**Kingdom** vs **Undead Legion**; mirror matches allowed) fight on a table. Both players
give orders at the same time, then the round resolves. Squads act in **speed tiers** (fast first); in a
tier everything happens at once on a shared timeline where an action's AP cost is how long it takes.
**Area attacks** (volleys, lobs, most skills) are **non-targeted skillshots**: they hit whatever is in
their shape when they land. The melee **Strike** is a **target attack** at one enemy, with a short lunge
if the target steps out of reach (§5.2).

**Win / loss (checked at the end of every round):** a side **loses only when its HQ** (Keep / Crypt)
**is destroyed** (since 2026-11-17; before that, a side with no squads and no finished barracks also
lost). A side with nothing left but its HQ keeps playing: its HQ still earns and trains. (Test arenas
with no HQ on the table use "no squads left".)

If both sides lose in the same round it is a **draw**. **There is no round limit.**

Each side starts with: an HQ (at one of the map's 3 seeded HQ spots on its back edge), its army deployed
in front of it, and its faction's starting resource. **Small starting armies** (since 2026-11-16; the
rest comes from the base): **Kingdom:** The Chosen, **Men-at-arms** and **1 peasant (builder) squad**.
**Undead:** the Lich and **a Skeleton Warband pair** (2 swarm squads). The Keep trains peasants
and Men-at-arms; the Crypt trains the swarm.

**The two factions play differently** (since 2026-11-15):
- **Kingdom (all-rounder, beginner friendly):** plain squads with decent stats; peasants build every
  building and farm big farms for gold, so the economy grows strong late. Hero **The Chosen**: Leap
  Strike, Rally (+armour), Mighty Swing (stun).
- **Undead Legion (a never-ending horde, snowbally and slow to expand):** every squad is weaker but
  about half the price, and the **Skeleton Warband** swarm comes two squads at a time; **no builders**:
  buildings **rise out of the ground** on their own and spread **graveyards** around them; souls come
  from **deaths on grave ground** (which spreads it where they died; cheap squads pay back more than they cost), plus a
  tiny trickle from the Crypt (1) and Soul Wells (2). Hero **the Lich**, a slow **mage** with **mana**:
  Summon Warband (temporary skeletons), Dark Thunder (chain lightning), Corpse Explosion; its weaker
  caster troop, **Necromancers**, comes from the Crypt (from Tier 2). The **Monolith** (built on graves like every
  Undead building) spreads graves and heals instead of giving command points.
- **Both:** a fallen hero leaves a **revive zone**; hold it for 3 rounds to bring the hero back (§5.7b).
- **Tech tree** (§11.7, since 2026-11-24): HQ tiers (Tier 2 unlocks the elite squads and the tech
  buildings), research at the HQ and two tech buildings per faction, and one exclusive doctrine pick per
  tier. Kingdom research leans on economy, steel and its hero; Undead research on graves, bones and
  casters (the Warband in threes is Tier 3 research).

---

## 2. Round structure and timing (`js/sim/resolve.js` → `resolveRound`)

A round, in order:

1. **Planning** (players / AI build orders; not part of the sim).
2. **Intel update** (each side remembers enemy buildings it sees, §12).
3. **Order validation** (`js/sim/orders.js` → `validateOrders`, §3). Stance changes apply.
4. **Production queues at round start** (§10.3, `applyQueue` then `startQueues` in `js/sim/base.js`):
   this round's queue edits are applied for side 0 then side 1 (cancelled training is refunded); then for
   side 0, then side 1: the **build queue** starts what it can in order (each started item is paid and
   its **site is placed immediately**: blocks movement, can be attacked), then each training building
   (in building id order) starts its next squad if it is idle (paid now).
5. **Stance plans** are built for every squad without direct orders, from the positions at the start
   of the round and only from enemies its side **can see** at that moment (§4, §12).
6. **Prepared states at round start:** defends, parry, overwatch (and its cone direction), and
   **Lock Shields / Grave Wall** if the squad's plan contains it (braced for the whole round).
7. **Tiers, fastest to slowest:** tier = unit tier + act-earlier upgrades (max +2), so tiers run
   **8, 7, 6, 5, 4, 3, 2, 1** (only those with squads). Each tier is a segment:
   - All squads of the tier run their action lists **simultaneously**, 1 AP per step.
   - Each AP step: every acting squad does one AP of its current action → all walking squads move
     one AP (collisions, §6) → stopped friendly squads that overlap drift apart → overwatch checks
     (any tier, §5.9) → **all hits produced in this AP are applied together** (§5.1) → deaths checked
     (a squad killed this AP still delivered its own attacks this AP).
   - The segment ends when every squad of the tier has finished its actions; then up to 24 extra AP
     of "settling" separate friendly squads that overlap.
8. **Buildings act last** (segment "tier 0"): every finished **Watchtower / Bone Spire** and **HQ**
   fires one shot at the **nearest visible enemy squad** within range (§11.6).
9. **End of round:** fallen heroes leave a **revive zone** → destroyed undead buildings leave their
   **graveyard** as a patch → destroyed squads and buildings are removed → building HP rounded →
   **training** counters tick and finished squads spawn next to their building (a swarm pair: 2) →
   **summoned squads** lose 1 round of life (crumble at 0) → **undead sites rise** (+80 work) and
   finished undead buildings mend 5 % → **finished Monoliths heal** nearby own squads (§11.3c) →
   **mages regain mana**; carried-over stun still left is dropped →
   **resource sites** change owner (whoever has a *finished* Mine / Soul Well on it) → **souls** are paid
   for this round's deaths **on grave ground** (and new grave areas spread at the nearest edge where they
   died) → every undead building's graveyard fills to its reach → **revive zones** gain progress (and heroes return) → **income** is paid →
   intel update → **skill cooldowns tick** → win check → round number + 1.

**AP is time:** an action costing 25 AP takes 25 AP of the tier's timeline. A squad has exactly
`RULES.ap` = 100 AP per round. Unspent AP is lost (stance plans and the AI turn leftovers into defends).

**Speed:** a squad walks `tier × RULES.moveFactor` = tier × 0.012″ per AP on open ground
(tier 4 = 4.8″, tier 5 = 6.0″, tier 6 = 7.2″ per 100 AP). **Act-earlier upgrades change when a squad
acts, not how fast it walks** (speed uses the unit's base tier). Terrain multiplies speed: **forest ×0.75** (`RULES.forestSlow`),
**ruin ×0.75** (`RULES.ruinSlow`, within 0.4″ of the ruin), **stream (not at a ford) ×0.5**. Rocks,
buildings and lakes block movement; **ruins are walk-in cover** (§5.10).
- **Pathfinding** (`Nav`, `js/sim/nav.js`): a 0.5″ grid with the same clearance as movement (squad radius ×
  0.85), so every spot a squad can stand on is a node. With no way to the goal it walks to the reachable
  spot closest to it (it no longer walks straight into a wall).

---

## 3. Orders and limits (`js/sim/orders.js`)

### 3.1 Action costs (AP)
| Order | AP | Notes |
|---|---|---|
| Move | as long as the walk takes (the planner computes it from the path and terrain) | sanitising caps the total at 100 |
| Wait | chosen | |
| Basic attack (strike / volley / lob) | the unit's `attack.ap` | may be repeated while AP lasts; a strike names its target (`t`) |
| Skill | the skill's `ap` | each skill **at most once per round**, only when its cooldown is 0 |
| Builder work (`work`) | chosen (normally all AP left) | builders only (§11) |
| Defend | 20 each, max 4 bought per round | prepaid; each defend halves one hit |
| Act earlier | 15 for the 1st upgrade, +25 for the 2nd (total 40) | prepaid; max 2 upgrades |
| Parry | 15 | prepaid; **fighters only** (`parry: true` units) |
| Overwatch | 40 | prepaid; **shooters only** (volley / lob attack) |

Prepaid costs come first; then actions are added in order until 100 AP; a move / wait / work that
does not fit is trimmed to the AP left, any other action that does not fit is dropped (and so is
everything after it).

### 3.2 Command points (CP)
- Each round a side may give **direct orders to `RULES.cp` = 3 squads**, plus **+1 per finished
  Kingdom Banner** (max +2; the Undead have no CP building since 2026-11-17), **+1 with the Kingdom's
  Citadel** (Tier 3, §11.7). **Heroes and builders
  are free** (no CP).
- Squads without direct orders follow their **stance** (§4). Stance changes are free and unlimited.
- The AI has the same command points as a player at every difficulty (§14.7, §14.10).

### 3.3 Production queue orders (validated in `js/sim/base.js` → `validateQueue`)
Base orders edit the persistent production queues (§10.3); nothing is paid when queueing.
- `orders.queue = { builds?, trains?: { bid: [roles] }, cancel?: [bid] }`: `builds` (the side's whole
  build queue, items `{ qid, type, x, z, rot }`) and `trains[bid]` (one building's whole queue) **replace**
  the current lists when present; lists not sent are kept. `cancel` stops the squad currently in
  training at those buildings (full refund). `repeat: { bid: role | null }` **locks** a training
  building onto one role (or unlocks it, `null`); the role must be one it trains (§10.3). The legacy `orders.builds` / `orders.trains` arrays are
  **appended** to the current queues (the AI and tests use this form).
- **Build queue:** at most `RULES.queueMaxBuild` = 5 items; needs at least one builder (alive or in
  training); type in the faction's list; a **new or moved** item must pass placement (§11.2) against the
  buildings and the earlier queue items, **ignoring squads** (they move). Items left where they were keep
  their `qid` and are re-checked when they start. Farm / Banner limits count queued items.
- **Training queue:** per finished training building, at most `RULES.queueMax` = 5 roles waiting (the
  squad in training is not counted); roles must be ones it trains (HQ: builder; Barracks / Ossuary:
  tank, fighter, ranged, fast) and the faction can train. Cost, army cap and the builder cap are
  **not** checked when queueing, only when an item starts.

---

## 4. Stances (`js/sim/stances.js` → `buildStancePlan`)

A squad without direct orders gets a plan from its stance at the start of the round, using only enemies
its side sees right now (positions at round start). Leftover AP becomes defends (up to 4).

Squads start on **Advance** (builders on Guard; summoned skeletons on Advance). Stance changes are
free; `orders.stances[id]` is one of `guard`, `hold`, `advance`, `retreat`.

**Taking cover (§5.10):** on Guard (and Advance once at its goal), a squad with nothing to fight within
reach steps into the best free cover within 3″; shooters prefer firing spots in cover. Hold never moves.

- **Advance** (the default):
  1. **Targets, all equal:** every enemy squad the side sees **and every enemy building it knows of**
     (intel, §12; the HQ included) is a target, with no preference by kind. If the **nearest** one's
     edge is within **`RULES.advanceEngage` = 10″**, the squad attacks it: melee walks to striking
     distance and strikes it (a fighter in contact with a squad prepares a parry first); shooters walk until
     within 0.8 × range (+ the target's radius) and shoot with what is left, or shoot at once if already
     within range − 0.3″. Building targets use their hit radius.
  2. Otherwise, with a **target point** (`q.goal`, set by the player): walk toward it (all AP); once
     within **`RULES.goalReach` = 1.5″** it acts like Guard there.
  3. Otherwise (no target point): march on the enemy HQ if known, else on the nearest possible HQ spot
     the side can't see right now (§13), else into the enemy half (stopping 3.2″ short); if there is no
     path, Guard.
  - **Target points:** `orders.goals[id] = { x, z }` (clamped to the board) sets it and puts the squad
    on Advance; `null` clears it. It stays on the squad across rounds until changed or cleared.
- **Guard:**
  - Shooters: if an enemy is within attack range → shoot at it until AP runs out; otherwise set
    **overwatch** facing the nearest visible enemy (40 AP) and defend with the rest.
  - Melee: if a visible enemy is within **8″** (`GUARD_RANGE`) → walk to striking distance and strike
    it (a target attack at that enemy); prepare a **parry** first if it is a fighter and
    already in contact (gap ≤ 0.35″).
- **Hold:** stand still; all AP into defends (max 4).
- **Auto skills** (per squad, **on by default**; `q.auto`, set with `orders.auto[id] = true|false`, the
  "Auto skills" chip in the squad panel): stance squads (not on **Hold**) use their skills with the
  AI's rules (`autoSkills` in `js/sim/skills.js`, the same function the AI uses, §14.7) against the
  target the stance picked (Advance: its target; Guard: the enemy it fights or shoots) before their basic
  attacks: shield walls, rally, Leap Strike, Mighty Swing, the Necromancer's spells, Arrow Storm,
  Piercing Bolt, charges.
- **Retreat:** fall back to the **nearest own Mine / Soul Well** (any state), else the own HQ: walk
  there with all AP (stopping beside it); once its edge is within **`RULES.retreatReach` = 3″** of
  that building it acts like Guard. (Stepping away from an engaged enemy still costs the disengage AP
  and gives the parting blow, §5.8.)
- **Builders** (whatever their stance except Hold): keep at their remembered build / repair task;
  else take an own unfinished site at any distance (fewest builders on it first, then nearest;
  gatherers leave for it); else **gather** (remembered gather building, else the nearest own gather
  building with a free slot) (§11.4). Hold = stand still.

Melee approach (`meleePlan`): the squad stops at centre distance = own radius + target radius +
0.55 × reach; if it cannot also strike this round it walks with all its AP. Every strike names the
target (`t`), so it lunges if the target steps away (§5.2).

---

## 5. Combat (`js/sim/resolve.js`)

### 5.1 Damage formula and hit order
For a hit with raw damage `D` on a squad with armour `A`:

```
damage = max(1, round( D × cover × wall × 20 / (20 + A) × (defended ? 0.5 : 1) ))
  cover  = the target's cover where it stands when the hit lands (§5.10): heavy ×0.5 ranged / ×0.75 melee,
           light ×0.75 ranged, else 1
  wall   = 0.3 if the target braced Lock Shields / Grave Wall and the attacker is in its front 120°, else 1
  defended: the target spends one of its defends (if it has any left) on this hit
```
(`RULES.armorK` = 20, `RULES.defendMult` = 0.5; cover in `RULES.heavyCoverRanged` / `heavyCoverMelee` /
`lightCoverRanged`.)

- **Raw damage of an attack = damage per model × models alive at release × damage multiplier**
  (multiplier 1, or 1.25 after a Rally).
- **Models:** a squad's models = `ceil(hp / hpPer)`. Damage removes models from the back; a wounded
  squad hits for less.
- **Buildings:** `damage = max(1, round(D × 2.5 × 20 / (20 + building armour)))` (siege ×2.5);
  no defends, no cover, no parry. **Buildings are hit by their real footprint** (rectangle or circle,
  `edgeDist`): reach, lines (`segRect`), circles and arcs all measure to the footprint edge, so a squad
  must touch a wall's or Barracks' actual side to strike it.
- **Hits in the same AP are applied together.** Hits are grouped by target; each target takes its hits
  **strongest first**, so the strongest hit is the one that uses up a defend or a parry.
- **Defends** per round = the unit's base `defends` + bought defends (+1 from Rally). Each hit
  (any source, including tower fire) uses one while any remain.

### 5.2 Strike (melee): a target attack
Attacks come in two kinds:
- **Area attacks** (volleys, lobs and most skills: Mighty Swing, Sweep, Charge, spells) are aimed shapes that hit what is inside them when they land.
- **Target attacks** name one enemy. The **Strike** is the basic attack of every melee squad (`STRIKE(ap, dmg, reach)` in `js/data/units.js`). Order: `{ kind: 'strike', t: target id, x, z }`, where `x, z` is the aim point (a fallback).

1. **Start (first AP):** the target is:
   - **the named squad or building**, if it is alive and an enemy (a squad must have been **visible to the side at round start**, so an order can't follow a hidden squad);
   - **else** the enemy squad or building whose edge is closest to the aim point, within 2″ of it.

   The squad turns to face it; the playback marks the target during the wind-up.
2. **Release (after `attack.ap` AP):**
   - **Target dead:** the nearest enemy already within reach takes the blow instead; none → a miss.
   - **In reach** (edge-to-edge gap ≤ `reach`): hit it.
   - **Out of reach and not engaged with any enemy:** the squad **lunges** straight at it.
     - **Distance:** up to `speed × RULES.strikeLunge` (30 AP) × the terrain factor where it stands. That is tier 3: 1.08″, tier 4: 1.44″, tier 5: 1.8″, tier 6: 2.16″.
     - **Stops** 0.9 × reach from the target, and earlier at terrain, buildings, the board edge or a friend.
     - **Costs:** the lunge costs no AP and gives no parting blows.
     - **Then** it hits if the target is now in reach, else it misses.
   - **Out of reach but engaged with another enemy:** no lunge (it is locked in melee); a miss.
3. **The hit:** only the target, raw damage = damage per model × models × multiplier × **`RULES.strikeMult` = 1.15**.
   - **Buildings** take it with the siege rule (§5.1).
   - Defends, Lock Shields, cover and **parry** apply as to any melee hit.
   - A miss still uses the strike's AP.

Older orders with the area `swing` (the legacy AI, older clients) are turned into strikes at their aim
point (`sanitizePlan`).

### 5.3 Volley (crossbows, bone archers)
At release: a straight line from the squad toward the aim, length = `range`, width = `width`. It hits
the **first enemy** target (squad or building) the line meets, unless a **rock** cuts the line first
(lakes and ruins do not). **The shooter's own buildings never stop or weaken its shots** (the line passes
them); an **enemy** building on the line takes the shot. **Cover** (§5.10) applies to the target.

### 5.4 Circles: lob, Bone Blast, Arrow Storm
Aimed at a point, clamped to the skill's `range`. At release, every enemy squad / building whose
centre is within `radius + 0.6 × target radius` of the point is hit. Ignores walls (arcs over).

### 5.5 Piercing Bolt
A line like a volley (`range`, `width`) that hits **every** enemy target along it until a rock cuts it.
Cover applies per target.

### 5.6 Charge (Outriders, Wraiths)
Wind-up `wind` = 8 AP (lance lowered, lane telegraphed), then the squad **rushes** along the lane at
**4.6 × its walking speed** (× terrain), up to `len` inches. The first enemy squad (or building) it
meets takes `dmg` per model × models; the charger stops in contact (engaged). Walls / rocks /
the board edge stop the rush. Friendly squads are passed through (and stepped aside from at the end).
The action always costs its full AP.

### 5.7 Hero skills and specials
**The Chosen (Kingdom hero; cooldown skills):**
- **Leap Strike** (`leap`, 20 AP, cd 2): flies for 6 AP to the aim (clamped to range 7″), over
  everything; lands on the nearest free spot back along the line. On landing, every enemy squad /
  building within hero radius + **1.6″** (+ its radius) is hit for **12** (× models 1 × the hero's damage
  multiplier, kind `leap`, batched with the AP's other hits), and every adjacent enemy (edge gap < 0.3″)
  is **shoved 1″** away (if the spot is free).
- **Rally** (`rally`, 20 AP, cd 2): at release, every friendly squad within 5″ (+ its radius) gets
  **+1 defend** and **+4 armour** for the rest of the round (the armour is added in `hitOne` before
  `damageAfter`; several rallies don't stack, the highest applies). No damage bonus (`dmgMult` 1).
- **Mighty Swing** (`mighty`, 30 AP, cd 2): a swing arc with reach **2.6″** past the hero's edge and a
  wide half-angle (cos ≥ **0.2**, ±78°), **28** damage, and every squad it hits is **stunned for 25 AP**
  (see Stun below; a parried hit doesn't stun).

**The Lich (Undead hero; a mage, see Mana below; was called the Necromancer):** tier **3** (slow,
3.6″ per round), 90 HP, armour 5, 1 defend. Basic attack: a **magic bolt** (a volley line: 25 AP, 10 damage, range 10″,
width 0.6″; rocks block it, cover applies).
- **Summon Warband** (`summon`, 20 AP, **40 mana**): aim within 4″. **When the cast releases**, **2
  summoned Skeleton Warband squads** rise around the aim point (exactly the Skeleton Warband: same
  models, HP, armour, tier 3, attack and look; since 2026-11-18 `FACTIONS.undead.units.summon` is a copy
  of the swarm with `summoned: true`, no pairs; its only difference is the timed life below) (0.9″ either side, nudged clear with
  `freeSpot`). From that AP on they **block movement and can be hit**, but they are **not in this round's
  action list**, so they don't act until next round (`spawn` event with `mid: true`; the replay shows
  them from that moment). They have stance **Advance**, cost CP if ordered (the AI never orders them),
  **don't count toward the army cap**, give no souls when they die, and **crumble at the end of their
  3rd full round** (`ttl` = `RULES.summonTtl` + 1 at the cast, minus 1 at every end of round, removed at
  0; the summoning round doesn't count).
- **Dark Thunder** (`thunder`, 15 AP, **25 mana**): aim within 11″. At release it strikes the enemy
  squad nearest the aim point whose edge is within 1″ of it **and** that the caster has a clear line to
  (`losCut` = 1), for **14**; then it jumps up to **3** times to the nearest enemy squad not yet struck
  whose edge is within **3.5″** of the previous target's edge, each jump **×0.7** (14 → 9.8 → 6.9 → 4.8
  raw). All strikes are batched in the same AP. No target: nothing happens.
- **Corpse Explosion** (`explode`, 10 AP, **20 mana**): aim within 9″ at one of the caster side's
  **summoned** squads (the nearest whose edge is within 1.5″ of the aim). At release it bursts: it is
  removed (no souls), and every enemy squad / building within **2.5″** (+ 0.6 × its radius) of it takes
  **8 + 3 × its models left** (× the caster's damage multiplier; a full 6-model summon: 26; before 2026-11-18 it was 8 + 6 × the old 3-model summon). No summoned squad there: the spell
  fizzles (`fizzle` event; the mana is spent).

**Necromancers (Undead troop, role `mage`, high tier):** 2 models × 10 HP, armour 1, tier 4, vision
10, 1 defend, trained **at the Crypt only** (22 souls, 2 rounds; since 2026-11-24, once the Crypt is a Mausoleum). Same mage rules as the Lich (no cooldowns,
repeat casts while AP and mana last), with its own mana: **60 max, 40 at the start, +15 a round**.
- **Bolt** (basic attack): a volley line, 25 AP, 4 per model (8 for the full squad), range 9″.
- **Dark Thunder (weaker)** (`thunder`, 15 AP, **20 mana**): the same rules as the Lich's, aim within
  6″, **6 per model** (12 at full strength) on the first strike, up to **2** jumps within **3″**, ×0.7
  per jump.
- **Summon Warband** (`summon`, 20 AP, **35 mana**, aim within 4″): **1** summoned Skeleton Warband squad
  (the count comes from the skill's `count`), same rules as the Lich's summon.
- With auto skills on (stances, and the AI), it uses the same `autoSkills` rules as the Lich.

### 5.7b Hero revive (`resolve.js`, end of round)
- The fallen hero's **body lies in the ring** (UI: its mini on its back at the zone's centre) until it
  returns, so the revive point is easy to find.
- When a hero dies, `s.revive[p] = { x, z, progress 0 }` is placed where it fell (radius
  **`RULES.reviveRadius` = 3″**; a `reviveZone` event).
- From the next end of round on: if any **own** living squad (not a builder, not summoned) has its edge
  inside the zone, progress **+1** (**enemies inside don't stop it**; a `reviveTick` event).
- At **`RULES.reviveRounds` = 3** the hero returns on the spot (`freeSpot`), with **50 %** of its HP
  (`RULES.reviveHp`), its starting mana and no cooldowns; the zone is removed. A hero that dies again
  leaves a new zone. The AI sends its 2 nearest squads not in a fight to hold the zone.

**Mana (mages: any unit with `mana`: the Lich and Necromancers; numbers per unit in §7):** `mana { max 100, start 60, regen
25 }`. A mage's skills have **no cooldown** and **may be cast several times in one round** (the
once-per-round rule doesn't apply); each cast pays its mana **when the cast starts**; a cast without
enough mana at that moment fizzles. Order validation (`sanitizePlan`) drops casts beyond the mana the
mage has at the start of the round (running total, in order). Mana regenerates **+25 at the end of every
round** (capped at the max).

**Stun:** a stunned squad's current action doesn't advance and it doesn't move (1 AP of stun is
used per AP step of its tier while it has actions; `stunned` / `unstun` events). Stun is applied when
the hit lands (`max` of the old and new stun). Stun left at the end of a round **carries into the
next round once** (used up at the start of the squad's actions there); stun that was carried and is
still left at the end of that next round is dropped. A squad with no actions doesn't use up stun.

**Other specials:**
- **Shadow Step, Sweep, Bone Blast, Raise:** still supported by the rules but no unit has them now.
- **Lock Shields / Grave Wall** (tanks): if in the plan, braced **from the start of the round** for the
  whole round: hits from the front 120° (cos ≥ 0.5 from the facing) deal ×0.3. Costs 15 AP.
- **Arrow Storm** (Bone Archers): a big circle, arcs over walls.
- **Wraiths** (`ghost`): pass through all squads when walking or charging, and **are never engaged**.

**Cooldowns (non-mages):** using a skill sets its cooldown to `cd + 1` at the start of the action; cooldowns tick
down by 1 at the end of every round, so a skill with `cd` 2 can be used again 2 rounds later.

### 5.8 Engagement, disengage, parting blows, parry
- A squad is **engaged** with every enemy **melee** squad (strike attack) whose edge is within
  `RULES.engageGap` = 0.35″ (Wraiths are never engaged).
- **Disengaging:** when a move's first waypoint leads away from an engaged enemy, the squad first
  stands still for **30 AP** (`disengageAP`) and each such enemy gets one **parting blow** =
  ×0.5 of its full attack (per model × models × its multiplier). Once per enemy per round.
- **Parry** (fighters, 15 AP prepaid): the next **melee hit** (strike, charge or parting blow) on the
  squad deals nothing, and the squad **ripostes** for ×0.5 of its own full attack.

### 5.9 Overwatch (shooters, 40 AP prepaid)
The squad faces the chosen point. During **any tier**, after each AP of movement, if an enemy squad that
just moved is inside its front cone (±60°) within attack range (edge), it fires **once** at the nearest
such enemy (a normal volley toward it, needing a clear line; a lobbing unit lobs instead).

---

### 5.10 Cover (Dawn of War style; `js/sim/cover.js`)
Squads take less damage while they **stand in cover**. Cover is checked **when each hit lands**, where the
target stands then (`coverAt`).

| Cover | When | Ranged hits | Melee hits |
|---|---|---|---|
| **Heavy** | the squad's centre is within its radius × 0.6 of a **ruin**; or it stands within 0.6″ of a **Palisade / Bone Fence** (any owner) and the attacker is on the **far side** of the wall's long axis | ×0.5 (`heavyCoverRanged`) | ×0.75 (`heavyCoverMelee`) |
| **Light** | the squad's centre is inside a **forest** | ×0.75 (`lightCoverRanged`) | ×1 |

- **Ranged hits:** volley (and overwatch, tower / HQ fire), pierce, lob, storm, blast, thunder. **Melee hits:** strike, charge, parting blows, ripostes, Mighty Swing, Sweep, Leap Strike's landing. Corpse Explosion and the Plague get no cover. Buildings never get cover.
- **Ruins are walk-in cover:** they slow movement (×0.75) but no longer block movement, sight or shots.
- **Rocks and lakes stay solid.** Rocks still block shots and sight.
- **Squads take cover by themselves** (`buildStancePlan`, §4). Any of the following picks the best free cover spot (`coverSpots`: heavy before light, then nearest).
  - **Guard / Advance at its goal:** a squad with no enemy to fight within reach steps into cover within **`RULES.coverSeek` = 3″**.
  - **Shooters:**
    - with a target in range: step to a cover spot within 2″ that keeps the target in range;
    - walking into range: end at a cover spot within 2.5″ of where they would stop, if it is in range.
  - **Hold** never moves.
- **Cover spots:**
  - along each ruin (every 0.8″);
  - in each forest (its centre and a ring at 0.55 × its radius);
  - beside each Palisade / Bone Fence, on both long sides (every 1″; the side away from the enemy counts).
- **The planner** shows the cover at a move's end (a green ring and "heavy / light cover", against the nearest visible enemy). Nameplates get a shield badge (1 light, 2 heavy). The log notes "(heavy cover)" / "(light cover)" on hits.

## 6. Movement and collisions (`js/sim/nav.js`, `resolveMoves` in `resolve.js`)

- **Paths:** A* on a 0.5″ grid per squad radius (obstacles inflated by the radius; slow terrain costs
  more), then smoothed. Paths are computed when orders are given (planner / AI / stances).
- **Each AP:** a walking squad advances along its path by its speed × terrain factor.
  - **Enemy squads block.** Walking into contact with an enemy (within engage distance) **stops** the
    move ("arrived": the fight starts there).
  - **Friendly squads do not block** (you can walk through your own lines); squads that have stopped
    and overlap drift apart by up to 0.06″ per AP (never into enemies or terrain).
  - **Wraiths** pass through everything except terrain and buildings.
  - When blocked by terrain or an enemy, the squad sidesteps (0.5, 0.9, 1.3 rad) toward its preferred
    side (switches side after being stuck 4 steps); after 3 stuck steps it **re-paths** (at most every
    6 AP). A squad that ends up inside an obstacle can always step out.
  - Near the final waypoint (within 3 radii) a blocked squad counts as arrived.
- **Squad footprint radius:** 1 model = 0.65″; otherwise 0.5″ (0.62″ for riders / wraiths) +
  0.42″ × √models (shrinks as models die).
- **Deployment and spawns** are nudged to a free spot (no squad starts inside terrain).

---

## 7. Units *(generated)*

Base stats below; research (§11.7) changes some of them in a game. **Gated squads** train only after
the HQ's Tier 2: Kingdom Shieldwall and Outriders (Castle); Undead Grave Guard, Wraiths (both at the
Ossuary) and Necromancers (Mausoleum; trained at the Crypt only). Everything else is available from the start.

<!-- GEN:units -->
**Kingdom** (`FACTIONS.kingdom.units`)

| Role | Name | Models | HP/model | HP | Armour | Tier | Move "/rnd | Vision | Defends | Radius | Attack | AP | Dmg/model | Full squad/hit | Reach / range | Hits per 100 AP | Flags | Train cost | Train rnds |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| hero | The Chosen | 1 | 260 | 260 | 9 | 5 | 6 | 12 | 2 | 0.65 | strike | 25 | 18 | 20.7 | reach 1.6" + lunge 1.8" (one target) | 4 | - | - | - |
| tank | Shieldwall | 3 | 68 | 204 | 12 | 4 | 4.8 | 9 | 2 | 1.227 | strike | 30 | 4 | 13.8 | reach 1.3" + lunge 1.44" (one target) | 3 | - | 30 | 3 |
| fighter | Men-at-arms | 4 | 40 | 160 | 7 | 5 | 6 | 9 | 1 | 1.34 | strike | 25 | 5 | 23 | reach 1.5" + lunge 1.8" (one target) | 4 | parry | 24 | 2 |
| ranged | Crossbows | 4 | 30 | 120 | 3 | 5 | 6 | 11 | 1 | 1.34 | volley | 30 | 4 | 16 | range 14", width 0.7" | 3 | - | 26 | 2 |
| fast | Outriders | 3 | 48 | 144 | 5 | 6 | 7.2 | 11 | 1 | 1.347 | strike | 45 | 13 | 44.85 | reach 1.7" + lunge 2.16" (one target) | 2 | - | 30 | 2 |
| builder | Peasants | 2 | 28 | 56 | 2 | 5 | 6 | 8 | 0 | 1.094 | strike | 25 | 2 | 4.6 | reach 1.2" + lunge 1.8" (one target) | 4 | - | 10 | 1 |

**Undead Legion** (`FACTIONS.undead.units`)

| Role | Name | Models | HP/model | HP | Armour | Tier | Move "/rnd | Vision | Defends | Radius | Attack | AP | Dmg/model | Full squad/hit | Reach / range | Hits per 100 AP | Flags | Train cost | Train rnds |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| hero | Lich | 1 | 180 | 180 | 5 | 3 | 3.6 | 12 | 1 | 0.65 | volley | 25 | 10 | 10 | range 10", width 0.6" | 4 | mage: mana 60/100, +25/rnd | - | - |
| tank | Grave Guard | 3 | 42 | 126 | 9 | 4 | 4.8 | 9 | 2 | 1.227 | strike | 30 | 3.2 | 11.04 | reach 1.3" + lunge 1.44" (one target) | 3 | - | 16 | 3 |
| fighter | Skeleton Warriors | 5 | 18 | 90 | 3 | 5 | 6 | 9 | 1 | 1.439 | strike | 25 | 2.4 | 13.8 | reach 1.5" + lunge 1.8" (one target) | 4 | parry | 9 | 2 |
| swarm | Skeleton Warband | 6 | 8 | 48 | 0 | 3 | 3.6 | 9 | 0 | 1.5290000000000001 | strike | 25 | 2.1 | 14.49 | reach 1.4" + lunge 1.08" (one target) | 4 | - | 14 | 1 |
| ranged | Bone Archers | 4 | 20 | 80 | 1 | 5 | 6 | 11 | 1 | 1.34 | volley | 30 | 2.4 | 9.6 | range 14", width 0.9" | 3 | - | 13 | 2 |
| fast | Wraiths | 3 | 28 | 84 | 3 | 6 | 7.2 | 11 | 1 | 1.347 | strike | 45 | 9 | 31.05 | reach 1.7" + lunge 2.16" (one target) | 2 | ghost | 16 | 2 |
| mage | Necromancers | 2 | 20 | 40 | 1 | 4 | 4.8 | 10 | 1 | 1.094 | volley | 25 | 4 | 8 | range 9", width 0.5" | 4 | mage: mana 40/60, +15/rnd | 22 | 2 |
| summon | Skeleton Warband | 6 | 8 | 48 | 0 | 3 | 3.6 | 9 | 0 | 1.5290000000000001 | strike | 25 | 2.1 | 14.49 | reach 1.4" + lunge 1.08" (one target) | 4 | summoned (lasts 3 rnds, not trainable) | - | - |

<!-- /GEN:units -->

Notes: "Move ″/rnd" is the open-ground walk per 100 AP. "Full squad/hit" is the raw damage of one
attack at full models. "Hits per 100 AP" assumes standing in reach the whole round. Strike reach is
measured from the squad's edge; "Full squad/hit" includes `strikeMult` for strikes. Heroes cannot be trained.

---

## 8. Skills *(generated)*

<!-- GEN:skills -->
| Faction | Unit | Skill | Kind | Category | AP | Cooldown (rounds) | Mana | Dmg (per model x models) | Parameters |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Kingdom | The Chosen | Leap Strike | `leap` | move | 20 | 2 | - | 12 x 1 = 12 | range 7, flight 6, shove 1, dmg 12, radius 1.6 |
| Kingdom | The Chosen | Rally | `rally` | defense | 20 | 2 | - | - | radius 5, defends 1, dmgMult 1, armor 4 |
| Kingdom | The Chosen | Mighty Swing | `mighty` | attack | 30 | 2 | - | 28 x 1 = 28 | dmg 28, reach 2.6, cosHalf 0.2, stun 25 |
| Kingdom | Shieldwall | Lock Shields | `wall` | defense | 15 | 1 | - | - | mult 0.3, cosHalf 0.5 |
| Kingdom | Crossbows | Piercing Bolt | `pierce` | attack | 35 | 2 | - | 5 x 4 = 20 | dmg 5, range 16, width 0.7 |
| Kingdom | Outriders | Charge | `charge` | move | 35 | 1 | - | 9 x 3 = 27 | wind 8, dmg 9, len 9 |
| Undead Legion | Lich | Summon Warband | `summon` | defense | 20 | - (mage) | 40 | - | range 4, count 2, radius 1.6 |
| Undead Legion | Lich | Dark Thunder | `thunder` | attack | 15 | - (mage) | 25 | 14 x 1 = 14 | dmg 14, range 11, jumps 3, jump 3.5, decay 0.7, radius 1 |
| Undead Legion | Lich | Corpse Explosion | `explode` | attack | 10 | - (mage) | 20 | - | range 9, radius 2.5, base 8, perModel 3 |
| Undead Legion | Grave Guard | Grave Wall | `wall` | defense | 15 | 1 | - | - | mult 0.3, cosHalf 0.5 |
| Undead Legion | Bone Archers | Arrow Storm | `storm` | attack | 35 | 2 | - | 4 x 4 = 16 | dmg 4, range 15, radius 2.2 |
| Undead Legion | Wraiths | Charge | `charge` | move | 35 | 1 | - | 5.6 x 3 = 16.799999999999997 | wind 8, dmg 5.6, len 9 |
| Undead Legion | Necromancers | Dark Thunder | `thunder` | attack | 15 | - (mage) | 20 | 6 x 2 = 12 | dmg 6, range 10, jumps 2, jump 3, decay 0.7, radius 1 |
| Undead Legion | Necromancers | Summon Warband | `summon` | defense | 20 | - (mage) | 35 | - | range 4, count 1, radius 1.6 |
<!-- /GEN:skills -->

Lock Shields / Grave Wall: `mult` 0.3 = damage taken from the front arc, `cosHalf` 0.5 = ±60°.
Charge `wind` = wind-up AP before the rush, `len` = max rush distance. Leap `flight` = AP in the air,
`shove` = inches enemies are pushed. Rally `defends` = extra defends given, `dmgMult` = damage multiplier.

---

## 9. Derived combat numbers *(generated)*

<!-- GEN:derived -->
Damage per round = hits per 100 AP x damageAfter(dmg per model x models (x strikeMult for melee Strikes), armour), full squad, no defends, no cover, standing in reach. Real fights lose AP to walking.

**Kingdom: damage per 100 AP against armour**

| Unit | Raw/hit | vs 0 | vs 3 | vs 5 | vs 8 | vs 11 | vs 12 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| The Chosen | 20.7 | 84 | 72 | 68 | 60 | 52 | 52 |
| Shieldwall | 13.8 | 42 | 36 | 33 | 30 | 27 | 27 |
| Men-at-arms | 23 | 92 | 80 | 72 | 64 | 60 | 56 |
| Crossbows | 16 | 48 | 42 | 39 | 33 | 30 | 30 |
| Outriders | 44.85 | 90 | 78 | 72 | 64 | 58 | 56 |
| Peasants | 4.6 | 20 | 16 | 16 | 12 | 12 | 12 |

**Undead Legion: damage per 100 AP against armour**

| Unit | Raw/hit | vs 0 | vs 3 | vs 5 | vs 8 | vs 11 | vs 12 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Lich | 10 | 40 | 36 | 32 | 28 | 24 | 24 |
| Grave Guard | 11.04 | 33 | 30 | 27 | 24 | 21 | 21 |
| Skeleton Warriors | 13.8 | 56 | 48 | 44 | 40 | 36 | 36 |
| Skeleton Warband | 14.49 | 56 | 52 | 48 | 40 | 36 | 36 |
| Bone Archers | 9.6 | 30 | 24 | 24 | 21 | 18 | 18 |
| Wraiths | 31.05 | 62 | 54 | 50 | 44 | 40 | 38 |
| Necromancers | 8 | 32 | 28 | 24 | 24 | 20 | 20 |
| Skeleton Warband | 14.49 | 56 | 52 | 48 | 40 | 36 | 36 |

**Attacks needed: Kingdom (rows, full squad, no losses) vs Undead Legion (columns, full HP, no defends)** (rounds = attacks / hits per 100 AP)

| Attacker \ Target | Lich | Grave Guard | Skeleton Warriors | Skeleton Warband | Bone Archers | Wraiths | Necromancers | Skeleton Warband |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| The Chosen | 11 (2.8 r) | 9 (2.3 r) | 5 (1.3 r) | 3 (0.8 r) | 4 (1 r) | 5 (1.3 r) | 2 (0.5 r) | 3 (0.8 r) |
| Shieldwall | 17 (5.7 r) | 13 (4.3 r) | 8 (2.7 r) | 4 (1.3 r) | 7 (2.3 r) | 7 (2.3 r) | 4 (1.3 r) | 4 (1.3 r) |
| Men-at-arms | 10 (2.5 r) | 8 (2 r) | 5 (1.3 r) | 3 (0.8 r) | 4 (1 r) | 5 (1.3 r) | 2 (0.5 r) | 3 (0.8 r) |
| Crossbows | 14 (4.7 r) | 12 (4 r) | 7 (2.3 r) | 3 (1 r) | 6 (2 r) | 6 (2 r) | 3 (1 r) | 3 (1 r) |
| Outriders | 5 (2.5 r) | 5 (2.5 r) | 3 (1.5 r) | 2 (1 r) | 2 (1 r) | 3 (1.5 r) | 1 (0.5 r) | 2 (1 r) |
| Peasants | 45 (11.3 r) | 42 (10.5 r) | 23 (5.8 r) | 10 (2.5 r) | 20 (5 r) | 21 (5.3 r) | 10 (2.5 r) | 10 (2.5 r) |

**Attacks needed: Undead Legion (rows, full squad, no losses) vs Kingdom (columns, full HP, no defends)** (rounds = attacks / hits per 100 AP)

| Attacker \ Target | The Chosen | Shieldwall | Men-at-arms | Crossbows | Outriders | Peasants |
| --- | --- | --- | --- | --- | --- | --- |
| Lich | 38 (9.5 r) | 34 (8.5 r) | 23 (5.8 r) | 14 (3.5 r) | 18 (4.5 r) | 7 (1.8 r) |
| Grave Guard | 33 (11 r) | 30 (10 r) | 20 (6.7 r) | 12 (4 r) | 16 (5.3 r) | 6 (2 r) |
| Skeleton Warriors | 26 (6.5 r) | 23 (5.8 r) | 16 (4 r) | 10 (2.5 r) | 14 (3.5 r) | 5 (1.3 r) |
| Skeleton Warband | 26 (6.5 r) | 23 (5.8 r) | 15 (3.8 r) | 10 (2.5 r) | 12 (3 r) | 5 (1.3 r) |
| Bone Archers | 38 (12.7 r) | 34 (11.3 r) | 23 (7.7 r) | 15 (5 r) | 18 (6 r) | 7 (2.3 r) |
| Wraiths | 13 (6.5 r) | 11 (5.5 r) | 7 (3.5 r) | 5 (2.5 r) | 6 (3 r) | 2 (1 r) |
| Necromancers | 44 (11 r) | 41 (10.3 r) | 27 (6.8 r) | 18 (4.5 r) | 24 (6 r) | 8 (2 r) |
| Skeleton Warband | 26 (6.5 r) | 23 (5.8 r) | 15 (3.8 r) | 10 (2.5 r) | 12 (3 r) | 5 (1.3 r) |

<!-- /GEN:derived -->

---

## 10. Economy

### 10.1 Resources, income, training *(generated)*

<!-- GEN:economy -->
| Faction | Resource | Start | HQ income/rnd | Gather (AP per 1 resource) | Builder gathering a full round | Buildable |
| --- | --- | --- | --- | --- | --- | --- |
| Kingdom | Gold | 60 | 6 | farm 8 (4 gatherers), mine 10 (2 gatherers) | farm ~12, mine ~10 | barracks, tower, farm, mine, banner, wall, forge, chapel |
| Undead Legion | Souls | 90 | 1 | - (no builders) | - | barracks, tower, well, monolith, wall, pit, sanctum |

Builders: Kingdom up to 10 peasant squads (not in the army cap); Undead 0 (buildings rise by themselves). HQ trains: Kingdom builder/fighter; Undead Legion swarm/mage.

**Training cost (resource) and time (rounds)**

| Role | Kingdom cost | Undead Legion cost | Rounds | Trained at |
| --- | --- | --- | --- | --- |
| builder | 10 | - | 1 | Keep (Kingdom only) |
| tank | 30 | 16 | 3 | Barracks / Ossuary |
| fighter | 24 | 9 | 2 | Barracks / Ossuary |
| swarm | - | 14 | 1 | Crypt and Ossuary (Undead only; a pair per training) |
| ranged | 26 | 13 | 2 | Barracks / Ossuary |
| fast | 30 | 16 | 2 | Barracks / Ossuary |
| mage | - | 22 | 2 | Ossuary (Undead only) |

Souls: every model that dies (either side, not summoned skeletons) on the undead side's grave ground pays 3 souls (a hero: 15); graveyards: hq 10", barracks 6", tower 6", monolith 6", wall 6", pit 6", sanctum 6", well 10" (a new site spreads 50 % at once and the rest by the end of the round; the Crypt starts at 10"). Pairs: Skeleton Warband x2.

**Undead death economy: souls back when a whole squad dies on your graves vs its cost** (both sides' deaths pay; the table uses undead squads)

| Role | Name | Tier rule | Models | Cost (per squad) | Souls back (per squad) | Back / cost |
| --- | --- | --- | --- | --- | --- | --- |
| tank | Grave Guard | high (cost may change) | 3 | 16 | 9 | 0.6x |
| fighter | Skeleton Warriors | low (cost fixed) | 5 | 9 | 15 | 1.7x |
| swarm | Skeleton Warband | low (cost fixed) | 6 | 7 | 18 | 2.6x |
| ranged | Bone Archers | low (cost fixed) | 4 | 13 | 12 | 0.9x |
| fast | Wraiths | high (cost may change) | 3 | 16 | 9 | 0.6x |
| mage | Necromancers | high (cost may change) | 2 | 22 | 6 | 0.3x |

Flat income: Crypt 1 a round, Soul Well 2 a round each. Kingdom deaths on undead graves pay the same per model (Kingdom Shieldwall 9, Men-at-arms 12, Crossbows 12, Outriders 9).
<!-- /GEN:economy -->

### 10.2 Rules
- **Income** is paid at the end of every round: HQ income + income of every **finished** Farm / Mine /
  Soul Well; then × the side's `incomeMult` (1; vs the AI on **Brutal**, the AI side has 1.3, §14.10),
  rounded.
- **Kingdom (Gold): a farm economy that grows late.** Keep 6, Mine +6 (on a resource site), Farm +2
  passive. Farms are **big** (4.2 × 3.4″, so they cost build-zone land; no farm limit) and take up to
  **4 farmers** each (`BUILDINGS.farm.slots`); a peasant farming a full round makes ~12 gold (1 gold per
  **8 AP**); mines take 2 (1 per 10 AP). Peasants cost 10, up to **10 squads**
  (`FACTIONS.kingdom.maxBuilders`), and **don't count toward the army cap**.
- **Undead (Souls): a death economy** (§10.4). The flat income is tiny on purpose, just enough that
  the Undead never stop completely: the **Crypt +1** a round (`FACTIONS.undead.eco.hq`) and each
  **Soul Well +2** (`BUILDINGS.well.income`). **The main income is death on graves:** every model that
  dies on either side (summoned skeletons excepted) **on the undead side's grave ground** pays
  **`RULES.soulPerModel` = 3** souls (a hero **`soulPerHero`** = 15), credited at the end of the round
  from where it fell. Because the pay is per **model**, cheap many-model squads give back **more than
  they cost** when they fall on graves (a Skeleton Warband squad: 6 models → 18 souls for 7 souls of
  cost, 2.6×; Skeleton Warriors 1.7×) and elite few-model squads give back less (Grave Guard / Wraiths
  0.6×, Necromancers 0.3×; the generated table above). So the Undead plan is: spread graves toward the
  enemy (Monoliths, Bone Fences), fight on them, and spend cheap skeletons. Start: 90 souls (the
  Kingdom: 60 gold). No gathering (no builders). Mirror Undead matches: each side collects from deaths
  on its own graves.
- **The tier rule for balancing the Undead** (owner's rule): **low-tier** units (Skeleton Warband,
  Skeleton Warriors, Bone Archers; `FACTIONS.undead.lowTier`) keep their **costs**; only their stats
  change. **High-tier** units (Grave Guard, Wraiths, Necromancers, the Lich's spells) may have their
  costs (souls, mana) changed, up or down, but **only after asking the owner** (never proposed on
  our own); elite squads are meant to lose value when they die.

### 10.4 Graveyards (`graveCircles` / `graveAt` in `js/sim/base.js`, end of round in `resolve.js`)
- **Graves spread almost at once** (blight / creep / a Necron power matrix): an undead site gets
  **`RULES.graveStart` = 50 %** of its graveyard the moment it is placed, and **every undead building
  (rising or finished) reaches its full graveyard at the end of every round**. Reach (`BUILDINGS.<type>.
  grave`): **Soul Well 10″**, **Crypt 10″** (full from the start, `graveHqStart`), every other undead
  building **6″** (the Monolith too).
- **Every undead building except the Monolith must stand on its own graves** (its centre inside a
  graveyard), and so must Soul Wells (which also need a free resource site). The Undead expand by
  chaining graves outward: a **Monolith** (20 souls, heals) or a cheap **Bone Fence** (6 souls) on the
  edge of the graves adds 6″ more graves around it, reaching further each time.
- **On the table** the grave ground is a change of the ground texture itself (dark purple-black blight
  with faint violet veins, edges fading over about 1.6″ with noise; `js/render/ground.js`), with
  headstones, crosses, bone piles and dead stumps scattered on it, thick in the middle and thinning
  toward the rim (`js/render/graves.js`). Visual only.
- **Deaths spread graves where they happen** (`spreadGraves` in `js/sim/base.js`, since 2026-11-17;
  before, every death widened the whole graveyard circle). For each group of `n` models (either side,
  not summoned) that dies at one spot on a graveyard (credited at the end of the round, after the
  souls):
  1. **Direction:** from that graveyard's centre toward where they died (died at the very centre:
     toward the enemy's side, +x for player 0, −x for player 1).
  2. **Spot:** the graveyard's **rim** in that direction, pushed on in 0.25″ steps while the spot is
     still more than half an area-radius inside any of the side's grave ground (so it lands at the real,
     nearest edge of the grave ground that way), clamped to the board.
  3. **Area:** a new small grave area (a patch with `blob: true` in `s.graves[p]`) of radius
     **`RULES.graveBlob` × √n = 0.8″ × √n** (one model 0.8″, a 6-model squad ~2″) centred there.
  4. **Merging:** if an earlier death area's centre is closer than 0.6 × (its radius + the new radius),
     the two merge instead: areas add up (r = √(r₁² + r₂²)) and the centre moves toward the new spot,
     weighted by area. Big areas therefore keep creeping toward where the fighting is.
  - The graveyard the models died on **doesn't change size**; there is **no maximum** on how far
    death areas spread. Building graveyards stay at their reach.
- A destroyed undead building **leaves its graveyard behind** as a patch (`s.graves[p]`, its radius
  at that moment). Patches and death areas never disappear; deaths on them pay souls and spread new
  areas from their edges in the same way.
- If several graveyards overlap, a death counts once (on the first graveyard found: buildings first,
  then patches).
- Grave ground is drawn as dark soil with tombstones, crosses and bones (`js/render/graves.js`); the
  fog covers it like the rest of the table.
- **Resource sites:** fixed points per map (§13); a site holds one Mine / Soul Well; the site belongs to
  the owner of a finished one (destroying it frees the site).
- **Gathering:** a builder working at a gather building turns each AP spent in reach into progress;
  at the end of its work action it gets `floor(progress / rate)` resource; the remainder carries over to
  the next round while it stays at the same building. At most **2 builders per building** (Farms
  **4**); the next one is turned away and goes elsewhere next round.
- **Training:** paid when it **starts** (round start, from the building's queue, §10.3); the squad
  appears next to the building at the end of its last training round (builder 1, fighter / ranged /
  fast 2, tank 3), on the first free spot (toward the enemy first). Squads in training count toward the
  army cap; queued squads do not. Stopping a squad in training refunds its full cost.
- **Army cap:** `RULES.armyCap` = **30** squads + the map's bonus (Twin Rivers / Highland +4, Great Field
  +8). **Builders and summoned skeletons don't count** (`inArmy` in `js/sim/base.js`); squads in training
  do (builders in training don't).

### 10.3 Production queues (`startQueues` in `js/sim/base.js`)
Two kinds of persistent queue, stored in the state and kept across rounds with no new orders:
- **One base build queue per side** (`s.bq[p]`, up to 5 buildings, each a type + spot). Shared by all
  the side's builders.
- **One training queue per training building** (`b.queue`, up to 5 roles; HQ and Barracks / Ossuary).
  Lost (free) if the building is destroyed.

**Pay when it starts.** At round start (after this round's queue edits), with a running resource total:
1. **Build queue, front to back.** For each item:
   - If its spot is now **permanently invalid** (terrain, a building, the site taken, a farm / banner
     limit; `placeError` ignoring squads) it is **dropped** (`queueDrop` event, nothing paid) and the
     next item is considered.
   - Else it **waits** (and every item behind it waits too, strict order) if: the side already has as
     many unfinished sites as it has living builders (`builders`), or it can't pay (`gold` / `souls`,
     with the shortfall), or a squad stands on the spot (`blocked`).
   - Else it **starts**: the cost is paid, the site is placed (30 % HP, §11.3), a `construct` event
     with its `qid`, and the next item is considered.
2. **Training buildings, by building id.** A building with no squad in training starts the first role of
   its queue if the army (squads + squads in training) is below the cap, the builder cap allows it (for
   builders) and the side can pay; otherwise the queue waits (nothing behind it jumps ahead). At most one
   squad starts per building per round, and a building that finishes a squad at the end of round N
   starts the next one at the start of round N + 1 (no gap).
   **Repeat (locked production, `b.repeat`):** a locked building whose queue is **empty** treats its
   locked role as the next item: it starts it under the same rules (cap, builder cap, cost; it waits
   when it can't) without it ever leaving the queue, so the building keeps training that role every
   time it is free, with no new orders. Queued items always go first.
3. The build queue is served before training, so a waiting building does not stop training (only its
   cost is reserved once it can start).

The UI runs the same function without applying it (a forecast) to show "starts this round" or why an
item waits.
---

## 11. Buildings and builders

### 11.1 Building data *(generated)*

<!-- GEN:buildings -->
| Type | Names (Kingdom / Undead) | Cost | Work (builder AP) | Builder-rounds | Undead rise rounds | HP | Site HP | Armour | Footprint | Vision | Fire (after the tiers) | Income/rnd | Special | Built by |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `hq` | Keep / Crypt | 0 | 0 | 0 | - | 440 | 132 | 8 | 4 x 4 | 10 | 3 x 4 = 12 raw, range 8" | - | trains kingdom: builder/fighter, undead: swarm/mage | kingdom, undead |
| `barracks` | Barracks / Ossuary | 30 | 240 | 2.4 | 3 | 300 | 90 | 8 | 3.5 x 2.5 | 6 | - | - | trains tank/fighter/swarm/ranged/fast | kingdom, undead |
| `tower` | Watchtower / Bone Spire | 25 | 200 | 2 | 3 | 220 | 66 | 6 | circle r 0.9 | 13 | 4 x 4 = 16 raw, range 11" | - | - | kingdom, undead |
| `banner` | Banner / Obelisk | 20 | 120 | 1.2 | - | 120 | 36 | 4 | circle r 0.55 | 6 | - | - | +1 CP | kingdom |
| `monolith` | Monolith / Monolith | 20 | 120 | 1.2 | 2 | 140 | 42 | 4 | circle r 0.6 | 7 | - | - | - | undead |
| `wall` | Palisade / Bone Fence | 6 | 60 | 0.6 | 1 | 160 | 48 | 6 | 3 x 0.5 | 0 | - | - | - | kingdom, undead |
| `farm` | Farm / Farm | 25 | 140 | 1.4 | - | 180 | 54 | 3 | 4.2 x 3.4 | 5 | - | 2 | 4 gatherers | kingdom |
| `mine` | Mine / Mine | 30 | 160 | 1.6 | - | 200 | 60 | 6 | circle r 1.1 | 7 | - | 6 | resource site only | kingdom |
| `forge` | Blacksmith / Blacksmith | 40 | 200 | 2 | - | 240 | 72 | 7 | 3.5 x 2.5 | 5 | - | - | - | kingdom |
| `chapel` | Chapel / Chapel | 35 | 160 | 1.6 | - | 200 | 60 | 6 | circle r 1 | 6 | - | - | - | kingdom |
| `pit` | Charnel Pit / Charnel Pit | 30 | 160 | 1.6 | 2 | 200 | 60 | 6 | 3 x 2.5 | 5 | - | - | - | undead |
| `sanctum` | Dark Sanctum / Dark Sanctum | 30 | 160 | 1.6 | 2 | 180 | 54 | 5 | circle r 1 | 7 | - | - | - | undead |
| `well` | Soul Well / Soul Well | 20 | 160 | 1.6 | 2 | 180 | 54 | 5 | circle r 1.1 | 7 | - | 2 | resource site only; soul collector (undefined") | undead |

Repair (Kingdom builders): builder AP x (max HP / work) HP per AP. Undead buildings rise by 80 work a round (at most 2 at once) and mend 5 % of max HP a round. Siege damage taken: damageAfter(raw x 2.5, armour) (no defends).
<!-- /GEN:buildings -->

### 11.2 Placement (`placeError` in `js/sim/base.js`)
- On the board (footprint at least 0.3″ inside the edge).
- **Normal buildings: anywhere on ground the side has seen** (the old "own third only" rule is gone),
  but not within 1.8″ (0.6 × 3) of a resource site.
- **Seen ground:** every building (both armies, the HQ excepted) needs its centre on a cell the side has
  seen at least once (§12): "You haven't seen that spot yet".
- **Undead graves:** every undead building, the Monolith included, needs its centre on the side's grave
  ground (§10.4): "Undead buildings must stand on your graves".
- **Mine / Soul Well:** only on a **free resource site** (within 0.6″; the UI snaps to it), anywhere on
  the table.
- Not overlapping terrain (+0.2″; not in a stream), other buildings (+0.3″) or **enemy** squads (+0.1″):
  "An enemy squad is standing there".
- **Your own squads make way:** when a site starts (`startQueues`), every own squad overlapping its
  footprint moves to the nearest free spot outside it (`pushOut` in `js/sim/base.js`, rings 0.5″ apart
  around the building; a `pushed` event, logged as "makes way for …").
- Max 2 Banners (Kingdom only; no farm limit). The building must be in the side's faction list.

### 11.3 Construction (builders)
- A new site appears at round start with **30 %** of max HP (`siteHp`), blocks movement, can be
  attacked, and sees only 3″.
- **Work:** each AP a builder spends with its edge within **1.0″** of the footprint adds 1 work and
  `max HP × 0.7 / work` HP. When the work total is reached the building is finished **mid-round**
  (full vision, its income / CP / fire from then on).
- **Two builders** on one site work twice as fast. One builder puts in ~100 AP per round minus walking.
- **Repair:** builder work on a damaged finished building restores `max HP / work` HP per AP.
- **Builders' work order** is "go there and work": the builder paths around the real obstacles at
  resolution, slips between its own squads, re-paths when stuck, then works with the AP left.
  **Builders remember their task** across rounds (finish → then gather automatically).
- Builders cost no CP; Kingdom max 10 squads; trained at the Keep (1 round, 10 gold).

### 11.3b Undead buildings rise out of the ground (no builders)
- The Undead have no builder unit. A started item of their build queue becomes a site (30 % HP, as
  above) and at the **end of every round** gains **`RULES.riseWork` = 80 work** (HP grows the same way
  as builder work: `max HP × 0.7 × work / total work`), so it finishes after `ceil(work / 80)` rounds:
  wall 1, monolith 2, soul well 2, bone spire 3, ossuary 3. It counts as finished at the end of that
  round (`built` event, `by: null`).
- At most **`RULES.maxRising` = 2** undead sites rise at the same time (this replaces "one site per
  builder" in `startQueues`: the front item waits with reason `rising`). Monoliths count like any
  other site.
- Finished undead buildings (not the Crypt) **mend 5 % of max HP** at the end of every round
  (`RULES.undeadMend`), since nobody can repair them.
- The UI sinks the site's model into the table and raises it with progress (no scaffold).

### 11.3c The Monolith (Undead; replaced the Obelisk on 2026-11-17)
- `BUILDINGS.monolith`: cost **20** souls, work 120 (rises in **2 rounds**), HP 70, armour 4, a circle
  of r 0.6″, vision 7, graveyard **6″** (`grave`), **no command point**.
- **An ordinary Undead building** (since 2026-11-18; for one day it was a Lich / Necromancers skill
  that could raise it off graves): queued from the build menu, it must stand **on the side's graves**
  (§11.2), takes one of the 2 rising slots and rises by itself. Like any undead site it spreads half its
  graves when it starts and all of them by the end of the round, so a Monolith on the edge of the graves
  pushes the blight forward and gives the horde a healing station there.
- **Heal** (`heal: { radius 4, hp 4 }`), at the end of every round after the undead mend and before
  mana regen: every own living, non-summoned squad below full HP whose **edge** is within **4″** of a
  **finished** Monolith's centre regains **4 HP per model alive** (at least 4; models come back as HP
  passes each model's threshold, up to full) (`heal` event). Several Monoliths each heal.

### 11.4 What a builder does with no orders (`builderIdleTarget` in `js/sim/builders.js`)
Kingdom builders gather at Farms and Mines. A builder with no direct orders (and not on
Hold) picks, in order:
1. its remembered **build or repair** task, while that building still needs it;
2. else an own **unfinished site at any distance** (so it takes the next started item of the build
   queue): the site with the **fewest builders already on it**, then the nearest. Idle builders choose in
   squad id order and count each other's picks, so two idle builders spread over two new sites. A
   **gatherer is free**: it leaves its gather building for a new site;
3. else its remembered gather task, else the nearest own gather building with a free slot (farms 4,
   mines 2).

**Reachability:** a builder only takes a task or site it can reach: it must already be within work reach,
or `approachSpot` must find a free spot by the footprint. That spot is tried at gap radius + 0.3″, then
0.9 × radius, then radius + 0.8″, first clear of every squad, then sharing a spot with friends. A builder
whose walk finds no path drops the task (`workFail`) instead of trying it again every round.

### 11.5 Barracks / training buildings
The Keep trains builders (peasants); the **Crypt trains the Skeleton Warband swarm** (`FACTIONS.<f>.hqTrains`);
Barracks / Ossuary train tank, fighter, ranged, fast (the Ossuary also the swarm).
**Pairs:** a unit with `pair: 2` (the Skeleton Warband) spawns **2 squads** from one training (each a
full squad, both counting toward the army cap; the queue waits unless 2 cap slots are free). One squad in training at a
time each, with up to 5 more queued (§10.3).

### 11.6 Tower and HQ fire (after all tiers)
Each finished Watchtower / Bone Spire / HQ picks the **nearest enemy squad** whose edge is within its
range and that it can see (same sight rules as §12, its own footprint excluded), and fires one shot:
raw damage = `fire.dmg × 4` (HQ 3 × 4 = 12, tower 4 × 4 = 16); the target's cover (ranged) and defends
apply. One shot per building per round.

---

### 11.7 Tech tree (`js/data/tech.js`; queue rules in `js/sim/base.js`)
Upgrades form a branching tree per faction, not a straight line (since 2026-11-24). References:
Warcraft III tiers and Blacksmith / Graveyard / Temple of the Damned; Age of Empires ages and Mill /
Mining Camp upgrades; StarCraft II research in a building's queue; Age of Mythology minor gods, Dawn of
War commanders and C&C Generals powers for the exclusive picks.
- **Where:** research is done at the **HQ** (tiers, economy, doctrines) and at **tech buildings**
  (Kingdom: Blacksmith, Chapel; Undead: Charnel Pit, Dark Sanctum). Tech buildings are ordinary
  buildings of the side (built by peasants / rising on graves) that only research.
- **The queue:** research items (`'tech:<id>'`) go in the building's training queue (max 5 items with
  the squads). At round start the front item **pays its cost and starts** (`b.train = { tech, left,
  total }`); the building trains nothing meanwhile. It **waits** (strictly in order) while the side
  can't pay (`gold` / `souls`) or its requirements aren't finished yet (`needs`, with the reason).
  Research counts down at the end of every round next to training; when done, the tech joins the
  side's list (`s.tech[p]`), a `researched` event fires and it takes effect at once. Stopping research
  in progress refunds it in full, as with training.
- **Queueing is allowed when:** the building researches it (`at`), it isn't done, under way or
  queued anywhere, the other doctrine of its pair isn't taken, and each prerequisite (`needs`) is done,
  under way, or queued **earlier in the same line** (so Plough → Castle → Crop Rotation can be queued
  together). `needsBuilding` (Castle: a Barracks; Citadel: a Blacksmith or Chapel) must stand,
  finished.
- **Tiers:** the HQ upgrade is itself research (`hqTier`): Tier 2 (Castle / Mausoleum) unlocks the
  **elite squads** (gates below), the **tech buildings** ("Needs the Castle" in placement) and the tier
  2 research and doctrine; Tier 3 (Citadel / Necropolis) the strongest research and the last doctrine.
  The HQ gets more HP (current HP grows by the same amount), stronger fire or graves, and a bigger model.
- **Doctrines:** one exclusive pick per tier: researching one locks the other for the rest of the game.
- **Research is kept** when the building that did it is destroyed (only research in progress there is
  lost; it isn't refunded since the building is gone).
- **How effects apply:** every squad and building carries its side's tech key (`tk`); `defOf(q)` and
  `bdef(b)` return the base definition with the side's research applied (cached per key), so damage,
  armour, range, HP, mana, skill fields, Warband pairs, building HP / fire / graves / heal all follow.
  HP research raises current HP with the maximum. Side-wide rules (`ruleOf`): farm gathering AP, farm /
  mine / HQ income, souls per model, death grave areas, revive rounds, summon life, Warriors training in
  1 round, the Plague drain (enemy squads on your graves lose 1 HP per model a round, never their last
  HP).

<!-- GEN:tech -->
**Kingdom** (`TECH` in `js/data/tech.js`). Gates: Shieldwall need Castle; Outriders need Castle; Blacksmith needs Castle; Chapel needs Castle.

| id | Name | Tier | At | Cost | Rounds | Needs | Doctrine | Effect |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `castle` | Castle | 2 | Keep | 60 | 3 | a Barracks | - | Tier 2: the Keep becomes a Castle (HP 600, stronger fire). Unlocks Shieldwall and Outriders, the Blacksmith, the Chapel and a doctrine. |
| `citadel` | Citadel | 3 | Keep | 100 | 4 | Castle, a Blacksmith or Chapel | - | Tier 3: the Citadel (HP 800, fire 5, +1 command point). Unlocks the strongest research and the last doctrine. |
| `plough` | Heavy Plough | 1 | Keep | 20 | 1 | - | - | Farmers work faster: 7 AP per gold instead of 8. |
| `rotation` | Crop Rotation | 2 | Keep | 40 | 2 | Heavy Plough, Castle | - | Every farm earns +1 gold a round by itself. |
| `shafts` | Deep Shafts | 2 | Keep | 35 | 2 | Castle | - | Mines earn +3 gold a round. |
| `guild` | Guild Charter | 3 | Keep | 60 | 3 | Crop Rotation, Citadel | - | The Citadel earns +4 gold a round. |
| `steel1` | Steel Weapons I | 2 | Blacksmith | 30 | 2 | - | - | Soldiers deal 15 % more damage. |
| `steel2` | Steel Weapons II | 3 | Blacksmith | 50 | 3 | Steel Weapons I, Citadel | - | Soldiers deal another 15 % more damage. |
| `plate1` | Plate Armour I | 2 | Blacksmith | 30 | 2 | - | - | Soldiers +2 armour. |
| `plate2` | Plate Armour II | 3 | Blacksmith | 50 | 3 | Plate Armour I, Citadel | - | Soldiers +2 more armour. |
| `bodkin` | Bodkin Bolts | 2 | Blacksmith | 35 | 2 | Steel Weapons I | - | Crossbows shoot 2″ further; Piercing Bolt +2 damage. |
| `legend` | Heroic Legend | 2 | Chapel | 40 | 2 | - | - | The Chosen +80 HP; Leap Strike reaches 2″ further. |
| `valour` | Valour | 2 | Chapel | 35 | 2 | - | - | Rally reaches 2″ further and gives +2 more armour. |
| `hospital` | Field Hospital | 2 | Chapel | 40 | 2 | Valour | - | Your squads within 4″ of a Chapel heal 6 HP per model a round. |
| `chosen` | Return of the Chosen | 3 | Chapel | 45 | 3 | Heroic Legend, Citadel | - | A fallen hero comes back after 2 rounds of holding its spot instead of 3. |
| `knightly` | Knightly Order | 2 | Keep | 40 | 2 | Castle | tier 2 pick | Doctrine: Outriders charge 40 % harder and get +2 armour. |
| `yeomanry` | Free Yeomanry | 2 | Keep | 40 | 2 | Castle | tier 2 pick | Doctrine: Crossbows reload faster (volley 25 AP); peasants +3 armour and hit harder. |
| `crusade` | Crusade | 3 | Keep | 70 | 3 | Citadel | tier 3 pick | Doctrine: all soldiers deal 10 % more damage and get +1 defend. |
| `fortress` | Fortress Realm | 3 | Keep | 70 | 3 | Citadel | tier 3 pick | Doctrine: buildings +30 % HP, towers +2″ range, Palisades need half the work. |

**Undead Legion** (`TECH` in `js/data/tech.js`). Gates: Grave Guard need Mausoleum; Wraiths need Mausoleum; Necromancers need Mausoleum; Charnel Pit needs Mausoleum; Dark Sanctum needs Mausoleum.

| id | Name | Tier | At | Cost | Rounds | Needs | Doctrine | Effect |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `mausoleum` | Mausoleum | 2 | Crypt | 40 | 2 | a Ossuary | - | Tier 2: the Crypt becomes a Mausoleum (HP 600, graves 12″). Unlocks Grave Guard and Wraiths (Ossuary), Necromancers (Crypt), the Charnel Pit, the Dark Sanctum and a doctrine. |
| `necropolis` | Necropolis | 3 | Crypt | 70 | 4 | Mausoleum, a Charnel Pit or Dark Sanctum | - | Tier 3: the Necropolis (HP 760, graves 14″). Unlocks the strongest research and the last doctrine. |
| `restless` | Restless Earth | 1 | Crypt | 15 | 1 | - | - | Graves spread 25 % more where things die. |
| `harvest` | Soul Harvest | 2 | Crypt | 30 | 2 | Mausoleum | - | Every model dying on your graves gives +1 soul. |
| `blight` | Spreading Blight | 2 | Crypt | 25 | 2 | Restless Earth | - | Every Undead building spreads its graves 2″ further. |
| `massgraves` | Mass Graves | 3 | Crypt | 45 | 3 | Soul Harvest, Necropolis | - | Monoliths heal 4 more HP per model and spread graves 3″ further. |
| `bones1` | Sharpened Bones I | 2 | Charnel Pit | 20 | 2 | - | - | Skeletons deal 15 % more damage (Warband, Warriors, Archers, summons). |
| `bones2` | Sharpened Bones II | 3 | Charnel Pit | 35 | 3 | Sharpened Bones I, Necropolis | - | Skeletons deal another 15 % more damage. |
| `plating1` | Bone Plating I | 2 | Charnel Pit | 20 | 2 | - | - | Skeletons +1 armour. |
| `plating2` | Bone Plating II | 3 | Charnel Pit | 35 | 3 | Bone Plating I, Necropolis | - | Skeletons +1 more armour. |
| `swarm3` | Endless Swarm | 3 | Charnel Pit | 45 | 3 | Sharpened Bones I, Necropolis | - | Skeleton Warbands come three squads at a time instead of two. |
| `shroud` | Wraith Shroud | 2 | Charnel Pit | 30 | 2 | - | - | Wraiths +2 armour; their charge hits 30 % harder. |
| `necromancy` | Necromancy | 2 | Dark Sanctum | 25 | 2 | - | - | Necromancers +20 mana and +5 mana a round. |
| `greater` | Greater Summoning | 2 | Dark Sanctum | 35 | 2 | Necromancy | - | Summoned skeletons last 4 rounds instead of 3. |
| `chain` | Chain Storm | 2 | Dark Sanctum | 35 | 2 | - | - | Dark Thunder jumps once more (the Lich and Necromancers). |
| `phylactery` | Phylactery | 3 | Dark Sanctum | 45 | 3 | Greater Summoning, Necropolis | - | The Lich comes back after 2 rounds instead of 3, and has +25 mana. |
| `bonetide` | Bone Tide | 2 | Crypt | 30 | 2 | Mausoleum | tier 2 pick | Doctrine: Warbands and Warriors +2 HP per model; Warriors train in 1 round. |
| `darkarts` | Dark Arts | 2 | Crypt | 30 | 2 | Mausoleum | tier 2 pick | Doctrine: the Lich and Necromancers regain 10 more mana a round; Dark Thunder hits 30 % harder. |
| `horde` | Endless Horde | 3 | Crypt | 60 | 3 | Necropolis | tier 3 pick | Doctrine: Summon Warband raises one more squad (the Lich 3, Necromancers 2). |
| `plague` | Plague of Graves | 3 | Crypt | 60 | 3 | Necropolis | tier 3 pick | Doctrine: enemy squads standing on your graves lose 1 HP per model at the end of every round. |

<!-- /GEN:tech -->

## 12. Fog of war and intel (`js/sim/vision.js`)

- A side sees an enemy squad if **any** of its squads (vision = unit vision) or buildings (vision =
  building vision; sites 3″) can see it:
  - within vision range (centre to centre);
  - the line is not cut by a rock or building (ruins don't block sight);
  - the line does not pass through more than **2″ of forest**;
  - a target **inside a forest** is only seen from within **4″**.
- **Stance plans and the AI** only use enemies the side can see (at round start); the AI also
  remembers enemies seen in the last 3 rounds.
- **Intel:** a side remembers every enemy building it has seen (snapshot) and forgets it when it sees
  the spot again without it. The **enemy HQ is not known until scouted.** Each HQ starts at one of the
  map's 3 HQ spots (seeded).
- **Seen ground (sim, `s.explored[p]`):** a 1″ grid per side, one char per cell, marked at every intel
  update (round start and end) for each cell an observer can see (`markSeen`, same rule as above). At the
  start each side has seen its own third of the table (`initSeen`). **Buildings may only be placed on
  ground the side has seen at least once** (§11.2).
- The display fog (UI only): unexplored ground is covered in mist, explored-but-unseen ground is hazed;
  the replay only shows enemies your side saw.

---

## 13. Maps *(generated)*

<!-- GEN:maps -->
| Map | id | Size | Build zone (x <) | Army cap | HQ spots (z, player 0 at x 3.5) | Resource sites | Rivers (x: fords z/width) | Lakes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Crossing | `crossing` | 48 x 32 | 16" (player 1: x > 32) | 30 | 9, 16, 23 | 4 | 24: 7/3, 25/3 | 0 |
| Twin Rivers | `twinrivers` | 64 x 40 | 21" (player 1: x > 43) | 34 | 10, 20, 30 | 6 | 22: 9/3, 29/3; 42: 31/3, 11/3 | 0 |
| Highland Ruins | `highland` | 64 x 44 | 21" (player 1: x > 43) | 34 | 11, 22, 33 | 6 | - | 1 |
| Great Field | `greatfield` | 80 x 52 | 27" (player 1: x > 53) | 38 | 12, 26, 40 | 8 | 40: 8/3, 26/3.4, 44/3 | 2 |

#### Crossing (`crossing`, 48" x 32")

A stream with two fords, woods and ruins. Small and quick.

Terrain (full, mirrored): forest (15, 7.5) r3.9; forest (33, 24.5) r3.9; forest (20, 26) r3.9; forest (28, 6) r3.9; ruin (22, 13.4) 4.2x0.6; ruin (26, 18.6) 4.2x0.6; ruin (20.2, 15.6) 0.6x3.2; ruin (27.8, 16.4) 0.6x3.2; rock (13.5, 25) r1.2; rock (34.5, 7) r1.2; rock (27.5, 5.2) r1; rock (20.5, 26.8) r1; river x24 (w 1.6, fords z7/3 z25/3).

Resource sites: (16.5, 19.5), (31.5, 12.5), (20.5, 6.5), (27.5, 25.5). Road control points: [[0,16],[14,12],[34,20],[48,16]].

```
...........~~...........
...........~~^^.........
......^^^..==oo^........
......^^^.$==^^^oo......
.H....^^^..==^^.......H.
.......^...~~...........
..........#~~..$........
..........#~~#..........
.H........#~~#........H.
........$..~~#..........
...........~~...^.......
.H.......^^==..^^^....H.
......oo^^^==$.^^^......
........^oo==..^^^......
.........^^~~...........
...........~~...........
```

#### Twin Rivers (`twinrivers`, 64" x 40")

Two streams split the field in three. Hold the middle ground between them.

Terrain (full, mirrored): forest (12, 8) r3.7; forest (52, 32) r3.7; forest (16, 32) r4.2; forest (48, 8) r4.2; forest (28.5, 20) r4.5; forest (35.5, 20) r4.5; ruin (27, 9) 4.2x0.6; ruin (37, 31) 4.2x0.6; ruin (25.2, 11.2) 0.6x3.2; ruin (38.8, 28.8) 0.6x3.2; rock (18.5, 25.5) r1.1; rock (45.5, 14.5) r1.1; rock (30, 33) r1; rock (34, 7) r1; river x22 (w 1.6, fords z9/3 z29/3); river x42 (w 1.6, fords z31/3 z11/3).

Resource sites: (16.5, 16), (47.5, 24), (27, 27.5), (37, 12.5), (31, 4), (33, 36). Road control points: [[0,20],[20,14],[44,26],[64,20]].

```
..........~~........~~..........
..........~~........~~..........
.....^^...~~...$....~~.^^.......
....^^^^..==....oo..~~^^^^......
....^^^^..==###.....==^^^^......
.H...^^...==#.......==.^^.....H.
..........~~#.....$.==o.........
..........~~........~~oo........
........$.~~.^^^^^^.~~..........
..........~~^^^^^^^^~~..........
.H........~~^^^^^^^^~~........H.
..........~~.^^^^^^.~~..........
........oo~~........~~.$........
.........o==.$.....#~~..........
.......^^.==.......#==...^^.....
.H....^^^^==.....###==..^^^^..H.
......^^^^~~..oo....==..^^^^....
.......^^.~~........~~...^^.....
..........~~....$...~~..........
..........~~........~~..........
```

#### Highland Ruins (`highland`, 64" x 44")

A maze of ruins around a mountain lake. Tight paths, good cover.

Terrain (full, mirrored): forest (14, 6) r5.1; forest (50, 38) r5.1; forest (12, 37) r4.4; forest (52, 7) r4.4; forest (24, 39) r3.9; forest (40, 5) r3.9; ruin (26, 16) 0.6x5; ruin (38, 28) 0.6x5; ruin (28.5, 13.5) 5x0.6; ruin (35.5, 30.5) 5x0.6; ruin (24, 27) 4x0.6; ruin (40, 17) 4x0.6; ruin (19, 20.5) 0.6x4; ruin (45, 23.5) 0.6x4; rock (27, 31) r1.3; rock (37, 13) r1.3; rock (22, 11) r1.2; rock (42, 33) r1.2; lake (32, 22) r3.6.

Resource sites: (17, 29.5), (47, 14.5), (25, 6), (39, 38), (30, 37.5), (34, 6.5). Road control points: [[0,22],[18,30],[46,14],[64,22]].

```
......^^........................
.....^^^^.........^^^^...^^.....
....^^^^^^........^^^^..^^^^....
....^^^^^^..$....$^^^^..^^^^....
.....^^^^...............^^^^....
.H....^^..oo.............^^...H.
.............###..o.............
.......................$........
...................##...........
.........#.....~~...............
.........#....~~~~....#.........
.H.......#....~~~~....#.......H.
...............~~.....#.........
...........##...................
........$.......................
.............o..###.............
.H...^^.............oo..^^....H.
....^^^^...............^^^^.....
....^^^^..^^^^.$......^^^^^^....
....^^^^..^^^^.....$..^^^^^^....
.....^^...^^^^.........^^^^.....
........................^^......
```

#### Great Field (`greatfield`, 80" x 52")

A huge open battlefield with ponds, woods and a long stream. For big armies.

Terrain (full, mirrored): forest (14, 9) r4.8; forest (66, 43) r4.8; forest (24, 41) r5.4; forest (56, 11) r5.4; forest (31, 17) r4.2; forest (49, 35) r4.2; forest (11, 45) r3.9; forest (69, 7) r3.9; lake (21, 27) r2.4; lake (59, 25) r2.4; ruin (33, 32) 4x0.6; ruin (47, 20) 4x0.6; ruin (30, 6) 0.6x3.6; ruin (50, 46) 0.6x3.6; rock (18, 34) r1.2; rock (62, 18) r1.2; rock (36, 12) r1; rock (44, 40) r1; river x40 (w 1.6, fords z8/3 z26/3.4 z44/3).

Resource sites: (20, 17), (60, 35), (30, 45), (50, 7), (34, 24), (46, 28), (26, 4), (54, 48). Road control points: [[0,26],[24,16],[56,36],[80,26]].

```
...................~~...................
...................~~...................
......^^.....$.....~~............^^^....
.....^^^^..........==....$^^^^...^^^....
.....^^^^..........==....^^^^^^..^^^....
.....^^^^........oo~~....^^^^^^.........
.H....^^.......^.oo~~....^^^^^^.......H.
..............^^^..~~.....^^^^..........
..........$..^^^^^.~~.........oo........
..............^^^..~~.........oo........
...............^...~~...................
...................~~.......~~~.........
.........~~~.....$.==.......~~~.........
.H.......~~~.......==.......~~~.......H.
.........~~~.......~~..$................
...................~~...^...............
........oo.........~~..^^^..............
........oo.........~~.^^^^^...$.........
..........^^^^.....~~..^^^..............
.........^^^^^^....~~oo.^.......^^......
.H.......^^^^^^....~~oo........^^^^...H.
....^^^..^^^^^^....==..........^^^^.....
....^^^...^^^^.$...==..........^^^^.....
....^^^............~~...........^^......
...................~~......$............
...................~~...................
```

Deployment (player 0; player 1 mirrored), relative to the chosen HQ spot z: hero x 9.5, z +0; fighter (kingdom only) x 12.5, z +2.5; builder (kingdom only) x 7, z +3.2; swarm (undead only) x 12.5, z +0. Each squad gets a seeded jitter of up to +-0.8" (builders none), then is nudged clear of terrain and other squads.
<!-- /GEN:maps -->

Legend for the sketches (1 character = 2″): `.` open ground, `^` forest, `#` ruin, `o` rock,
`~` water (stream or lake), `=` ford, `$` resource site, `H` possible HQ spot (left = player 0).

---

## 14. AI (`js/ai/`)

The AI is rebuilt after the AIs of real RTS games (§20): **layered managers** with a clear chain of
command, run once per round from its own side's view only. Entry point `aiOrders(s, p, memory, opts)` in
`js/ai/ai.js` (`opts.level`, `opts.personality`); everything random is seeded from the game seed, the
round and the side, so the same game gives the same orders. The old AI is kept unchanged in
`js/ai/legacy.js` as a benchmark (`node tools/balance.mjs --vs legacy`).

Each round, in this order:
1. **Perception** (`perception.js`) → what it knows.
2. **Learning** (`learning.js`) → how its squad types really traded since last round.
3. **Influence maps** (`influence.js`) → own strength and enemy threat over the board.
4. **Strategy** (`strategy.js`) → a posture: build, attack, defend or harass.
5. **Economy and production** (`economy.js`) → builders, buildings, research, training, through one queue manager.
6. **Military** (`military.js`) → a task for every army squad.
7. **Tactics** (`tactics.js`) → stances, target points and hand orders with micro.

### 14.1 Perception: what it knows (fog of war)
- **Enemy squads:** the ones its side sees now (`visibleTo`), plus snapshots of the ones it saw in the
  last `memory` rounds (Easy 2, Normal 3, Hard / Brutal 4), at their last seen spot. A squad is forgotten
  when it dies or after that many rounds. **Easy reacts late:** it plans from last round's picture.
- **Enemy buildings:** its side's intel (§12); the enemy HQ once seen, else the HQ spots it hasn't seen yet.
- **Threats:** known enemy squads within 13″ of its HQ or 9″ of its other buildings (walls excluded).
- **Enemy tier:** 2 once an elite (gated) squad or a tier-2 HQ has been seen.

### 14.2 Combat prediction (`combat.js`, Lanchester's square law)
- **Damage per round** of a squad against armour A: `(100 / max(10, attack AP)) × damageAfter(dmg × models (× 1.15 for strikes), A)`,
  × 1.5 for casters (spells).
- **Strength of a group** against another: its total damage per round (against the other group's average
  armour) × its total HP (× (1 + 0.15 × defends)). A building with fire adds `4 × damageAfter(fire dmg)`
  damage and half its HP.
- **Ratio** = strength(A) / strength(B); no enemies → 99.
- **Squad power** (for the influence maps) = √(damage per round against armour 5 × HP).

### 14.3 Influence maps (`influence.js`)
- **Grid:** 2″ cells.
- **Own map:** every army squad adds its power, falling off linearly to 0 at 9″; own buildings with fire add 12 over their fire range.
- **Threat map:** the same for known enemy squads, and known finished enemy buildings with fire (12 over range + 1″).
- **Balance:** own − threat.
- **Used for:**
  - the safest staging spot;
  - target choice (value ÷ defence);
  - whether a revive zone is safe;
  - whether a raid or scout should pull back;
  - site placement (threatened sites score lower).

### 14.4 Learning from combat outcomes (`learning.js`)
- **Each round it compares with last round:**
  - **Own losses:** HP each own squad lost, credited to its role as **taken**.
  - **Enemy losses:** HP each enemy squad it watched lost, credited as **dealt** to its own squads that were within reach of it. Reach = weapon range + 4″ for shooters, 7″ for melee. The credit is split by their damage per round.
- **Trade ratio of a role:** (dealt + 150) / (taken + 150), divided by the side's overall ratio.
- **Value multiplier:** that ratio, clamped to 0.4–1.6, raised to the skill's `adapt` (§14.10).
- **What it is for:** the paper value misses things like area attacks hitting several squads at once, so a role that trades badly in this game gets picked less.

### 14.5 Strategy: postures (`strategy.js`)
- **Believed enemy army:** what it sees, but never fewer than 70 % of the most enemy squads it has seen
  at once (that peak decays 3 % a round).
- **Two ratios:**
  - **ratio** = own army vs that believed army;
  - **attack ratio** = own army vs that believed army plus the enemy base's guns (known finished buildings with fire within 12″ of the known enemy HQ, or an unseen HQ at full HP).
- **Utilities** (P = personality, §14.9):
  - **build:** 0.55 + 0.3 × greed + 0.2 × tech.
  - **defend** (any non-builder threat, §14.1): 0.6 + 1.5 × min(2, ratio of the threats vs its squads within 16″ of its HQ).
  - **attack** (from the personality's first-attack round and army size): aggression × min(2.2, attack ratio / (attackRatio + skill edge)), + 0.4 with 18+ squads, + 0.3 from round 30.
  - **harass** (it has a fast squad and knows an enemy Mine / Well / Farm): 0.45 × aggression + 0.1.
- **Choice:** the highest utility wins. **Hysteresis:** the current posture stays unless the best beats it by 0.15. Defend always wins.

### 14.6 Military: a task per army squad (`military.js`)
Squads are given tasks in this order; each squad gets one:
1. **Revive:** if its hero is down and the zone's threat < own strength there + 10, the 2 nearest squads advance to the zone.
2. **Defense manager:** when threats exist, the squads nearest to the threats' centre are added one by
   one until the predicted ratio against the threats is ≥ 1.4. They advance to that centre.
3. **Scouting:**
   - **When:** while the enemy HQ is unknown (from round 2, with 3+ squads), and every round(14 / scout) rounds from round 8.
   - **Who:** one squad (not the hero, not a caster); the fastest, then the weakest.
   - **Where:** the nearest unseen HQ spot; once the HQ is known, the nearest resource site on the enemy's half.
   - **Danger:** it switches to Retreat when the threat where it stands is more than 2 × its power.
4. **Raids** (posture harass or attack):
   - **Who:** each fast squad.
   - **Target:** the known enemy Mine / Well / Farm with the best score: value (3 / 3 / 2.5) − threat there ÷ its power − 0.04 × distance. It needs a score ≥ 0.5.
   - **Danger:** it switches to Retreat when the threat where it stands is more than 2.2 × its power.
5. **The main army and its attack plan:**
   - **Target:** the known enemy building with the best `value / (1 + threat/40) − 0.015 × distance from home`. Value: HQ 3 (×2 below half HP), Well / Mine 3, Farm 2.5, Barracks and tech buildings 2, Monolith 1.8, Banner 1.2, Tower 1, wall 0.2. With no buildings known: the nearest unseen HQ spot. It re-picks every round except while attacking (then only when the target is gone, or a guessed spot turns out empty / real buildings appear).
   - **Staging point:** 35 % of the way from home to the target, moved to the spot with the best influence balance within 3″, then to clear ground.
     - **The Undead stage on their own graves:** the grave point closest to that spot, 1.5″ inside the edge, so deaths there pay souls and Monoliths heal.
   - **States:**
     - **build:** everyone advances to the staging point.
     - **gather:** starts when the posture becomes attack. It is called off only by defend, or by build with the attack ratio below 0.8 × the wanted ratio. It **launches** when ≥ 70 % of the main army is within 6″ of the staging point, or after 4 rounds (2+ squads).
     - **attack:** everyone advances on the target (fighting what it meets, §4).
     - **retreat:** when the enemies within 13″ of the army's centre (plus known towers / HQ there) give a ratio < 0.7, or fewer than 40 % of the launched squads remain. It falls back to the nearest healing building (Monolith, Chapel with Field Hospital), else home. After 2 rounds (or once everyone is within 12″ of home) → build, with a new target.
   - **Posture defend:** squads not attacking or retreating gather just in front of the HQ.

### 14.7 Tactics: orders and command points (`tactics.js`)
- **Every army squad:** its task becomes a stance + target point, as a player would set them: Advance with a goal (re-sent when it moves more than 1.5″), or Retreat.
- **Hand orders** (command points):
  - **Who:** squads that can reach a visible enemy this round (speed in inches + weapon range or 2″ + 1″).
  - **Ranking:** badly hurt (< 35 % HP) +3; a shooter with a melee enemy within 3″ +2.5 (when it kites); + power / 20.
  - **Limit:** the hero is free; the rest take `3 + banners` points, exactly like a player. Builders work through the economy.
- **Micro for each hand-ordered squad:**
  - **Mistakes:** a seeded "sloppy" roll (Easy 30 %, Normal 8 %, Hard 0 %) makes it fight the nearest enemy plainly.
  - **Focus fire** (not Easy):
    - **Score of each target:** 2 × min(1, its damage / the target's HP left after damage already assigned this round) + the target's damage against it / 30 − 0.05 × distance.
    - **No overkill:** targets already fully covered score −1.
    - **Shared:** the damage it assigns is added for the next squads.
  - **Pull back:** a non-hero squad below 35 % HP whose local fight (enemies within 8″) predicts < 0.8 walks up to 60 AP back toward its side and spends the rest on defends.
  - **Skills:** parry when engaged (if it has one), then `autoSkills` (charges, leaps, spells, summons, as for stance squads).
  - **Shooters:**
    - **Kite (Hard / Brutal):** with a melee enemy within 2.6″ and not locked in, step 3″ away first (up to 35 AP).
    - **Close in:** when beyond 0.95 × range or the line is blocked, walk up to 45 AP to 0.8 × range (0.45 × when blocked); if a cover spot within 2.5″ of that end still has the target in range, it ends there instead (§5.10).
    - **Shoot:** volley with the rest.
  - **Melee:** `meleePlan`: Strikes at the focus-fire target (by id, so they lunge if it steps away, §5.2).
  - **Aim lead** (Normal and up): + 0.5 × the target's last movement.
  - **Leftover AP:** defends.

### 14.8 Economy and production: the queue manager (`economy.js`)
**Builders:**
- A builder already working on a site (or repairing) keeps at it. A new building is placed only with a free builder to spare (one site under way per builder).
- A new building needs a free side to work from (`approachSpot` from the HQ's direction); walls excepted. This avoids sites squeezed in between buildings.
- Unfinished sites and buildings below 70 % HP with no builder assigned get the nearest free builder.
- Buildings are placed on candidate spots around its own buildings, by a preference per type:
  - forward for towers and Monoliths;
  - to the side for farms and tech buildings;
  - beside the HQ for the first Barracks.
- The Undead reach a resource site by placing Bone Fences on the grave edge closest to it.

**Requests:** every need becomes a request with a priority and a cost.

| Request | Priority |
|---|---|
| First Barracks / Ossuary (the Undead need a Soul Well first; cost saved from the start) | 135 (100 if threatened) |
| First Mine / Soul Well (cost saved meanwhile) | 125 (98 if threatened) |
| Undead: a Bone Fence toward that site while it isn't on graves | 120 |
| More sites, up to 1 + floor(2 × greed + round / 14) Mines, or wells + floor(round / 16) Soul Wells | 55 + 30 × greed |
| Kingdom first Farm | 120 (90 if threatened) |
| More Farms, up to min(8, farms + floor(round / 12)) | 45 + 40 × greed |
| Peasants (one at a time), up to min(10, max(2, min(1 + 3 × farms + 2 × mines, peasants + round / 6))) | 60 + 30 × greed (−25 if threatened) |
| Walls when threatened, up to 2 + 2 × defense | 70 |
| Towers from round 4, up to 1 + 2 × defense + round / 20 | 25 + 45 × defense (+20 if threatened) |
| Kingdom Banners from round 5 | 35 |
| Undead Monoliths from round 4, up to monoliths + floor(round / 10) | 35 + 35 × defense |
| Undead grave creep toward the enemy (defense > 0.5, round ≥ 6) | 20 + 20 × defense |
| More Barracks while resource ≥ 70, up to 1 + floor(round / 8) | 50 (118 when resource ≥ 150) |
| Tier 2 (from round 5) | 52 + 40 × tech (+15 from round 12) |
| Tier 3 (healthy, round ≥ 12) | 35 + 40 × tech |
| Tech buildings once Tier 2 is done (the second from round 12) | 40 + 40 × tech (−10 for the second) |
| Research per idle HQ / tech building (healthy, round ≥ 6): the first allowed item of the personality's list | 20 + 35 × tech (−10 at the HQ, −10 at war) |
| Army: one squad per idle training building | 60 + 30 × aggression (+25 at war, +30 when under 4 squads and threatened or past round 5, +20 if threatened) |

- **Research before training:** research at a building goes ahead of that building's army request (priority 140 +) when the army is healthy and the bank covers its cost + 15.
- **Healthy** means:
  - 4+ squads;
  - a strategy ratio ≥ 0.9;
  - at least 70 % as many squads as the known enemy squads.
- **Funding:**
  - Requests are paid in priority order from the resource, one new item per building a round.
  - A ready request of priority ≥ 70 (not army; tech only when healthy) that can't be paid **holds its cost back** for the rest (saving), once.
  - During the first 8 rounds, the first site and first Barracks keep their cost saved even before they can be placed, so the opening isn't spent on squads.
- **Unit choice:**
  - **Value of each trainable, ungated role** = matchup value × personality mix × learned multiplier (§14.4).
    - **Matchup value:** Σ over the enemy roles of weight × e^(1.6 × matchup score).
    - **Weights:** a blend of what it has seen (× `adapt`) and everything the enemy can train at its known tier.
    - **Matchup scores:** from the combat simulator's table `js/ai/matchups.js`.
  - **Diversity:** a role above 45 % of the army is worth × 0.6; casters beyond 1 per 5 squads × 0.3.
  - **Skipping a building:** a building whose best option is under half the best option of any building skips training (to free it for research). This doesn't apply when threatened, when under 4 squads, or with 120+ in the bank.
  - **The army cap** is respected (pairs count as 2).

**The combat simulator (`tools/matchups.mjs`, `npm run matchups`):**
- **The duels:** for every pair of trainable squad types (all faction pairs), equal-cost groups (about 100 resource a side; Warband pairs count per squad) fight in an open arena. They start 9″ apart, are played by the AI's own tactics for up to 20 rounds, and repeat over 4 seeds with sides swapped.
- **Score:** A's share of HP left − B's share (−1 … 1).
- **When to rerun:** after changing unit stats or costs.

### 14.9 Personalities (`js/ai/personalities.js`)
- **Pick:** a random (seeded) personality each game, or the one chosen in Battle setup. It is named on the top bar ("vs AI · Normal · Warlord").
- **Weights:** aggression, greed, tech, defense (0–1); `attackRatio` (wanted attack ratio); first attack (round, army); `mix` (role multipliers); farms / peasants or wells / monoliths; research order per building (with its doctrine picks); tech-building order.

| Faction | Personality | Aggr. | Greed | Tech | Def. | Attack ratio | First attack | Plan |
|---|---|---|---|---|---|---|---|---|
| Kingdom | Warlord | 0.85 | 0.35 | 0.4 | 0.2 | 1.05 | round 6, 4 squads | Men-at-arms and Outriders, Knightly Order, Crusade |
| Kingdom | Steward | 0.4 | 0.9 | 0.5 | 0.6 | 1.35 | round 13, 8 | 5 farms, 10 peasants, crossbows, Free Yeomanry, Fortress Realm |
| Kingdom | Smith-King | 0.6 | 0.55 | 0.95 | 0.4 | 1.2 | round 10, 6 | Blacksmith first, Shieldwall, Knightly, Crusade |
| Undead | Bone Tide | 0.9 | 0.35 | 0.4 | 0.15 | 1.0 | round 5, 5 | swarm, Bone Tide, Endless Swarm |
| Undead | Necrarch | 0.6 | 0.5 | 0.9 | 0.35 | 1.2 | round 9, 6 | Necromancers (mix 1.6), Dark Arts, Endless Horde |
| Undead | Blight Lord | 0.45 | 0.75 | 0.6 | 0.7 | 1.3 | round 11, 8 | 3 wells, 4 Monoliths, grave creep, Plague of Graves |

### 14.10 Difficulty (`SKILL` in `js/ai/personalities.js`)
Easy, Normal and Hard change **skill only**: the AI has the same income and command points as the
player. **Brutal** plays like Hard and **cheats**: +30 % income (`BRUTAL_INCOME`, set by `js/main.js`
as the AI side's `incomeMult`). Online games never use these.

| | Easy | Normal | Hard | Brutal |
|---|---|---|---|---|
| Reaction (`delay`) | 1 round late | now | now | now |
| Memory of unseen enemies | 2 rounds | 3 | 4 | 4 |
| Focus fire | no | yes | yes | yes |
| Kiting | no | no | yes | yes |
| Aim lead | no | yes | yes | yes |
| Counters and learning (`adapt`) | 0 (personality only) | 0.6 | 1 | 1 |
| Scouting (`scout`; re-scout every 14 / scout rounds) | 0.4 (35) | 0.8 (18) | 1 (14) | 1 |
| Attack ratio edge (`edge`, added to the wanted ratio) | +0.35 | +0.1 | 0 | 0 |
| Seeded mistakes (`mistake`) | 30 % | 8 % | 0 | 0 |
| Income | ×1 | ×1 | ×1 | **×1.3** |

---

## 15. Online (balance-relevant only)
Host = player 0 (left), guest = player 1. Both pick armies (mirror allowed; the second army is
repainted). The host picks the map and a planning timer (off / 60 / 90 / 120 s; when it runs out the
current draft is sent; a guest that does not answer within 8 s after the deadline plays with no
orders). The host resolves each round; the guest replays the same orders locally and adopts the host's
state. Income multiplier is 1 for both.

---

## 16. Balance status

<!-- BALANCE -->
_Latest run: 2026-11-24, after **Dawn of War style cover** (walk-in ruins, walls, forests; squads seek
cover), **×2 HP** for units and buildings, footprint-exact hits on buildings, own buildings never blocking
own shots, own squads pushed by new sites, and the stuck-squad fixes; AI matchup table regenerated.
`node tools/balance.mjs --games 8` (16 games per map, both sides the new AI at Normal, random
personalities; 100-round cap) and `node tools/balance.mjs --vs legacy --games 8`._

**Faction balance, new AI vs new AI:**

| Map | Kingdom wins | Undead wins | Unfinished | Rounds (avg / median / min / max) | How games ended |
|---|---|---|---|---|---|
| Crossing | 13 (81 %) | 3 (19 %) | 0 | 48.3 / 49 / 38 / 63 | HQ destroyed 16 |
| Twin Rivers | 16 (100 %) | 0 (0 %) | 0 | 47.1 / 45 / 38 / 63 | HQ 16 |
| Highland Ruins | 16 (100 %) | 0 (0 %) | 0 | 45.1 / 47 / 32 / 65 | HQ 16 |
| Great Field | 16 (100 %) | 0 (0 %) | 0 | 52.9 / 53 / 38 / 81 | HQ 16 |
| **All** | **61 (95 %)** | **3 (5 %)** | **0 of 64** | | |

**The new AI against the old AI:** as Kingdom 64 / 64 (100 %), as Undead **51 / 64 (80 %)**. That is
Crossing 15/16, Twin Rivers 13/16, Highland 11/16 and Great Field 12/16: the first time both factions are
over the 70 % target.

**What the numbers say (2026-11-24):**
- **Mirror balance swung back to the Kingdom:** 53 / 9 → **61 / 3**.
  - **Crossbows love cover.** They stand in ruins and forests and pick firing spots in cover: 6240 damage dealt a game for 650 taken on Crossing.
  - **×2 HP slows the death economy.** Fewer squads die per round, so fewer souls (Crossing 1080 a game, the big maps 765). Cheap Warbands still die in droves: 33 lost a game, dealing an eighth of what they take.
- **Games still finish:** 0 unfinished of 64; 45–53 rounds on average.
- **Stuck squads:** 6.5 % → 1.7 % of walks (`node tools/stuck.mjs`); squads stuck 3+ rounds in a row 171 → 1.
- **Open for the owner:**
  - Undead economy (souls per death or flat souls, now that HP doubled);
  - Crossbows (strength, or how much light / heavy cover helps them);
  - Warband stats (stats only);
  - the Tier 2 locks.

<details><summary>Full report, new AI vs new AI (per faction: buildings finished, squads trained, income, gathering, souls, HQ found, per unit type damage dealt / taken / models lost / squads lost)</summary>

```
Balance report 2026-11-24 · 8 seeds x 2 orders per map · AI normal · stop at round 100

## crossing: 16 games · Kingdom 13 (81% of decided) · Undead 3 (19%) · draws 0 · unfinished 0
   personalities (new AI): warlord 5/5, blightlord 2/6, bonetide 1/5, smithking 6/6, necrarch 0/5, steward 2/5
   rounds (decided): avg 48.3, median 49, min 38, max 63 · ends: {"hq destroyed":16}
   kingdom: built/game {"barracks":1.8,"mine":3.2,"farm":1.9,"banner":1.1,"wall":1.1,"tower":1.4,"chapel":0.4,"forge":0.4} · trained/game {"builder":7.9,"fighter":6,"ranged":16.1,"fast":0.4}
      income/game 966.3 · gathered/game 390.1 · souls/game 0.0 · found enemy HQ in 14/16 games, avg round 23.6
      per unit type (per game): builder dealt 0.0 taken 230.8 models lost 6.8 squads lost 3.2 trained 7.9 | fast dealt 176.2 taken 52.2 models lost 0.9 squads lost 0.2 trained 0.4 | fighter dealt 1161.9 taken 851.3 models lost 20.3 squads lost 4.6 trained 6.0 | hero dealt 610.6 taken 260.5 models lost 0.9 squads lost 0.9 trained 0.0 | ranged dealt 6239.0 taken 650.7 models lost 19.4 squads lost 3.9 trained 16.1
   undead: built/game {"wall":6.2,"well":4.1,"barracks":1.5,"pit":0.6,"monolith":0.8,"sanctum":0.5,"tower":1.9} · trained/game {"swarm":33.4,"summon":5.5,"ranged":15,"mage":2.3,"fighter":0.6}
      income/game 149.6 · gathered/game 0.0 · souls/game 1083.9 · found enemy HQ in 4/16 games, avg round 30.3
      per unit type (per game): fighter dealt 13.5 taken 57.3 models lost 2.8 squads lost 0.6 trained 0.6 | hero dealt 293.9 taken 176.3 models lost 0.9 squads lost 0.9 trained 0.0 | mage dealt 111.4 taken 81.1 models lost 3.5 squads lost 1.8 trained 2.3 | ranged dealt 2189.1 taken 1107.4 models lost 50.7 squads lost 12.1 trained 15.0 | summon dealt 74.7 taken 221.9 models lost 22.8 squads lost 3.6 trained 5.5 | swarm dealt 238.9 taken 2029.3 models lost 204.3 squads lost 33.4 trained 33.4

## twinrivers: 16 games · Kingdom 16 (100% of decided) · Undead 0 (0%) · draws 0 · unfinished 0
   personalities (new AI): warlord 5/5, blightlord 0/6, bonetide 0/5, smithking 6/6, necrarch 0/5, steward 5/5
   rounds (decided): avg 47.1, median 45, min 38, max 63 · ends: {"hq destroyed":16}
   kingdom: built/game {"barracks":1.7,"mine":3.8,"farm":1.9,"banner":1.2,"tower":2,"wall":1,"forge":0.6,"chapel":0.5} · trained/game {"builder":8.9,"fighter":4.6,"ranged":17.8,"fast":0.4}
      income/game 1219.3 · gathered/game 370.6 · souls/game 0.0 · found enemy HQ in 16/16 games, avg round 33.3
      per unit type (per game): builder dealt 0.5 taken 120.1 models lost 2.8 squads lost 1.1 trained 8.9 | fast dealt 142.8 taken 31.5 models lost 0.6 squads lost 0.1 trained 0.4 | fighter dealt 1172.9 taken 655.6 models lost 14.9 squads lost 2.6 trained 4.6 | hero dealt 1065.3 taken 220.8 models lost 0.6 squads lost 0.6 trained 0.0 | ranged dealt 4965.2 taken 219.5 models lost 5.8 squads lost 0.7 trained 17.8
   undead: built/game {"wall":7.6,"well":1.9,"barracks":1.1,"tower":1.1,"pit":0.3,"monolith":0.5,"sanctum":0.1} · trained/game {"swarm":32,"summon":4.6,"ranged":9.7,"mage":1.1,"fighter":1.2}
      income/game 116.8 · gathered/game 0.0 · souls/game 764.8 · found enemy HQ in 2/16 games, avg round 16.5
      per unit type (per game): fighter dealt 24.7 taken 119.0 models lost 5.9 squads lost 1.2 trained 1.2 | hero dealt 195.1 taken 185.3 models lost 1.0 squads lost 1.0 trained 0.0 | mage dealt 61.8 taken 47.7 models lost 2.1 squads lost 1.0 trained 1.1 | ranged dealt 921.3 taken 793.7 models lost 36.8 squads lost 9.1 trained 9.7 | summon dealt 61.3 taken 189.9 models lost 19.3 squads lost 3.3 trained 4.6 | swarm dealt 209.6 taken 1938.8 models lost 202.3 squads lost 33.4 trained 32.0

## highland: 16 games · Kingdom 16 (100% of decided) · Undead 0 (0%) · draws 0 · unfinished 0
   personalities (new AI): warlord 5/5, blightlord 0/6, bonetide 0/5, smithking 6/6, necrarch 0/5, steward 5/5
   rounds (decided): avg 45.1, median 47, min 32, max 65 · ends: {"hq destroyed":16}
   kingdom: built/game {"barracks":1.8,"mine":3.5,"farm":2.1,"banner":1.1,"chapel":0.3,"tower":2,"forge":0.4,"wall":0.9} · trained/game {"builder":9.1,"fighter":3.9,"ranged":15.8,"fast":0.3}
      income/game 1050.6 · gathered/game 310.1 · souls/game 0.0 · found enemy HQ in 16/16 games, avg round 29.9
      per unit type (per game): builder dealt 0.2 taken 74.6 models lost 2.1 squads lost 0.8 trained 9.1 | fast dealt 85.7 taken 19.9 models lost 0.4 squads lost 0.1 trained 0.3 | fighter dealt 965.6 taken 393.5 models lost 9.1 squads lost 1.8 trained 3.9 | hero dealt 785.8 taken 205.6 models lost 0.5 squads lost 0.5 trained 0.0 | ranged dealt 4148.3 taken 219.1 models lost 5.6 squads lost 0.7 trained 15.8
   undead: built/game {"wall":6.9,"monolith":1,"well":2.4,"barracks":1,"pit":0.3,"tower":0.8,"sanctum":0.1} · trained/game {"swarm":25.1,"summon":4.4,"ranged":7.3,"fighter":0.6,"mage":1.3}
      income/game 111.4 · gathered/game 0.0 · souls/game 568.2 · found enemy HQ in 2/16 games, avg round 16.5
      per unit type (per game): fighter dealt 4.8 taken 62.7 models lost 3.1 squads lost 0.6 trained 0.6 | hero dealt 224.7 taken 191.1 models lost 1.0 squads lost 1.0 trained 0.0 | mage dealt 29.6 taken 62.4 models lost 2.7 squads lost 1.3 trained 1.3 | ranged dealt 675.6 taken 583.4 models lost 26.3 squads lost 6.3 trained 7.3 | summon dealt 38.7 taken 193.4 models lost 20.6 squads lost 3.2 trained 4.4 | swarm dealt 137.5 taken 1523.1 models lost 162.6 squads lost 27.0 trained 25.1

## greatfield: 16 games · Kingdom 16 (100% of decided) · Undead 0 (0%) · draws 0 · unfinished 0
   personalities (new AI): warlord 5/5, blightlord 0/6, bonetide 0/5, smithking 6/6, necrarch 0/5, steward 5/5
   rounds (decided): avg 52.9, median 53, min 38, max 81 · ends: {"hq destroyed":16}
   kingdom: built/game {"barracks":1.8,"mine":5.1,"farm":2.2,"banner":0.9,"tower":2.7,"forge":0.5,"chapel":0.3,"wall":0.8} · trained/game {"builder":8.8,"fighter":6,"ranged":18.9,"fast":0.4}
      income/game 1485.1 · gathered/game 306.5 · souls/game 0.0 · found enemy HQ in 16/16 games, avg round 34.6
      per unit type (per game): builder dealt 0.3 taken 41.9 models lost 0.9 squads lost 0.4 trained 8.8 | fast dealt 116.9 taken 40.6 models lost 0.8 squads lost 0.2 trained 0.4 | fighter dealt 1369.4 taken 656.9 models lost 15.0 squads lost 2.9 trained 6.0 | hero dealt 595.8 taken 209.0 models lost 0.7 squads lost 0.7 trained 0.0 | ranged dealt 4833.3 taken 239.8 models lost 6.8 squads lost 1.1 trained 18.9
   undead: built/game {"wall":8.6,"well":2.7,"barracks":0.9,"monolith":0.6,"sanctum":0.2,"pit":0.2,"tower":0.6} · trained/game {"swarm":29.6,"summon":4.8,"ranged":9.1,"fighter":0.8,"mage":1.4}
      income/game 120.1 · gathered/game 0.0 · souls/game 649.4 · found enemy HQ in 6/16 games, avg round 23.2
      per unit type (per game): fighter dealt 7.5 taken 74.1 models lost 3.8 squads lost 0.8 trained 0.8 | hero dealt 198.7 taken 185.6 models lost 1.0 squads lost 1.0 trained 0.0 | mage dealt 66.0 taken 65.1 models lost 2.8 squads lost 1.4 trained 1.4 | ranged dealt 867.8 taken 778.9 models lost 35.8 squads lost 8.8 trained 9.1 | summon dealt 78.0 taken 194.4 models lost 20.2 squads lost 3.3 trained 4.8 | swarm dealt 200.0 taken 1769.1 models lost 188.5 squads lost 31.3 trained 29.6
```
</details>

<details><summary>Full report, new AI vs the legacy AI</summary>

```
Balance report 2026-11-24 · 8 seeds x 2 orders per map x 2 (new AI on each side vs the legacy AI) · AI normal · stop at round 100

## crossing: 32 games · Kingdom 17 (53% of decided) · Undead 15 (47%) · draws 0 · unfinished 0
   new AI vs legacy: as kingdom 16/16 (100%) · as undead 15/16 (94%)
   personalities (new AI): warlord 5/5, blightlord 6/6, bonetide 4/5, smithking 6/6, necrarch 5/5, steward 5/5
   rounds (decided): avg 43.3, median 43, min 29, max 63 · ends: {"hq destroyed":32}
   kingdom: built/game {"barracks":1.7,"mine":2.1,"farm":2.1,"banner":1.4,"wall":1.2,"chapel":0.1,"tower":1.4,"forge":0.2} · trained/game {"builder":9.2,"fighter":8.5,"ranged":8.2}
      income/game 627.8 · gathered/game 313.3 · souls/game 0.0 · found enemy HQ in 30/32 games, avg round 17.5
      per unit type (per game): builder dealt 0.6 taken 442.8 models lost 14.2 squads lost 6.9 trained 9.2 | fighter dealt 1724.5 taken 1116.8 models lost 26.4 squads lost 6.0 trained 8.5 | hero dealt 1012.5 taken 225.3 models lost 0.7 squads lost 0.7 trained 0.0 | ranged dealt 2304.3 taken 251.7 models lost 7.9 squads lost 1.9 trained 8.2
   undead: built/game {"wall":5.8,"well":3,"barracks":1.5,"tower":2.3,"monolith":2.3,"pit":0.6,"sanctum":0.3} · trained/game {"swarm":32.6,"summon":12.1,"fighter":1.7,"mage":2.8,"tank":0.6,"fast":1.2,"ranged":7.3}
      income/game 177.2 · gathered/game 0.0 · souls/game 753.0 · found enemy HQ in 22/32 games, avg round 24.5
      per unit type (per game): fast dealt 16.5 taken 104.9 models lost 3.5 squads lost 1.2 trained 1.2 | fighter dealt 49.3 taken 167.8 models lost 8.4 squads lost 1.7 trained 1.7 | hero dealt 283.2 taken 154.5 models lost 0.8 squads lost 0.8 trained 0.0 | mage dealt 223.3 taken 70.8 models lost 2.8 squads lost 1.4 trained 2.8 | ranged dealt 2262.4 taken 136.3 models lost 5.5 squads lost 0.9 trained 7.3 | summon dealt 178.6 taken 284.1 models lost 29.8 squads lost 4.6 trained 12.1 | swarm dealt 550.1 taken 1748.4 models lost 180.3 squads lost 28.7 trained 32.6 | tank dealt 15.7 taken 83.0 models lost 1.9 squads lost 0.6 trained 0.6

## twinrivers: 32 games · Kingdom 19 (59% of decided) · Undead 13 (41%) · draws 0 · unfinished 0
   new AI vs legacy: as kingdom 16/16 (100%) · as undead 13/16 (81%)
   personalities (new AI): warlord 5/5, blightlord 5/6, bonetide 4/5, smithking 6/6, necrarch 4/5, steward 5/5
   rounds (decided): avg 46.4, median 45, min 14, max 76 · ends: {"hq destroyed":32}
   kingdom: built/game {"barracks":1.7,"mine":3,"farm":2.3,"banner":1.3,"tower":1.8,"wall":1.1,"forge":0.3,"chapel":0} · trained/game {"builder":9.4,"fighter":9.7,"ranged":8.5,"fast":1.2,"tank":0.4}
      income/game 811.4 · gathered/game 325.1 · souls/game 0.0 · found enemy HQ in 29/32 games, avg round 20.9
      per unit type (per game): builder dealt 0.3 taken 371.3 models lost 11.7 squads lost 5.8 trained 9.4 | fast dealt 104.1 taken 175.0 models lost 3.6 squads lost 1.2 trained 1.2 | fighter dealt 1207.6 taken 1235.2 models lost 29.6 squads lost 7.1 trained 9.7 | hero dealt 734.4 taken 148.4 models lost 0.4 squads lost 0.4 trained 0.0 | ranged dealt 1379.2 taken 382.5 models lost 12.3 squads lost 3.1 trained 8.5 | tank dealt 9.8 taken 83.8 models lost 1.2 squads lost 0.4 trained 0.4
   undead: built/game {"wall":5.3,"well":2.6,"barracks":1.3,"tower":1.5,"monolith":1.8,"pit":0.4,"sanctum":0.3} · trained/game {"swarm":23.8,"fighter":1.8,"summon":13.6,"mage":2.2,"tank":0.1,"fast":0.3,"ranged":8}
      income/game 191.5 · gathered/game 0.0 · souls/game 538.9 · found enemy HQ in 14/32 games, avg round 49.6
      per unit type (per game): fast dealt 1.1 taken 20.5 models lost 0.7 squads lost 0.2 trained 0.3 | fighter dealt 51.0 taken 164.5 models lost 8.4 squads lost 1.7 trained 1.8 | hero dealt 272.8 taken 131.1 models lost 0.6 squads lost 0.6 trained 0.0 | mage dealt 254.6 taken 26.3 models lost 0.9 squads lost 0.4 trained 2.2 | ranged dealt 2903.1 taken 133.8 models lost 5.0 squads lost 0.6 trained 8.0 | summon dealt 152.8 taken 286.7 models lost 28.1 squads lost 4.3 trained 13.6 | swarm dealt 347.3 taken 1306.8 models lost 134.6 squads lost 21.1 trained 23.8 | tank dealt 0.2 taken 16.5 models lost 0.4 squads lost 0.1 trained 0.1

## highland: 32 games · Kingdom 21 (66% of decided) · Undead 11 (34%) · draws 0 · unfinished 0
   new AI vs legacy: as kingdom 16/16 (100%) · as undead 11/16 (69%)
   personalities (new AI): warlord 5/5, blightlord 4/6, bonetide 3/5, smithking 6/6, necrarch 4/5, steward 5/5
   rounds (decided): avg 46.1, median 44, min 14, max 83 · ends: {"hq destroyed":32}
   kingdom: built/game {"barracks":1.6,"mine":2.6,"farm":2.1,"banner":1.4,"wall":0.9,"tower":1.7,"forge":0.2,"chapel":0.1} · trained/game {"builder":9.4,"fighter":9.2,"ranged":8.9,"fast":0.8,"tank":0.1}
      income/game 803.3 · gathered/game 301.1 · souls/game 0.0 · found enemy HQ in 30/32 games, avg round 21.1
      per unit type (per game): builder dealt 0.3 taken 369.0 models lost 11.8 squads lost 5.8 trained 9.4 | fast dealt 107.3 taken 92.8 models lost 1.9 squads lost 0.6 trained 0.8 | fighter dealt 1494.3 taken 1083.9 models lost 25.6 squads lost 5.8 trained 9.2 | hero dealt 842.7 taken 134.9 models lost 0.3 squads lost 0.3 trained 0.0 | ranged dealt 1714.9 taken 350.4 models lost 11.3 squads lost 2.8 trained 8.9 | tank dealt 7.0 taken 25.8 models lost 0.4 squads lost 0.1 trained 0.1
   undead: built/game {"wall":5.8,"well":2.6,"barracks":1.4,"monolith":2.5,"tower":2,"pit":0.3,"sanctum":0.3} · trained/game {"swarm":24.9,"summon":12.1,"fighter":1.7,"ranged":6.6,"mage":2.6,"fast":0.7,"tank":0.4}
      income/game 170.8 · gathered/game 0.0 · souls/game 598.3 · found enemy HQ in 13/32 games, avg round 42.8
      per unit type (per game): fast dealt 12.0 taken 63.9 models lost 2.1 squads lost 0.7 trained 0.7 | fighter dealt 138.2 taken 144.3 models lost 7.1 squads lost 1.3 trained 1.7 | hero dealt 242.6 taken 137.1 models lost 0.6 squads lost 0.6 trained 0.0 | mage dealt 238.7 taken 66.5 models lost 2.7 squads lost 1.3 trained 2.6 | ranged dealt 2306.7 taken 127.4 models lost 5.1 squads lost 0.8 trained 6.6 | summon dealt 158.2 taken 224.2 models lost 23.3 squads lost 3.5 trained 12.1 | swarm dealt 406.8 taken 1413.4 models lost 147.0 squads lost 23.1 trained 24.9 | tank dealt 1.6 taken 45.4 models lost 1.0 squads lost 0.3 trained 0.4

## greatfield: 32 games · Kingdom 20 (63% of decided) · Undead 12 (38%) · draws 0 · unfinished 0
   new AI vs legacy: as kingdom 16/16 (100%) · as undead 12/16 (75%)
   personalities (new AI): warlord 5/5, blightlord 5/6, bonetide 4/5, smithking 6/6, necrarch 3/5, steward 5/5
   rounds (decided): avg 52.0, median 45, min 16, max 89 · ends: {"hq destroyed":32}
   kingdom: built/game {"barracks":1.9,"mine":2.7,"farm":2.1,"banner":1.3,"tower":1.8,"wall":0.7,"forge":0.3,"chapel":0.2} · trained/game {"builder":10.1,"fighter":9.4,"ranged":8.9,"fast":2.4,"tank":1.2}
      income/game 964.8 · gathered/game 376.2 · souls/game 0.0 · found enemy HQ in 31/32 games, avg round 22.5
      per unit type (per game): builder dealt 0.3 taken 393.5 models lost 12.9 squads lost 6.4 trained 10.1 | fast dealt 170.1 taken 336.2 models lost 6.8 squads lost 2.3 trained 2.4 | fighter dealt 1368.5 taken 1258.5 models lost 30.2 squads lost 7.3 trained 9.4 | hero dealt 646.0 taken 126.7 models lost 0.4 squads lost 0.4 trained 0.0 | ranged dealt 1313.7 taken 451.4 models lost 14.5 squads lost 3.6 trained 8.9 | tank dealt 58.5 taken 244.7 models lost 3.5 squads lost 1.2 trained 1.2
   undead: built/game {"wall":6.8,"well":3.2,"barracks":1.2,"tower":2.1,"monolith":3.2,"pit":0.4,"sanctum":0.4} · trained/game {"swarm":23.4,"fighter":1.8,"summon":15.7,"ranged":9.8,"mage":2.9,"fast":0.1,"tank":0.1}
      income/game 271.4 · gathered/game 0.0 · souls/game 593.4 · found enemy HQ in 15/32 games, avg round 54.8
      per unit type (per game): fast dealt 0.0 taken 5.8 models lost 0.2 squads lost 0.1 trained 0.1 | fighter dealt 125.0 taken 165.5 models lost 8.0 squads lost 1.5 trained 1.8 | hero dealt 173.9 taken 137.2 models lost 0.7 squads lost 0.7 trained 0.0 | mage dealt 339.1 taken 31.1 models lost 1.0 squads lost 0.4 trained 2.9 | ranged dealt 3216.3 taken 227.6 models lost 9.1 squads lost 1.4 trained 9.8 | summon dealt 189.5 taken 265.8 models lost 26.2 squads lost 3.7 trained 15.7 | swarm dealt 453.9 taken 1347.1 models lost 135.3 squads lost 21.5 trained 23.4 | tank dealt 1.1 taken 12.1 models lost 0.3 squads lost 0.1 trained 0.1
```
</details>
<!-- /BALANCE -->

### Known issues and open questions
- Two equal AIs can stall in a siege (each rebuilds at its barracks as fast as it loses squads; HQ and
  towers help the defender; builders repair the HQ between waves). Longer build / training times
  (2026-11-14) made this much rarer.
- The AI sometimes never scouts the enemy HQ on the big maps (fast squads die before they get there).
- In the latest run (2026-11-24, tech tree) the AIs' Kingdom wins 87 %: the elite-unit locks and the AI's
  research hurt the Undead AI much more than the Kingdom AI (see §16). The AI's Undead still train mostly the swarm.
- Skeleton Warbands are now the Undead's top damage dealers (by numbers); Wraiths are rarely trained.
- With 30-squad armies the nameplates crowd the screen (part of the phone / tablet layout to-do).

---

## 16b. Planned (not in the game yet)
- Nothing open here: the Warband in threes is now the **Endless Swarm** research (§11.7, 2026-11-24).

## 17. Tuning guide (where each number lives)

| What | Where | Effect / notes |
|---|---|---|
| Unit stats (models, HP, armour, tier, vision, defends, attack, skills, parry, ghost) | `js/data/units.js` → `FACTIONS.<faction>.units.<role>` | attack helpers `SWING(ap, dmg, reach)`, `VOLLEY(ap, dmg, range, width)`; skills `CHARGE(ap, dmg, len, cd)`, `BLAST(ap, dmg, range, radius, cd)`, `STORM(...)`, `RALLY(ap, radius, cd)`, `SWEEP(ap, dmg, reach, cd)`, `LEAP(ap, range, cd)`, `STEP(ap, range, cd)`, `WALL(name, ap, cd)`, `PIERCE(ap, dmg, range, width, cd)`, `RAISE(ap, radius, cd)` |
| Global combat rules | `RULES` in `js/data/units.js` (table in §7 of the generated rules below) | armour constant, defend / cover / siege multipliers, engagement, parry, overwatch |
| Economy per faction | `FACTIONS.<f>.eco` (`start`, `hq`, `gather`), `FACTIONS.<f>.train` (costs), `FACTIONS.<f>.buildings` (build list) | |
| Buildings | `BUILDINGS` in `js/data/units.js` | cost, work, hp, armour, footprint, vision, fire, income, cp, site, souls, trains |
| Training time, caps, souls, sites, work reach | `RULES.trainRounds`, `armyCap`, `maxBuilders`, `gatherSlots`, `maxBannerCp`, `maxFarms`, `soulRange`, `soulPerModel`, `soulPerHero`, `siteHp`, `workReach` | |
| Faction identity | `FACTIONS.<f>.hqTrains` (what the HQ trains), `FACTIONS.<f>.maxBuilders` (Kingdom 10, Undead 0), `FACTIONS.undead.rises` (buildings rise, no builders) | |
| Undead rising buildings | `RULES.riseWork` (work per round, 80), `RULES.maxRising` (2 at once), `RULES.undeadMend` (0.05 of max HP per round) | build speed and resilience of the Undead base |
| Souls (death economy) | `soulPerModel` 3 (per model dying on graves: cheap many-model squads pay back more than they cost), `soulPerHero` 15; `FACTIONS.undead.eco.hq` (Crypt, 1), `BUILDINGS.well.income` (2) | the whole Undead economy; the flat incomes are only a floor |
| Ground look (visual only) | `js/render/ground.js` (`TEX` 4 texels per inch, `EDGE` 1.6″ soft edge, shader colours); props in `js/render/graves.js` (`CELL` 0.95″, density cov² × 0.32) and forests in `js/render/table.js` | blight and forest floors as a ground texture |
| Melee Strike (target attack) | `js/data/units.js`: `STRIKE(ap, dmg, reach)` per unit; `RULES.strikeMult` (1.15), `RULES.strikeLunge` (30 AP); fallback radius 2″ around the aim point in `resolve.js` (`strike`) and `main.js` (`strikePick`) | melee damage and how reliably blows land on a moving target (§5.2) |
| Tech tree | `js/data/tech.js`: `TECH.<id>` (`cost`, `rounds`, `tier`, `needs`, `needsBuilding`, `doctrine`, effects in `units` / `buildings` / `rules`), `GATES` (squads per HQ tier), `BUILDING_GATES`; tech buildings in `BUILDINGS` (`forge`, `chapel`, `pit`, `sanctum`) | when each faction's power arrives; AI research orders per personality in `js/ai/personalities.js` (`research`) |
| Kingdom farms | `BUILDINGS.farm` (`w`, `d` = land used, `slots` = farmers, `income`), `FACTIONS.kingdom.eco.gather.farm` (AP per gold), `FACTIONS.kingdom.train.builder` | late-game gold; land trade-off |
| Mage / mana | `units.<role>.mana` (`max`, `start`, `regen`), each skill's `mana`; `isMage` in `js/data/units.js` | how often the Lich and Necromancers cast |
| Necromancers (troop) | `FACTIONS.undead.units.mage` (2 × 10 HP, bolt `VOLLEY(25, 4, 9)`, mana 60 / 40 / +15, `THUNDER(15, 20, 6, 10, 2, 3, 0.7)`, `SUMMON(20, 35, 4, 1)`), `train.mage` (22), `RULES.trainRounds.mage` (2) | high tier: cost may change |
| Monolith | `BUILDINGS.monolith` (`cost` 20, `work` 120, `grave` 6, `heal: { radius 4, hp 8 }` per model per round); in `FACTIONS.undead.buildings` | how fast the Undead push graves forward and recover between fights |
| Undead tier rule | `FACTIONS.undead.lowTier` (`swarm`, `fighter`, `ranged`) | low tier: only stats change, never `train` costs; high tier: costs may change either way, but only after asking the owner |
| Lich spells | `SUMMON(ap, mana, range, count)`, `THUNDER(ap, mana, dmg, range, jumps, jump, decay)`, `EXPLODE(ap, mana, range, radius, base, perModel)`; summoned squads: `FACTIONS.undead.units.summon` is derived from `units.swarm` right after `FACTIONS` (change the Warband and summons change with it); `RULES.summonTtl` | |
| The Chosen | `LEAP(ap, range, cd, dmg, radius, name)`, `RALLY(ap, radius, cd, armor, dmgMult)`, `MIGHTY(ap, dmg, reach, cosHalf, stun, cd)` | stun length = `stun` AP |
| Army cap | `RULES.armyCap` (30), map `capBonus` (`js/data/maps.js`) | big battles cost frame time and AI time |
| Graveyards and souls | `BUILDINGS.<type>.grave` (reach: well 10, hq 10, others 6, Monolith 6), `RULES.graveStart` (0.5 at placement; full by the end of the round), `graveHqStart` (10), `graveBlob` (0.8″: radius of the grave area a death adds at the nearest edge, × √models, merging, no maximum; `spreadGraves` in `js/sim/base.js`), `soulPerModel`, `soulPerHero`; `FACTIONS.undead.eco.hq` (1), `BUILDINGS.well.income` (2) | the whole Undead economy: how fast it snowballs |
| Hero revive | `RULES.reviveRadius` (3″), `reviveRounds` (3), `reviveHp` (0.5) | how costly losing the hero is |
| The swarm | `FACTIONS.undead.units.swarm` (`pair`, stats), `train.swarm`, `RULES.trainRounds.swarm` | the Undead horde's size; `tier` (3 since 2026-11-17, was 6 then 4: 3.6″ a round, so the swarm can't rush) and `attack.dmg` (2.1) set how fast and hard it hits early |
| Forests | `RULES.forestSlow` (0.75); sight rules `FOREST_DEPTH` / `FOREST_CLOSE` in `js/sim/vision.js`; light cover `RULES.lightCoverRanged` | |
| Cover (Dawn of War style) | `RULES.heavyCoverRanged` (0.5), `heavyCoverMelee` (0.75), `lightCoverRanged` (0.75), `ruinSlow` (0.75), `coverSeek` (3″); `js/sim/cover.js` (`WALL_GAP` 0.6″, ruin reach radius × 0.6, hit kinds `RANGED_HITS` / `MELEE_HITS_COVER`, cover spot spacing) | how much ruins, walls and forests protect, and how keenly squads seek them (§5.10) |
| Durability | every unit's `hpPer` and every `BUILDINGS.<type>.hp` in `js/data/units.js` (doubled 2026-11-24); tier HP and heals in `js/data/tech.js` | how long fights and sieges take |
| Stuck diagnostic | `node tools/stuck.mjs [--games 2] [--maps a,b] [--rounds 60] [--verbose]` | reports squads whose walk made no progress, with the cause |
| Stances | `RULES.advanceEngage` (10″: Advance fights the nearest squad / building within this), `RULES.goalReach` (1.5″), `RULES.retreatReach` (3″); `GUARD_RANGE` 8″ in `js/sim/stances.js` | how eager stance squads are |
| Production queues | `RULES.queueMax` (squads waiting per training building, 5), `RULES.queueMaxBuild` (base build queue, 5); start order and wait rules in `startQueues` (`js/sim/base.js`) | longer queues = fewer decisions per round; the "one unfinished site per builder" rule limits how fast a base grows |
| Builder site pick | `builderIdleTarget` in `js/sim/builders.js` | idle builders take any unfinished site (fewest builders, then nearest); gatherers leave for new sites. A distance limit there would keep builders (Undead especially) off long, exposed walks |
| Maps | `js/data/maps.js` → `MAPS` | size, terrain (`half` mirrored, `center` not), rivers, sites, HQ spots, road, `capBonus` |
| AI personalities | `js/ai/personalities.js` → `PERSONALITIES` (aggression, greed, tech, defense, `attackRatio`, `firstAttack`, `mix`, farms / peasants / wells / monoliths, `research`, `techBuildings`) | how each AI personality plays: when it attacks, its economy, unit mix and tech path (§14.9) |
| AI difficulty | `js/ai/personalities.js` → `SKILL` (`delay`, `memory`, `focus`, `kite`, `lead`, `adapt`, `scout`, `edge`, `mistake`), `BRUTAL_INCOME` (1.3, applied in `js/main.js` → `start()`) | how sharp the AI is; only Brutal changes income (§14.10) |
| AI strategy | `js/ai/strategy.js`: posture utilities (build 0.55 + …, defend 0.6 + 1.5 × ratio, attack, harass 0.45 × aggression + 0.1), hysteresis 0.15, enemy memory 70 % of peak (−3 % a round) | when it attacks, defends or builds up (§14.5) |
| AI attack plan and tasks | `js/ai/military.js`: defense ratio 1.4, staging 35 % of the way (Undead on graves, 1.5″ inside), launch at 70 % gathered within 6″ or 4 rounds, retreat below ratio 0.7 or 40 % of the squads, target values `VALUE`, scout / raid danger 2 × / 2.2 × power | how its army moves (§14.6) |
| AI micro | `js/ai/tactics.js`: hurt below 35 % HP, pull back below ratio 0.8 (60 AP), kite within 2.6″ (3″ step, 35 AP), shooters close to 0.8 × range, focus-fire score | how well its squads fight (§14.7) |
| AI economy | `js/ai/economy.js`: request priorities (§14.8 table), healthy test, saving rules, diversity 45 % / × 0.6, caster cap 1 per 5, skip below 0.5 × the best option | what it builds, researches and trains (§14.8) |
| AI combat prediction | `js/ai/combat.js` (strength = damage per round × HP; casters × 1.5; defends + 15 % HP each; buildings 4 × fire damage, half HP) | when it thinks it wins a fight (§14.2) |
| AI matchup table | generated: `node tools/matchups.mjs` → `js/ai/matchups.js` (budget 100, 4 seeds, 20 rounds, start 9″ apart); `e^(1.6 × score)` in `economy.js` | which squads it trains against which; **rerun after unit stat or cost changes** (§14.8) |
| AI learning | `js/ai/learning.js` (`PRIOR` 150 HP, clamp 0.4 – 1.6, reach range + 4″ / 7″) | how fast it stops training squads that trade badly (§14.4) |
| Stances | `js/sim/stances.js` | guard range 8″, advance HQ rule (10″) |

**All RULES (generated):**

<!-- GEN:rules -->
| Key | Value | Meaning |
| --- | --- | --- |
| `board` | `{"w":48,"h":32}` | default board (each map sets its own size) |
| `ap` | `100` | AP per squad per round; AP = time |
| `tierCost` | `[15,25]` | AP cost of the 1st / 2nd "act earlier" upgrade |
| `maxUpgrades` | `2` | max act-earlier upgrades per squad per round |
| `minTier` | `1` | lowest tier |
| `moveFactor` | `0.012` | inches per AP per speed tier (tier 5 = 6" per 100 AP) |
| `defendCost` | `20` | AP per bought defend |
| `maxDefends` | `4` | max bought defends per round |
| `armorK` | `20` | armour constant in damage * K / (K + armour) |
| `defendMult` | `0.5` | a defended hit deals x this |
| `cp` | `3` | command points per round (hero and builders are free) |
| `engageGap` | `0.35` | inches between squad edges that count as engaged |
| `disengageAP` | `30` | AP spent standing still when stepping away from an engaged enemy |
| `partingMult` | `0.5` | parting blow strength (x the enemy's full attack) |
| `parryCost` | `15` | AP for a prepared parry |
| `riposteMult` | `0.5` | riposte strength (x own attack) |
| `overwatchCost` | `40` | AP for prepared overwatch |
| `overwatchCos` | `0.5` | overwatch cone: cos of the half angle (0.5 = 60 deg each side) |
| `heavyCoverRanged` | `0.5` | ranged hits on a squad in heavy cover (in a ruin, or behind a Palisade / Bone Fence from its far side) x this |
| `heavyCoverMelee` | `0.75` | melee hits on a squad in heavy cover x this |
| `lightCoverRanged` | `0.75` | ranged hits on a squad in light cover (in a forest) x this |
| `ruinSlow` | `0.75` | movement x this inside a ruin |
| `coverSeek` | `3` | squads on Guard / Advance step into cover within this many inches |
| `forestSlow` | `0.75` | movement x this inside a forest |
| `siegeMult` | `2.5` | damage x this against buildings |
| `strikeMult` | `1.15` | a melee Strike (target attack) deals x this its listed damage |
| `strikeLunge` | `30` | AP of movement (at the squad's speed) a Strike may lunge at a target out of reach |
| `shrineRadius` | `3` | ring drawn around resource sites (visual + placement keep-out x 0.6) |
| `armyCap` | `30` | base squad cap (builders and summoned squads do not count; maps add capBonus) |
| `maxBuilders` | `3` | default builder cap (FACTIONS.<f>.maxBuilders overrides) |
| `gatherSlots` | `2` | builders that can gather at one building (BUILDINGS.<type>.slots overrides: farm 4) |
| `buildZone` | `16` | default build zone (each map: round(width / 3)) |
| `maxBannerCp` | `2` | max Kingdom banners (and max bonus CP) |
| `riseWork` | `80` | undead: work a rising site gains at the end of every round (no builders) |
| `maxRising` | `2` | undead: sites rising at the same time |
| `undeadMend` | `0.05` | undead: finished buildings regain this share of max HP every round |
| `summonTtl` | `3` | rounds a summoned squad lasts |
| `advanceEngage` | `10` |  |
| `goalReach` | `1.5` |  |
| `retreatReach` | `3` |  |
| `trainRounds` | `{"builder":1,"swarm":1,"fighter":2,"ranged":2,"fast":2,"mage":2,"tank":3}` | rounds each role takes to train |
| `queueMax` | `5` | squads waiting per training building |
| `queueMaxBuild` | `5` | buildings waiting in the base build queue |
| `siteHp` | `0.3` | share of max HP a new site starts with |
| `workReach` | `1` | inches between builder edge and footprint to work |
| `soulPerModel` | `3` | souls per model that dies |
| `soulPerHero` | `15` | souls when a hero dies |
| `graveStart` | `0.5` | share of its graveyard a new undead site spreads at once (the rest by the round's end) |
| `graveHqStart` | `10` | the Crypt's graveyard at the start |
| `graveBlob` | `0.8` | deaths on graves add a grave area of radius this x sqrt(models) at the graveyard's nearest edge (merging, no maximum) |
| `reviveRadius` | `3` | revive zone radius |
| `reviveRounds` | `3` | rounds a side must hold the zone |
| `reviveHp` | `0.5` | revived hero's HP share |
| `planningTimerSec` | `120` | (unused; the online timer is chosen in the lobby) |
<!-- /GEN:rules -->

**Test loop for a balance change**
1. Change the number(s).
2. `node tests/sim.test.mjs` (some tests assert exact values: update them if the change is intended).
3. `node tools/balance.mjs --games 8` (≈ 3–6 minutes) and compare with §16; for a quick look
   `--games 3 --maps crossing,twinrivers`.
4. `npm run doc` to refresh the generated tables; update §16 and add a §18 change-log entry.

---

## 18. Change log (balance-relevant)

| Date | Change | Measured effect |
|---|---|---|
| 2026-11 (M1–M2) | Core (the 4th remake, then called V4): squads, tiers, skillshots, engagement, parry, overwatch, cover, cooldowns. HP tuning for Lord vs Necromancer, Grave Guard, Bone Archers | 40 mirrored games roughly even |
| 2026-11 (M3) | Bases: HQ 220 HP / armour 8, siege ×2.5, shrine income, towers; round limit 30 | Kingdom 26 / Undead 14 of 40; 24 of 40 reached the limit |
| 2026-11-13 (M3c) | Faction economies: Kingdom gold (Keep, Farms, Mines), Undead souls (Crypt, Soul Wells, deaths ×2 within 8″); builders; real fog; HQ at 1 of 3 seeded spots | iterated Keep income 6 → 8 → 7: Kingdom 34 / Undead 26 of 60 |
| 2026-11-13 (M3d) | Builders gather (Kingdom farm 12 / mine 10 AP per gold; Undead well 9 / crypt 8 AP per soul, 2 per building); Keep income 7 → 6; round-limit tiebreak counts squads and HQ only | 30 / 30 of 60 |
| 2026-11-13 | **No round limit.** Movement: friendly pass-through, contact stop, sidesteps, re-pathing, no deploys inside rocks; Advance marches on the known HQ / searches HQ spots | stuck moves 18 % → 5 %; 25 of 30 games finish within 80 rounds |
| 2026-11-14 (M5) | Four maps (Crossing 48×32, Twin Rivers 64×40, Highland 64×44, Great Field 80×52; army cap +1/+1/+2); lakes; AI difficulty (income ×0.8 / ×1.25, CP ±1) | big maps stalled often (Twin Rivers 6 of 8 unfinished) |
| 2026-11-14 | AI waves on maps ≥ 60″ wide (rally, launch at 60 %, fall back at 40 % / forward rally after 10 rounds, shooters siege the HQ) | unfinished per 8: Twin Rivers 6 → 1, Highland 5 → 2, Great Field ~3 → 2 |
| 2026-11-14 | **Building work ×2** (wall 60, farm / banner 120, mine / well 160, tower 200, barracks 240); **training 1–3 rounds** (builder 1, fighter / ranged / fast 2, tank 3) | games end far more often: 0–1 of 8 unfinished per map; Twin Rivers 16/16 in 11–23 rounds (Undead 10, Kingdom 6) |
| 2026-11-15 | This document, `tools/balance.mjs`, `tools/gendoc.mjs` | see §16 |
| 2026-11-15 | **Production queues:** one base build queue per side (5 buildings) and a training queue per HQ / Barracks (5 squads); each item paid when it **starts**; waits while unaffordable / no free builder / army cap, in strict order; cancelling a waiting item is free, stopping training refunds it. Idle builders take **any** unfinished site (no 12″ limit; fewest builders first) and gatherers leave to take new sites. AI queues just in time | Kingdom / Undead of 64: 32 / 30 → **38 / 24**; Great Field 8 / 7 → 11 / 4; Highland 9 / 6 → 10 / 5; Twin Rivers 6 / 10 → 9 / 7; Crossing 9 / 7 → 8 / 8; unfinished 2 → 2 |
| 2026-11-15 | The game is renamed **Rovina**; the old versions (v1–v3) and the `v4/` redirect are removed. No rule or number changes | none |
| 2026-11-15 | **Faction split.** Undead: units weaker (HP ~−25 %, damage ~−20 %) and ~half price (warband 9, archers 13, guard 16, wraiths 16); **no builders** (buildings rise 80 work a round, 2 at once, mend 5 %/round); the Crypt raises warbands; souls only from deaths within 10″ of a finished Soul Well (3 per model, 15 per hero), Crypt 4, Well +2 (cost 20); **Necromancer = mage** (tier 3, mana 100 / start 60 / +25, bolt 10 at 10″, Summon Warband 2 temporary squads for 3 rounds, Dark Thunder 14 chaining ×0.7 up to 3 jumps, Corpse Explosion 8 + 6/model). Kingdom: **The Chosen** (Leap Strike 12 dmg, Rally +4 armour +1 defend, Mighty Swing 28 / reach 2.6 / 25 AP stun); farms 4.2×3.4″, 4 farmers, 8 AP per gold, +2 passive, no farm cap; peasants 10 gold, max 10, not in the cap. **Army cap 8 → 30** (map bonus ×4). AI: more peasants and farms, extra barracks when rich, Necromancer spell logic | Kingdom / Undead of 64: 38 / 24 → **40 / 24**; median rounds 13–20 → **25–42**; unfinished 2 → 0 |
| 2026-11-15 | **Stances:** Advance is the default and attacks the nearest known enemy within 10″ (squads, buildings and the HQ alike), else marches to a player-set **target point** (then guards it) or on the enemy HQ; new **Retreat** (to the nearest own Mine / Soul Well, else the HQ). **Repeat production** (lock a building onto one squad). **Fast squads:** swing 20 AP → 45 AP; Outriders 7 → 13 per model, Wraiths 6 → 11 | Kingdom / Undead of 64: 40 / 24 → **40 / 24** (Crossing 10/6 → 8/8, Twin Rivers 10/6 → 12/4, Highland 11/5 → 10/6, Great Field 9/7 → 10/6); median rounds 25–42 → 24–48 |
| 2026-11-16 | **Graveyards** (undead buildings spread grave ground: well 10″, Crypt 6″ (starts 3″), others 3″, +1″/round; deaths on graves pay 2 souls per model (hero 15) and widen them 0.15″; destroyed buildings leave their graves; Crypt income 4 → 0; start souls 35 → 45); **hero revive** (hold the spot 3 rounds, back at 50 % HP); **auto skills** for stance squads (toggle per squad); **Skeleton Warband = swarm** (6 × 5 HP, armour 0, tier 6, 3 per model, 12 souls a pair, 1 round; the Crypt trains it) and the old warband becomes **Skeleton Warriors**; **summons rise mid-round** (can be hit, don't act); **build anywhere**; forests slow ×0.75 (was ×0.6) and a new look | Kingdom / Undead of 64: 40 / 24 → **34 / 28**; tries: swarm 8 + 3 souls → Undead 67 % (3 seeds), 12 + 3 → 65 %, 12 + 2 → 45 % (8 seeds) |
| 2026-11-16 | **Small starting armies** (Kingdom: hero, Men-at-arms, 1 peasant; Undead: Necromancer, a swarm pair); the Keep also trains Men-at-arms; **Undead units ×0.8 HP and damage**; **build only on seen ground** (`s.explored`); **Undead build only on their graves**; **graves spread almost at once** (50 % at placement, full by the round's end; Crypt 10″, others 6″, wells 10″); Soul Well income 2 → 4; souls per model 2 → 3; Undead start 45 → 70 souls, Kingdom 40 → 60 gold; swarm pair 12 → 14; fallen hero's body at its revive point; AI: Kingdom Barracks first + peasants by jobs, Undead grave expansion with Bone Fences | Kingdom / Undead of 64: 34 / 28 → **38 / 22** (Crossing 3 / 13, Twin Rivers 12 / 4, Highland 13 / 1, Great Field 10 / 4) |
| 2026-11-17 | **Undead death economy:** Crypt income 0 → 1, Soul Well income 4 → 2 (deaths on graves are the main income); **Monolith** replaces the Obelisk for the Undead (off graves, within 6″ of a caster, 6″ graves, heal 4 HP per model in 4″, no CP); new **Necromancers** troop (22 souls); hero renamed **Lich**; forests ×1.5; Undead start 70 → 90 souls; AI expands with Monoliths and trains Necromancers | Kingdom / Undead of 64: 38 / 22 → 41 / 20 (death economy, start 70) → **34 / 23** with start 90 (Crossing 3 / 13, Twin Rivers 10 / 6, Highland 9 / 4, Great Field 12 / 0; 7 unfinished) |
| 2026-11-17 | **Win only by destroying the HQ** (no more "army and barracks gone"); **Skeleton Warband** tier 6 → 4 (7.2″ → 4.8″ a round) and damage 2.4 → 2.1 per model (cost unchanged); **Raise Monolith** becomes a Lich / Necromancers skill (20 AP, 30 mana + 20 souls, within 6″, rises in 2 rounds, takes no rising slot) and leaves the build menu; the AI casts it | Kingdom / Undead of 64: 34 / 23 (7 unfinished) → **40 / 21** (3 unfinished): Crossing 13 / 3 → 10 / 6 Undead / Kingdom, Twin Rivers 10 / 6 → 13 / 3, Highland 9 / 4 → 9 / 6, Great Field 12 / 0 → 12 / 2 Kingdom / Undead |
| 2026-11-17 | **Graves grow from deaths with no maximum** (removed `graveCapMult` 1.5 × reach and `gravePatchCap` 3″; still 0.15″ per model) | Kingdom / Undead of 64: 40 / 21 (3 unfinished) → **41 / 21** (2 unfinished); Highland souls from deaths 692 → 927 a game |
| 2026-11-17 | **Skeleton Warband tier 4 → 3** (4.8″ → 3.6″ a round); **deaths spread graves at the nearest edge** (a small area `graveBlob` 0.8″ × √models where they died, merging, no maximum) instead of widening the whole graveyard | Kingdom / Undead of 64: 41 / 21 (2 unfinished) → **35 / 27** (2 unfinished): Crossing 6 / 10 → 2 / 14, Twin Rivers 13 / 3 → 11 / 4, Highland 10 / 5 → 10 / 5, Great Field 12 / 3 → 12 / 4 |
| 2026-11-18 | **Summoned skeletons = Skeleton Warbands with a timed life** (were 3 × 11 HP, armour 3, tier 5, 3 damage; now 6 × 4 HP, armour 0, tier 3, 2.1 damage, derived from the swarm); **Corpse Explosion** 8 + 6 → 8 + 3 per model (a full summon still 26) | Kingdom / Undead of 64: 35 / 27 (2 unfinished) → **38 / 23** (3 unfinished): Crossing 2 / 14 → 2 / 13, Twin Rivers 11 / 4 → 11 / 4, Highland 10 / 5 → 13 / 3, Great Field 12 / 4 → 12 / 3 |
| 2026-11-24 | **The Monolith is an ordinary Undead building again**: in the build menu, must stand on the side's graves, takes a rising slot (was briefly a Lich / Necromancers skill that could raise it off graves); keeps its 6″ graves and heal; AI: Bone Fences for expansion, a forward Monolith on its graves from round 5 | Kingdom / Undead of 64: 38 / 23 (3 unfinished) → **36 / 25** (3 unfinished): Crossing 2 / 13 → 3 / 13, Twin Rivers 11 / 4 → 11 / 5, Highland 13 / 3 → 9 / 5, Great Field 12 / 3 → 13 / 2 |
| 2026-11-24 | **Tech tree** (§11.7): HQ tiers (Tier 2 locks elite squads and tech buildings), research at the HQ and 2 tech buildings per faction, doctrines; AI tiers up and researches while its army holds up | Kingdom / Undead of 64: 36 / 25 (3 unfinished) → first version 63 / 1 → **55 / 8** (1 unfinished) after the AI fix; Crossing 11 / 5, Twin Rivers 15 / 1, Highland 14 / 2, Great Field 15 / 0 |
| 2026-11-24 | **Necromancers train at the Crypt only** (was the Ossuary); **Mausoleum** 3 → 2 rounds; the AI trains Necromancers at the Crypt once unlocked | Kingdom / Undead of 64: 55 / 8 (1 unfinished) → **51 / 10** (3 unfinished): Crossing 11 / 5, Twin Rivers 12 / 3, Highland 14 / 2, Great Field 14 / 0 |

| 2026-11-24 | **The AI remade** (§14): layered managers, fog-fair perception, influence maps, Lanchester combat prediction, a duel-based matchup table, learning from trades, attack plans, personalities; difficulty is skill only (income ×0.8 / ×1.25 and CP ±1 removed) plus Brutal (+30 % income). No rule or unit numbers changed | Kingdom / Undead of 64 (both sides Normal): 51 / 10 (3 unfinished, old AI) → **59 / 5** (0 unfinished, new AI): Crossing 12 / 4, Twin Rivers 16 / 0, Highland 15 / 1, Great Field 16 / 0. New AI vs the old: 61 / 64 as Kingdom, 40 / 64 as Undead |
| 2026-11-24 | **Melee Strike** (§5.2): melee base attacks are target attacks (one named enemy, a lunge of up to 30 AP of movement when it is out of reach at release, not while locked with another enemy; ×1.15 damage) instead of area swings; area attacks unchanged; old swing orders convert; AI matchup table regenerated | Kingdom / Undead of 64: 59 / 5 (0 unfinished) → **53 / 9** (2 unfinished): Crossing 6 / 9, Twin Rivers 16 / 0, Highland 15 / 0, Great Field 16 / 0. New AI vs the old: Kingdom 61 → 63 / 64, Undead 40 → 41 / 64 |
| 2026-11-24 | **Cover and durability pass**: ruins walk-in heavy cover (ranged ×0.5, melee ×0.75), walls give heavy cover from their far side, forests light cover (ranged ×0.75, was ×0.5 for volleys through forests); stance and AI squads take cover; **unit and building HP ×2** (tier HP, heals, HP research ×2); footprint-exact hits on buildings; own buildings never block own shots; own squads pushed by new sites; stuck-squad fixes | Kingdom / Undead of 64: 53 / 9 (2 unfinished) → **61 / 3** (0 unfinished): Crossing 13 / 3, Twin Rivers 16 / 0, Highland 16 / 0, Great Field 16 / 0. New AI vs the old: Kingdom 63 → 64 / 64, Undead 41 → 51 / 64 |
---

## 19. Keeping this document up to date

Whenever rules, numbers, the AI or maps change:
1. Run `npm run doc` (regenerates every `GEN` table from the data files).
2. Update the prose sections that describe the changed behaviour (§2–§6, §10–§15).
3. For balance-relevant changes, run `node tools/balance.mjs --games 8`, paste the summary into §16,
   and add a row to §18 with the before / after numbers.

---

## 20. Design references

**How references are chosen (the owner's rule, from 2026-11-15):**
- **Gameplay, systems and balance:** most references are **well-known real RTS games** and established
  RTS design guides (and the tabletop wargames the game grew from). They are used for **mechanics and
  ideas** (how a system works, typical numbers, why a design choice is made), never to recreate a
  specific game: no copied names, characters, art, music, maps or levels.
- **Art and look:** only the references the owner gives or names. Nothing else is used for art.
- When a new feature is designed after a reference, add a row below (feature, reference, what was
  taken, what is different here).

**Mechanics already in the game and the real RTS games they resemble:**

| Feature here | Similar to | What is shared | What is different here |
|---|---|---|---|
| Squads of several models; damage removes models; a big squad cap (30) | Dawn of War, Company of Heroes | squad-based armies, losses shown as fewer models, a squad cap | turn-based with simultaneous orders; damage scales with the models left |
| Speed tiers inside a round, simultaneous orders | tabletop wargames (alternating / initiative activation), WeGo games such as Combat Mission | everyone plans, then the round resolves | faster tiers act first; AP is time inside a tier |
| Heroes with three skills | Warcraft III | heroes with a small kit that shapes fights | no hero levels or items |
| Mana mages (the Lich, Necromancers): spells cost mana, regenerate each round | Warcraft III casters | mana pool and regeneration | no cooldowns for mages; casts repeat while AP and mana last |
| Chain lightning (Dark Thunder) | Warcraft III (Far Seer's Chain Lightning) | a bolt that jumps to nearby enemies, weaker each jump | aimed skillshot; first target needs line of sight |
| Stun (Mighty Swing) | Warcraft III (Storm Bolt, Thunder Clap) | a hit that stops the target acting for a while | stun is measured in AP inside the round |
| Temporary summons that crumble | Warcraft III summoned units with a timed life | free bodies that expire | they rise at the end of the round; Corpse Explosion can spend them |
| Undead buildings that build themselves | Warcraft III Undead (summoned buildings), StarCraft Protoss (warped-in buildings) | no worker has to stay to finish a building | a separate limit of 2 rising at once; they mend slowly |
| Workers on farms; farms use land | Age of Empires | farmers gather at farms; farms take building space | 4 farmers per farm; peasants also build and repair |
| Resource sites to claim (Mines, Soul Wells) | Dawn of War (strategic points), Company of Heroes (territory) | fixed spots on the map worth fighting over | Soul Wells only trickle souls and spread graves far |
| Production queues paid when the item starts | the queues of most RTS games (StarCraft II: 5 per building) | queue several items per building | payment at start, the queue waits when you can't pay |
| Fog of war with explored / visible ground | most RTS games (Warcraft, StarCraft, Age of Empires) | black mist for never-seen ground, a haze for explored ground | line of sight blocked by walls and deep forests |
| Command points (3 direct orders a round) | tabletop command / order systems | you can't micro everything | squads without orders follow stances |
| Stances (Advance / Guard / Hold / Retreat) | Age of Empires II unit stances (aggressive, defensive, stand ground, no attack) | standing orders for squads you don't micro | Retreat falls back to a resource site; stances run inside the round's tiers |
| Advance to a target point, fighting on the way | attack-move (StarCraft and most RTS games) | move somewhere but stop to fight what you meet | the point persists over rounds; buildings and squads are equal targets |
| Repeat production (lock a building onto a squad) | Supreme Commander (repeat build on factories), Rise of Nations (continuous production) | a building keeps producing without new orders | the lock only fills an empty queue; each squad is still paid when it starts |
| Graveyards spreading around undead buildings; souls from deaths on them; undead build only on graves | Warcraft III Undead blight, StarCraft Zerg creep, and the Necron power-matrix idea from Dawn of War IV the owner named | ground that spreads almost at once from the faction's buildings; the faction can only build on it | graves pay souls when things die on them and creep outward at the nearest edge where each death happened |
| Build only on ground you have seen | fog-of-war placement rules of most RTS games | no building blind in unexplored ground | seen once is enough (it doesn't have to be in sight now) |
| Small starting armies | most RTS games (a few workers and a hero, the rest from the base) | the base matters from the first round | the Keep and the Crypt train soldiers from round 1 |
| A swarm unit trained in pairs | StarCraft zerglings (two per egg) | cheap, fragile bodies in numbers | slow (tier 3) so it can't rush; an upgrade to threes is planned |
| Auto skills toggle | Warcraft III autocast | units use abilities by themselves when switched on | applies to every skill of a squad without orders |
| Hero revive by holding the spot | the owner's original design (compare Warcraft III's altar revive) | a fallen hero can come back | you revive it on the battlefield by holding the ground where it fell |
| HQ tiers that unlock squads and buildings | Warcraft III (Town Hall → Keep → Castle), Age of Empires (ages) | a tier upgrade at the base gates elite units and tech | the tier is researched in the HQ's queue like other research |
| Research in a building's queue; weapon / armour lines | StarCraft II (Forge, Engineering Bay), Warcraft III (Blacksmith, Graveyard), Age of Empires (Blacksmith) | upgrades are researched one at a time and block the building | shares the training queue; paid when it starts |
| Economy research | Age of Empires (Mill, Mining Camp upgrades) | faster gathering and better income | Kingdom farms / mines / Keep; Undead graves and souls |
| Exclusive doctrine picks per tier | Age of Mythology (minor gods), Dawn of War (commander choices), C&C Generals (generals' powers) | a choice that rules out its alternative | one pair per tier, picked by researching it |
| Win only by destroying the HQ | base-kill victory in many RTS games (e.g. StarCraft's destroy-all-buildings, simplified to the HQ) | the game is decided at the enemy base | a side with no army still plays on while its HQ stands |
| Fast squads: few heavy hits | cavalry in many RTS games (high damage, slower attack) | burst damage instead of many small hits | 2 swings a round, so they strip fewer defends |
| Blight as a ground texture with soft, noisy edges; big headstones and crosses | Warcraft III Undead blight (named by the owner for the look), StarCraft Zerg creep | the land itself turns dark and dead where the faction spreads, with an organic edge | it is the graveyard (souls); the props thin out toward the edge |
| Death economy (income from things dying on your ground; cheap units pay back more than they cost) | Warcraft III Undead corpses and graveyards (raising from the dead), Dawn of War Necrons / "blood for the god" style economies, StarCraft Zerg (cheap, expendable units) | losses feed the faction; expendable units are part of the plan | per model, so many-model cheap squads profit and elites lose value; the flat income is a floor only |
| Monolith: a grave-spreading, healing building | Warcraft III Undead (Ziggurat-style blight spreaders), healing structures such as Warcraft III fountains of health, Dawn of War IV-style Necron power-matrix pylons (the owner's reference for spreading ground) | a building that extends your ground and supports units around it | built on your graves like other Undead buildings; heals instead of giving command points |
| Necromancers as a caster troop under a caster hero | Warcraft III Necromancers / Liches and other caster units with mana | cheap-ish casters with a small spellbook and their own mana | weaker copies of the hero's spells (one-squad summon, short chain) |
| Forests as large woodland that thins at the edges | the forests of most RTS maps (Age of Empires woods, Company of Heroes hedges and woods) | woodland reads as terrain with cover and slower movement | trees thin out across a soft edge; lone trees outside are only decoration |
| Light and heavy cover that squads walk into; cover from walls by direction | Dawn of War (light / heavy cover: craters, ruins, sandbags; units take cover positions), Company of Heroes (directional cover behind walls) | protection depends on where a squad stands, so position matters | heavy ×0.5 ranged / ×0.75 melee, light ×0.75 ranged; stance squads take cover within 3″ |
| Longer-lived units and buildings | Dawn of War (high HP pools, long fights with retreat and reinforcement) | fights last long enough to react: retreat, reinforce, flank | ×2 HP (a bit less than Dawn of War's pace) |
| Target attacks (melee Strike) vs area attacks | single-target attacks vs splash / area attacks in StarCraft and Warcraft III; units chasing their attack target in most RTS games; "attack a unit" melee in tabletop wargames | melee commits to one enemy and follows it a little; areas hit whatever is inside | a short, speed-based lunge (30 AP) at release instead of free chasing; +15 % for giving up the area |
| AI architecture: layered managers (strategy → economy / production → military → tactics) | UAlbertaBot (Churchill), 0 A.D.'s Petra bot (headquarters, queue, attack and defense managers), the Halo Wars 2 commander AI | each layer only tells the next what it needs | one pass per round from the side's own view (§14) |
| Queue manager with priorities and saving | Petra's production queues and accounts; Age of Empires II AI scripting (build / train rules, strategic numbers) | every need is a request; important ones hold their cost back | one item per building a round; reserves only in the opening (§14.8) |
| Attack-plan lifecycle (target, gather at a staging point, attack, retreat, regroup) | Petra's attackManager, AoE II attack groups and "three ways to get the AI to attack", classic attack waves | the army groups up, attacks together and falls back when it is losing | staging on safe ground; the Undead stage on their graves (§14.6) |
| Influence maps | Zobrist; Louis et al. / Miles (influence maps for RTS, CIG 2006, CIG 2014) | own strength and enemy threat spread over a grid | 2″ cells, 9″ falloff (§14.3) |
| Combat prediction with Lanchester's square law | Stanescu, Barriga and Buro, "Using Lanchester attrition laws for combat prediction in StarCraft" (AIIDE 2015); arXiv 1605.05305 | strength ≈ damage × HP; fight at ≥ ~1.2, retreat at ≤ ~0.7 | armour, casters, defends and building fire in the strength (§14.2) |
| Combat simulator for unit choice | SparCraft / the combat simulators of StarCraft bots (Churchill) | simulated fights decide what beats what | run offline into a matchup table (`tools/matchups.mjs`, §14.8) |
| Learning from combat outcomes | dynamic scripting (Spronck et al.), adaptive game AI | the weights of what works go up, of what fails go down | per role trade ratio in the current game (§14.4) |
| Scouting and opponent modelling | Weber and Mateas; "inferring strategies from limited reconnaissance" (arXiv 1210.4880); Synnaeve and Bessière | a scout finds the base; what was seen drives counters | memory of seen squads, enemy tier (§14.1) |
| Micro: focus fire, kiting, pulling back hurt units | StarCraft bot micro; Hagelbäck and Johansson (potential fields, AIIDE) | concentrate damage, keep range, save hurt units | shared focus fire without overkill (§14.7) |
| Personalities as weights on utilities | AoE II strategic numbers; ISART utility-based personalities; Halo Wars 2 commander strategy tables | different AIs play differently from the same code | three per faction, random or picked (§14.9) |
| Fair difficulty by skill; a separate labelled cheating level | "Game AI & Our Cheatin' Hearts" (Game Developer); Game AI Pro; AoE II / StarCraft difficulty levels | difficulty changes reaction, memory, micro and decisions, not resources | only Brutal (+30 % income) cheats (§14.10) |

