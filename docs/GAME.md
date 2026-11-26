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
in front of it, and **no resources** (both factions start at **0** since 2026-11-25, like most RTS games; the first
income arrives at the end of round 1, so the first purchases are made in round 2). **Small starting armies** (since 2026-11-16; the
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
  attacks: shield walls, rally, Leap Strike, Mighty Swing, the casters' spells, Arrow Storm,
  Piercing Bolt, charges.
- **How auto skills choose** (`autoSkills`, reworked 2026-11-25 for variety):
  - **Scores:** every skill that is ready (cooldown 0 and not used this round; casters: enough mana) and whose situation applies becomes a candidate with a score:

    | Skill | When | Score |
    |---|---|---|
    | Lock Shields / Grave Wall | engaged, or enemy shooters in range + 2″ | 3 + 0.5 per engaged enemy |
    | Shadow Step | engaged and below half a model's HP | 4 |
    | Raise | fallen models nearby | 1.5 + 1 per squad |
    | Rally | a fight within 6″ and 1+ friend in the circle | 1.5 + 0.4 per friend |
    | Leap Strike | target 1″ to its range away | 2.2 |
    | Mighty Swing | target within reach − 0.2″ | 2.5 + 0.5 per other enemy in reach |
    | Sweep | 1+ enemy around | 1.5 + 1 per enemy |
    | Corpse Explosion | a summoned squad with 2+ enemies by it, or 1 when it crumbles this round or is below half HP | 1.5 + 1.2 per enemy |
    | Summon Warband | target < 12″, fewer than 4 summoned squads out | 3 when none are out, else 1.6 |
    | Dark Thunder | target in range with a clear line | 2.2 (+1 if it would finish it, −0.8 for a second cast) |
    | Arrow Storm | target within range + 1″ | 1.2 + 0.8 per squad under it (+1.5 if the line is blocked) |
    | Piercing Bolt | target in range with a clear line | 1.8 + 0.7 per extra enemy on the line |
    | Bone Blast | target within range + 1″ | 2 |

  - **Rotation:** a skill the squad used **last round** (`q.lastSk`, set when its plan is built) scores **−1.5**, so squads rotate through their skills instead of repeating one.
  - **Order:** the best candidate is cast, then the list is rebuilt (AP, mana and "once a round" change), up to 4 casts. A charge is checked last and fills the rest of the AP with strikes.
  - **Locked in melee:** ranged skills are never candidates (§5.9b).
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
   - **else** the enemy squad or building whose edge is closest to the aim point, within 2″ of it;
   - **else** (since 2026-11-26) the enemy nearest the squad within reach + lunge distance.

   The squad turns to face it; the playback marks the target during the wind-up.

   **Chase** (since 2026-11-26): if at the start **every** enemy is beyond reach + lunge
   (`reach + speed × strikeLunge`) and the squad is not locked in melee, the strike does not swing at
   nothing: its AP become a **move toward the target** (the named one, else the enemy nearest the aim
   within 4″; a path around obstacles). Event `chase`; the next strike in the plan may then land.
2. **Release (after `attack.ap` AP)**, in this order (reworked 2026-11-26; before, 1 strike in 3 missed in AI games, now about 1 in 16):
   1. **The named target**, if alive: hit it if it is **in reach** (edge-to-edge gap ≤ `reach`); else, if
      the squad is **not engaged with any enemy** and the target is within reach + lunge, **lunge** at it.
      - **Lunge distance:** up to `speed × RULES.strikeLunge` (30 AP) × the terrain factor where it stands
        (move 3.6″: 1.08″, 4.8″: 1.44″, 6″: 1.8″, 7.2″: 2.16″, 9″: 2.7″).
      - **Stops** 0.9 × reach from the target, and earlier at terrain, buildings or the board edge.
        **Friends don't stop it** (like ordinary moves, it passes through its own lines; overlaps drift apart).
      - **Costs:** the lunge costs no AP and gives no parting blows.
   2. **Else any enemy already in reach** takes the blow: an enemy it is **locked in melee with first**,
      then the one nearest the original target (or the aim point). So a squad locked with another enemy,
      or whose target died, still hits.
   3. **Else**, if not locked and it hasn't lunged yet: a **lunge at the nearest enemy** within reach + lunge.
   4. **Else a miss** (the enemy moved further away during the wind-up: a real dodge). The `release` event
      has `miss`, `gap` (the nearest enemy's distance) and `locked`; the playback shows "Whiff" and the
      log says why.
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

### 5.9b Shooters locked in melee (`resolve.js` `step`, `meleeOf` / `isRangedSkill` in `js/data/units.js`)
- **Who:** Crossbows, Bone Archers, the Lich and Necromancers have a **melee fallback** (`melee: STRIKE(...)`):

  | Unit | Melee fallback |
  |---|---|
  | Crossbows | 2 a model |
  | Bone Archers | 1.2 |
  | Lich | 7 |
  | Necromancers | 1.5 |

  All are 25 AP, reach 1.2–1.4″, with ×`strikeMult` and the lunge like any strike.
- **Ranged skills** are tagged `ranged: true`: Piercing Bolt, Arrow Storm, Bone Blast, Dark Thunder. Summon Warband, Corpse Explosion, Rally, etc. are not.
- **When a volley / lob or a ranged skill starts** (its first AP) while the squad is **engaged** (§5.8: an enemy melee squad within 0.35″), the action becomes a **melee strike** at the nearest enemy it is engaged with. It costs the melee attack's AP. No mana or cooldown is spent on the skill. Event `toMelee` (logged as "locked in melee: its … becomes a melee strike").
- If the squad disengaged earlier in its plan, the shot fires normally: the check is at the moment the action starts.
- **A melee option:** shooters can also order a **Melee** strike on purpose (dock button; order `{ kind: 'strike', t, x, z }`, cost = the melee attack's AP).
- **Stances, auto skills and the AI:**
  - a locked shooter strikes the enemy it is engaged with instead of planning shots;
  - `autoSkills` never picks a ranged skill while engaged;
  - the AI's hand-ordered shooters do the same (they still kite away first when not locked in).

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

### 5.11 Passives (`passive` per unit in `js/data/units.js`; applied in `resolve.js`)
Every unit type has one always-on ability, shown in its squad panel (✦) and in Help.

| Unit | Passive | Effect (exact rule) |
|---|---|---|
| The Chosen | Berserk | While HP < 40 % of max: its hits ×1.5 (`outMult`), hits on it ×0.85 |
| Shieldwall | Bulwark | Ranged hits on it (volley, pierce, lob, storm, blast, thunder) ×0.75, multiplying with cover |
| Men-at-arms | Disciplined | Its hits ×1.25 on a squad that another of its side's squads is engaged with |
| Crossbows | Armour-piercing | Its volleys and Piercing Bolts treat the target's armour as 3 lower (min 0) |
| Outriders | Ride Down | Its hits ×1.5 on ranged squads and casters |
| Peasants | Militia | +3 armour while its edge is within 4″ of one of its side's buildings |
| The Lich | Soul Drain | After each hit it lands, heals 25 % of the damage dealt (up to max HP; models come back as HP fills) |
| Grave Guard | Grave-bound | +3 armour while standing on its side's graves |
| Skeleton Warriors | Reassemble | At the end of the round, on its side's graves: +2 HP per model (up to max) |
| Skeleton Warband (and summons) | Rend | Each hit puts a stack on the target (max 10): its hits ×(1 − 0.05 × stacks) and its AP for a round = 100 × (1 − 0.05 × stacks) (`apFor`). The stacks last until the end of the target's next round; a new hit refreshes them |
| Bone Archers | Long Shot | Its hits ×1.25 on targets whose centre is 8″+ away |
| Wraiths | Chilling Touch | After the target uses a defend on its hit, one more of its defends is stripped (`chill` event) |
| Necromancers | Soul Siphon | At the end of the round: +5 mana per enemy model that died within 6″ this round (up to max mana) |

**Order in a hit:**
1. The attacker's multipliers (Berserk, Rend on the attacker, Rally) are part of the raw damage.
2. Then cover, Lock Shields and the passive multipliers (Disciplined, Ride Down, Long Shot, Bulwark, Berserk-taken).
3. Armour changes (Armour-piercing, Militia, Grave-bound) go into `damageAfter`.
4. Then defends, Chilling Touch, Rend, Soul Drain.

Nameplates show Rend as ✂ with the stack count.

## 6. Movement and collisions (`js/sim/nav.js`, `resolveMoves` in `resolve.js`)

- **Paths:** A* on a 0.5″ grid per squad radius (obstacles inflated by the radius; slow terrain costs
  more), then smoothed. Paths are computed when orders are given (planner / AI / stances).
- **Movement is its own stat** (since 2026-11-25): every unit has `move`, the inches it walks in a full
  round (100 AP) on open ground (`FACTIONS.<f>.units.<role>.move`; the default is tier × 1.2). **Tier now
  only sets initiative** (which tier acts first). `moveOf(def)` = `move / 100` is the speed in inches per
  AP used by paths (`pathAP` / `walkAP` take it), stances, the planner's reach ring, the Strike lunge and
  the AI. Exceptions to the default: **Crossbows 4.8″** (tier 5, so 6″ before), **Wraiths 9″** (tier 6,
  7.2″ before). Research can add movement (Horse Breeding +1″, Hollow Bones +0.6″, Spectral Speed +1″).
- **Each AP:** a walking squad advances along its path by its speed (`moveOf`) × terrain factor.
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

| Role | Name | Models | HP/model | HP | Armour | Tier (initiative) | Move "/rnd | Pop | Vision | Defends | Radius | Attack | AP | Dmg/model | Full squad/hit | Reach / range | Hits per 100 AP | Flags | Train cost | Train rnds |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| hero | The Chosen | 1 | 260 | 260 | 9 | 5 | 6 | 0 | 12 | 2 | 0.65 | strike | 25 | 18 | 20.7 | reach 1.6" + lunge 1.8" (one target) | 4 | - | - | - |
| tank | Shieldwall | 3 | 102 | 306 | 12 | 4 | 4.8 | 3 | 9 | 2 | 1.227 | strike | 30 | 4.8 | 16.56 | reach 1.3" + lunge 1.44" (one target) | 3 | - | 30 | 3 |
| fighter | Men-at-arms | 4 | 60 | 240 | 7 | 5 | 6 | 2 | 9 | 1 | 1.34 | strike | 25 | 6 | 27.6 | reach 1.5" + lunge 1.8" (one target) | 4 | parry | 24 | 2 |
| ranged | Crossbows | 4 | 45 | 180 | 3 | 5 | 4.8 | 2 | 11 | 1 | 1.34 | volley | 40 | 2.7 | 10.8 | range 14", width 0.7" | 2 | melee when locked: strike 2/model, 25 AP, reach 1.2" | 26 | 2 |
| fast | Outriders | 3 | 72 | 216 | 6 | 6 | 7.2 | 3 | 11 | 1 | 1.347 | strike | 45 | 13 | 44.85 | reach 1.7" + lunge 2.16" (one target) | 2 | - | 30 | 2 |
| builder | Peasants | 2 | 42 | 84 | 2 | 5 | 6 | 0 | 8 | 0 | 1.094 | strike | 25 | 2 | 4.6 | reach 1.2" + lunge 1.8" (one target) | 4 | - | 10 | 1 |

**Undead Legion** (`FACTIONS.undead.units`)

| Role | Name | Models | HP/model | HP | Armour | Tier (initiative) | Move "/rnd | Pop | Vision | Defends | Radius | Attack | AP | Dmg/model | Full squad/hit | Reach / range | Hits per 100 AP | Flags | Train cost | Train rnds |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| hero | Lich | 1 | 270 | 270 | 5 | 3 | 3.6 | 0 | 12 | 1 | 0.65 | volley | 25 | 13 | 13 | range 10", width 0.6" | 4 | melee when locked: strike 8/model, 25 AP, reach 1.4", mage: mana 60/100, +25/rnd | - | - |
| tank | Grave Guard | 3 | 63 | 189 | 9 | 4 | 4.8 | 3 | 9 | 2 | 1.227 | strike | 30 | 3.2 | 11.04 | reach 1.3" + lunge 1.44" (one target) | 3 | - | 16 | 3 |
| fighter | Skeleton Warriors | 5 | 27 | 135 | 3 | 5 | 6 | 1 | 9 | 1 | 1.439 | strike | 25 | 2.4 | 13.8 | reach 1.5" + lunge 1.8" (one target) | 4 | parry | 9 | 2 |
| swarm | Skeleton Warband | 5 | 21 | 105 | 2 | 3 | 3.6 | 1 | 9 | 0 | 1.151 | strike | 25 | 2.8 | 16.1 | reach 1.4" + lunge 1.08" (one target) | 4 | - | 20 | 2 |
| ranged | Bone Archers | 4 | 30 | 120 | 1 | 5 | 6 | 1 | 11 | 1 | 1.34 | volley | 40 | 1.9 | 7.6 | range 14", width 0.9" | 2 | melee when locked: strike 1.2/model, 25 AP, reach 1.2" | 13 | 2 |
| fast | Wraiths | 3 | 42 | 126 | 3 | 6 | 9 | 2 | 11 | 1 | 1.347 | strike | 45 | 11 | 37.95 | reach 1.7" + lunge 2.7" (one target) | 2 | ghost | 16 | 2 |
| mage | Necromancers | 2 | 30 | 60 | 1 | 4 | 4.8 | 2 | 10 | 1 | 1.094 | volley | 25 | 4 | 8 | range 9", width 0.5" | 4 | melee when locked: strike 1.5/model, 25 AP, reach 1.2", mage: mana 40/60, +15/rnd | 22 | 2 |
| summon | Skeleton Warband | 5 | 21 | 105 | 2 | 3 | 3.6 | 0 | 9 | 0 | 1.151 | strike | 25 | 2.8 | 16.1 | reach 1.4" + lunge 1.08" (one target) | 4 | summoned (lasts 3 rnds, not trainable) | - | - |

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
| Kingdom | Crossbows | Piercing Bolt | `pierce` | attack | 35 | 2 | - | 3.6 x 4 = 14.4 | ranged true, dmg 3.6, range 16, width 0.7 |
| Kingdom | Outriders | Charge | `charge` | move | 35 | 1 | - | 9 x 3 = 27 | wind 8, dmg 9, len 9 |
| Undead Legion | Lich | Summon Warband | `summon` | defense | 20 | - (mage) | 40 | - | range 4, count 2, radius 1.6 |
| Undead Legion | Lich | Dark Thunder | `thunder` | attack | 15 | - (mage) | 25 | 17 x 1 = 17 | ranged true, dmg 17, range 11, jumps 3, jump 3.5, decay 0.7, radius 1 |
| Undead Legion | Lich | Corpse Explosion | `explode` | attack | 10 | - (mage) | 20 | - | range 9, radius 2.5, base 8, perModel 3 |
| Undead Legion | Grave Guard | Grave Wall | `wall` | defense | 15 | 1 | - | - | mult 0.3, cosHalf 0.5 |
| Undead Legion | Bone Archers | Arrow Storm | `storm` | attack | 35 | 2 | - | 3.2 x 4 = 12.8 | ranged true, dmg 3.2, range 15, radius 2.2 |
| Undead Legion | Wraiths | Charge | `charge` | move | 35 | 1 | - | 6.8 x 3 = 20.4 | wind 8, dmg 6.8, len 9 |
| Undead Legion | Necromancers | Dark Thunder | `thunder` | attack | 15 | - (mage) | 20 | 6 x 2 = 12 | ranged true, dmg 6, range 10, jumps 2, jump 3, decay 0.7, radius 1 |
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
| Shieldwall | 16.56 | 51 | 42 | 39 | 36 | 33 | 30 |
| Men-at-arms | 27.6 | 112 | 96 | 88 | 80 | 72 | 68 |
| Crossbows | 10.8 | 22 | 18 | 18 | 16 | 14 | 14 |
| Outriders | 44.85 | 90 | 78 | 72 | 64 | 58 | 56 |
| Peasants | 4.6 | 20 | 16 | 16 | 12 | 12 | 12 |

**Undead Legion: damage per 100 AP against armour**

| Unit | Raw/hit | vs 0 | vs 3 | vs 5 | vs 8 | vs 11 | vs 12 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Lich | 13 | 52 | 44 | 40 | 36 | 32 | 32 |
| Grave Guard | 11.04 | 33 | 30 | 27 | 24 | 21 | 21 |
| Skeleton Warriors | 13.8 | 56 | 48 | 44 | 40 | 36 | 36 |
| Skeleton Warband | 16.1 | 64 | 56 | 52 | 44 | 40 | 40 |
| Bone Archers | 7.6 | 16 | 14 | 12 | 10 | 10 | 10 |
| Wraiths | 37.95 | 76 | 66 | 60 | 54 | 48 | 48 |
| Necromancers | 8 | 32 | 28 | 24 | 24 | 20 | 20 |
| Skeleton Warband | 16.1 | 64 | 56 | 52 | 44 | 40 | 40 |

**Attacks needed: Kingdom (rows, full squad, no losses) vs Undead Legion (columns, full HP, no defends)** (rounds = attacks / hits per 100 AP)

| Attacker \ Target | Lich | Grave Guard | Skeleton Warriors | Skeleton Warband | Bone Archers | Wraiths | Necromancers | Skeleton Warband |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| The Chosen | 16 (4 r) | 14 (3.5 r) | 8 (2 r) | 6 (1.5 r) | 6 (1.5 r) | 7 (1.8 r) | 3 (0.8 r) | 6 (1.5 r) |
| Shieldwall | 21 (7 r) | 18 (6 r) | 10 (3.3 r) | 7 (2.3 r) | 8 (2.7 r) | 9 (3 r) | 4 (1.3 r) | 7 (2.3 r) |
| Men-at-arms | 13 (3.3 r) | 10 (2.5 r) | 6 (1.5 r) | 5 (1.3 r) | 5 (1.3 r) | 6 (1.5 r) | 3 (0.8 r) | 5 (1.3 r) |
| Crossbows | 30 (15 r) | 27 (13.5 r) | 15 (7.5 r) | 11 (5.5 r) | 12 (6 r) | 14 (7 r) | 6 (3 r) | 11 (5.5 r) |
| Outriders | 8 (4 r) | 7 (3.5 r) | 4 (2 r) | 3 (1.5 r) | 3 (1.5 r) | 4 (2 r) | 2 (1 r) | 3 (1.5 r) |
| Peasants | 68 (17 r) | 63 (15.8 r) | 34 (8.5 r) | 27 (6.8 r) | 30 (7.5 r) | 32 (8 r) | 15 (3.8 r) | 27 (6.8 r) |

**Attacks needed: Undead Legion (rows, full squad, no losses) vs Kingdom (columns, full HP, no defends)** (rounds = attacks / hits per 100 AP)

| Attacker \ Target | The Chosen | Shieldwall | Men-at-arms | Crossbows | Outriders | Peasants |
| --- | --- | --- | --- | --- | --- | --- |
| Lich | 29 (7.3 r) | 39 (9.8 r) | 24 (6 r) | 17 (4.3 r) | 22 (5.5 r) | 7 (1.8 r) |
| Grave Guard | 33 (11 r) | 44 (14.7 r) | 30 (10 r) | 18 (6 r) | 27 (9 r) | 9 (3 r) |
| Skeleton Warriors | 26 (6.5 r) | 34 (8.5 r) | 24 (6 r) | 15 (3.8 r) | 20 (5 r) | 7 (1.8 r) |
| Skeleton Warband | 24 (6 r) | 31 (7.8 r) | 20 (5 r) | 13 (3.3 r) | 18 (4.5 r) | 6 (1.5 r) |
| Bone Archers | 52 (26 r) | 62 (31 r) | 40 (20 r) | 26 (13 r) | 36 (18 r) | 12 (6 r) |
| Wraiths | 10 (5 r) | 13 (6.5 r) | 9 (4.5 r) | 6 (3 r) | 8 (4 r) | 3 (1.5 r) |
| Necromancers | 44 (11 r) | 62 (15.5 r) | 40 (10 r) | 26 (6.5 r) | 36 (9 r) | 12 (3 r) |
| Skeleton Warband | 24 (6 r) | 31 (7.8 r) | 20 (5 r) | 13 (3.3 r) | 18 (4.5 r) | 6 (1.5 r) |

<!-- /GEN:derived -->

---

## 10. Economy

### 10.1 Resources, income, training *(generated)*

<!-- GEN:economy -->
| Faction | Resource | Start | HQ income/rnd | Gather (AP per 1 resource) | Builder gathering a full round | Buildable |
| --- | --- | --- | --- | --- | --- | --- |
| Kingdom | Gold | 0 | 6 | farm 8 (4 gatherers), mine 10 (2 gatherers) | farm ~12, mine ~10 | barracks, tower, farm, mine, banner, wall, forge, chapel |
| Undead Legion | Souls | 0 | 6 | - (no builders) | - | barracks, tower, well, monolith, wall, pit, sanctum |

Builders: Kingdom up to 10 peasant squads (not in the army cap); Undead 0 (buildings rise by themselves). HQ trains: Kingdom builder/fighter; Undead Legion swarm/mage.

**Training cost (resource) and time (rounds)**

| Role | Kingdom cost | Undead Legion cost | Rounds | Trained at |
| --- | --- | --- | --- | --- |
| builder | 10 | - | 1 | Keep (Kingdom only) |
| tank | 30 | 16 | 3 | Barracks / Ossuary |
| fighter | 24 | 9 | 2 | Barracks / Ossuary |
| swarm | - | 20 | 2 | Crypt and Ossuary (Undead only; a pair per training) |
| ranged | 26 | 13 | 2 | Barracks / Ossuary |
| fast | 30 | 16 | 2 | Barracks / Ossuary |
| mage | - | 22 | 2 | Ossuary (Undead only) |

Souls: every model that dies (either side, not summoned skeletons) on the undead side's grave ground pays 3 souls (a hero: 15); graveyards: hq 10", barracks 6", tower 6", monolith 6", wall 6", pit 6", sanctum 6", well 10" (a new site spreads 50 % at once and the rest by the end of the round; the Crypt starts at 10"). Pairs: Skeleton Warband x2.

**Undead death economy: souls back when a whole squad dies on your graves vs its cost** (both sides' deaths pay; the table uses undead squads)

| Role | Name | Tier rule | Models | Cost (per squad) | Souls back (per squad) | Back / cost |
| --- | --- | --- | --- | --- | --- | --- |
| tank | Grave Guard | high (cost may change) | 3 | 16 | 9 | 0.6x |
| fighter | Skeleton Warriors | low (cost fixed) | 5 | 9 | 15 | 1.7x |
| swarm | Skeleton Warband | low (cost fixed) | 5 | 10 | 15 | 1.5x |
| ranged | Bone Archers | low (cost fixed) | 4 | 13 | 12 | 0.9x |
| fast | Wraiths | high (cost may change) | 3 | 16 | 9 | 0.6x |
| mage | Necromancers | high (cost may change) | 2 | 22 | 6 | 0.3x |

Flat income: Crypt 6 a round, Soul Well 6 a round each. Kingdom deaths on undead graves pay the same per model (Kingdom Shieldwall 9, Men-at-arms 12, Crossbows 12, Outriders 9).
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
- **Undead (Souls): steady souls, plus the dead** (reworked 2026-11-25; Dawn of War points, Warcraft III
  haunted mines).
  - **Steady income:** the **Crypt +6** a round (`FACTIONS.undead.eco.hq`) and each **Soul Well +6** (the same as a Kingdom Mine) (`BUILDINGS.well.income`, on a resource site). Taking sites is how the Undead grow, like the Kingdom's mines.
  - **Deaths still pay:** every model that dies on either side (summoned skeletons excepted) **on the Undead side's grave ground** pays **`RULES.soulPerModel` = 3** souls (a hero **`soulPerHero`** = 15), credited at the end of the round where it fell (§10.4).
  - **Cheap squads profit:** the pay is per **model**, so cheap many-model squads give back **more than they cost** when they fall on graves: a Skeleton Warband squad has 5 models → 15 souls for 10 souls of cost (1.5×); Skeleton Warriors 1.7×. Elite few-model squads give back less (Grave Guard / Wraiths 0.6×, Necromancers 0.3×).
  - **Soul decay** (`RULES.soulKeep` = 80, `RULES.soulDecay` = 0.2): at the end of every round, after income, a bank above 80 souls loses `floor((bank − 80) × 0.2)`. A big fight still pays, but the bank can't snowball: spend it.
  - **Start:** 0 souls (both factions start at 0; before 2026-11-25: 90 souls / 60 gold). No gathering (no builders). In mirror Undead matches each side collects from deaths on its own graves.
- **Population and upkeep** (Dawn of War style, since 2026-11-25; `popCost` / `armySize` / `incomeParts` in
  `js/sim/base.js`):
  - **Population:** every squad costs **pop** (`FACTIONS.<f>.units.<role>.pop`): Warband (each squad of a
    pair), Skeleton Warriors, Bone Archers **1**; Men-at-arms, Crossbows, Wraiths, Necromancers **2**;
    Shieldwall, Outriders, Grave Guard **3**; heroes, peasants and summoned skeletons **0**. A Warband pair
    costs 2 (pop × pair). Squads in training count; queued ones don't.
  - **Population cap:** `RULES.armyCap` = **50** pop + the map's `capBonus` × 1.5 (Twin Rivers / Highland
    +6, Great Field +12). A training item waits ("population cap") while pop + its pop would pass it.
    The top bar shows "pop N / cap".
  - **Upkeep:** every round, `upkeep = min(flat income, floor(max(0, pop − RULES.upkeepFree) ×
    RULES.upkeepPerPop))` with `upkeepFree` = **8** and `upkeepPerPop` = **0.3** (e.g. 30 pop → −6 a
    round). It is taken from the **flat** income (HQ, Mines, Wells, Farms; before the Brutal ×), so income
    never goes below 0; **gathering and souls from deaths are not taxed**. It is the `upkeep` part of the
    income (with `pop`), a row in the Economy panel and in the log line. A big army costs economy; a small
    one lets the economy grow.
- **Cancelling a building under construction** (since 2026-11-25): the `cancelSites: [bid]` order (at most
  10; only own buildings with `build > 0`) removes the site at round start and refunds
  **`floor(cost × RULES.siteRefund)`** = **75 %** of its cost (Warcraft III / StarCraft style). Event
  `siteCancel`; builders working there go idle. The building panel of an own unfinished site has
  "✕ Cancel (refund N)" (tap again to keep building it). Waiting queue items and training / research
  still refund in full.
- **Undead costs may change** (owner, 2026-11-25; the old low-tier / high-tier cost rule is replaced). Elite squads are meant to lose value when they die, and the Warband must return more souls than it costs.
- **Income breakdown** (`incomeParts` in `js/sim/base.js`; the round's `income` event has `parts`):
  - **Parts:** the flat income by source (`hq`, `mine`, `well`, `farm`, `other`, with counts); `brutal` (the AI's extra); `gathered` (per building, from the peasants' `gather` events this round); `souls` from deaths (and the number of places); `decay`.
  - **The Economy panel** (`js/ui/economy.js`; tap the gold / souls counter on the top bar):
    - last round, source by source;
    - the next round's expected income (the flat income, plus each gather building's peasants × `floor(100 / gather rate)`, capped by its slots, plus the decay if nothing is spent);
    - every income building, with its peasants working.
  - **The building panel:** shows "pays +N a round, peasants working n / slots (≈ +x)".
  - **The log:** the income line lists the parts.

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
  population cap; queued squads do not. Stopping a squad in training refunds its full cost.
- **Population cap** (replaced the 30-squad army cap on 2026-11-25): `RULES.armyCap` = **50 pop** + the
  map's `capBonus` × 1.5 (Twin Rivers / Highland +6, Great Field +12). Squads cost their unit's pop
  (§10.2); **heroes, builders and summoned skeletons cost 0**; squads in training count (pop × pair).

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
   Each building keeps its own lock. The building panel's "pop N / cap" and "… after this round's starts"
   (the planner's forecast) include this round's repeat starts, including locks set this round.
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
| `hq` | Keep / Crypt | 0 | 0 | 0 | - | 660 | 198 | 8 | 4 x 4 | 10 | 3 x 4 = 12 raw, range 8" | - | trains kingdom: builder/fighter, undead: swarm/mage | kingdom, undead |
| `barracks` | Barracks / Ossuary | 30 | 240 | 2.4 | 3 | 450 | 135 | 8 | 3.5 x 2.5 | 6 | - | - | trains tank/fighter/swarm/ranged/fast | kingdom, undead |
| `tower` | Watchtower / Bone Spire | 25 | 200 | 2 | 3 | 330 | 99 | 6 | circle r 0.9 | 13 | 4 x 4 = 16 raw, range 11" | - | - | kingdom, undead |
| `banner` | Banner / Obelisk | 20 | 120 | 1.2 | - | 180 | 54 | 4 | circle r 0.55 | 6 | - | - | +1 CP | kingdom |
| `monolith` | Monolith / Monolith | 20 | 120 | 1.2 | 2 | 210 | 63 | 4 | circle r 0.6 | 7 | - | - | - | undead |
| `wall` | Palisade / Bone Fence | 6 | 60 | 0.6 | 1 | 240 | 72 | 6 | 3 x 0.5 | 0 | - | - | - | kingdom, undead |
| `farm` | Farm / Farm | 25 | 140 | 1.4 | - | 270 | 81 | 3 | 4.2 x 3.4 | 5 | - | 2 | 4 gatherers | kingdom |
| `mine` | Mine / Mine | 30 | 160 | 1.6 | - | 300 | 90 | 6 | circle r 1.1 | 7 | - | 6 | resource site only | kingdom |
| `forge` | Blacksmith / Blacksmith | 40 | 200 | 2 | - | 360 | 108 | 7 | 3.5 x 2.5 | 5 | - | - | - | kingdom |
| `chapel` | Chapel / Chapel | 35 | 160 | 1.6 | - | 300 | 90 | 6 | circle r 1 | 6 | - | - | - | kingdom |
| `pit` | Charnel Pit / Charnel Pit | 30 | 160 | 1.6 | 2 | 300 | 90 | 6 | 3 x 2.5 | 5 | - | - | - | undead |
| `sanctum` | Dark Sanctum / Dark Sanctum | 30 | 160 | 1.6 | 2 | 270 | 81 | 5 | circle r 1 | 7 | - | - | - | undead |
| `well` | Soul Well / Soul Well | 20 | 160 | 1.6 | 2 | 270 | 81 | 5 | circle r 1.1 | 7 | - | 6 | resource site only; +6 souls a round | undead |

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
- **No building within `RULES.enemyBuildGap` = 8″ of any enemy building** (since 2026-11-26; seen or not):
  "Too close to an enemy building (8″)". This stops tower or Barracks rushes next to an enemy base.
  History: 2026-11-25 it was 16″ from enemy buildings the side had seen, then with a home-ground
  exemption (the map zone around the own HQ) that reached the middle of small maps, so the AI built towers
  5–7″ from enemy towers; the owner replaced both with this plain 8″ rule. The red placement ghost can
  hint at an unseen enemy building nearby.
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
whose walk finds no path drops the task (`workFail`) instead of trying it again every round, and (since
2026-11-26) **skips that building for 4 rounds** (`q.noReach`): an approach spot can exist in a closed
pocket (a site squeezed between buildings and the board edge) that no path reaches; idle builders used to
pick it again every round and stand still.

### 11.5 Barracks / training buildings
The Keep trains builders (peasants); the **Crypt trains the Skeleton Warband swarm** (`FACTIONS.<f>.hqTrains`);
Barracks / Ossuary train tank, fighter, ranged, fast (the Ossuary also the swarm).
**Pairs:** a unit with `pair: 2` (the Skeleton Warband) spawns **2 squads** from one training (each a
full squad, each costing its pop; the queue waits unless 2 pop are free). One squad in training at a
time each, with up to 5 more queued (§10.3).

### 11.6 Tower and HQ fire (after all tiers)
Each finished Watchtower / Bone Spire / HQ picks the **nearest enemy squad** whose edge is within its
range and that it can see (same sight rules as §12, its own footprint excluded), and fires one shot:
raw damage = `fire.dmg × 4` (HQ 3 × 4 = 12, tower 4 × 4 = 16); the target's cover (ranged) and defends
apply. One shot per building per round.

---

### 11.7 Tech tree (`js/data/tech.js`; queue rules in `js/sim/base.js`)
- **The Tech tree screen:** every node shows a short **effect chip** (`TECH.<id>.chip`, e.g. "+15 % dmg"). Tapping a node opens a **detail panel**:
  - the full effect, cost, rounds and building;
  - requirements (✓ / ✗) and the doctrine pair;
  - a **Research** button (or why it can't be researched yet).

  It sits beside the tree on desktop and below it on phones. A tap no longer queues the research directly.
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
- **Harder unit unlocks** (since 2026-11-25, Age of Empires–style unit-line research): Tier 2 alone no
  longer unlocks the elite squads. Each needs its own **unlock research** at the Barracks / Ossuary after
  Tier 2 (`GATES` in `js/data/tech.js` names it; a gated card says "needs Shieldwall Drill"): Kingdom
  **Shieldwall Drill** (35, 2 rounds) → Shieldwall, **Outrider Stables** (45, 3) → Outriders; Undead
  **Grave Vigil** (25, 2) → Grave Guard, **Wraith Pact** (30, 3) → Wraiths, **Necromancer Circle**
  (35, 3) → Necromancers. The Barracks / Ossuary research in their training queue like tech buildings
  (one item at a time: research there pauses training).
- **A longer tree** (since 2026-11-25):
  - **Rising costs** (StarCraft +1 / +2 / +3): every weapon / armour line has a **level III** at Tier 3
    (Steel Weapons III / Plate Armour III 80, 4 rounds; Sharpened Bones III / Bone Plating III 55, 4),
    about ×1.6 the cost and +1 round of level II; it needs level II.
  - **Small upgrades** (cheap, 1–2 rounds, +5–10 % or +1): Whetstones, Padded Jacks, Hardy Peasants,
    Sharpened Picks (mines 9 AP a gold, `mineGather`), Masonry / Bone Masonry (+15 % building HP),
    Hoardings / Dread Spires (+1 tower and HQ fire damage, `fireAdd`), Horse Breeding / Hollow Bones /
    Spectral Speed (`move`), Grave Dust, Ossified Skin, Soul Conduits (Soul Wells +1, `wellIncome`).
  - **Ability upgrades** (middle of the tree; effect `addSkill` gives a unit a new skill, reusing existing
    skill kinds): Shield Drill (Men-at-arms: Lock Shields), Fire Arrows (Crossbows: Fire Volley, an
    Arrow Storm–type circle, 3 a model), Sweeping Blow (The Chosen: Sweep), Bone Shields (Skeleton
    Warriors: Grave Wall), Bone Spears (Bone Archers: Bone Spear, a Piercing Bolt–type line, 3.5 a
    model), Shadow Walk (Wraiths: Shadow Step). Squads use them like their own skills (orders, stances,
    auto skills).
  - The tree screen has a **Barracks / Ossuary lane** ("unit unlocks and drills"); every item has a chip.
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
**Kingdom** (`TECH` in `js/data/tech.js`). Gates: Shieldwall need Shieldwall Drill; Outriders need Outrider Stables; Blacksmith needs Castle; Chapel needs Castle.

| id | Name | Tier | At | Cost | Rounds | Needs | Doctrine | Effect |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `castle` | Castle | 2 | Keep | 60 | 3 | a Barracks | - | Tier 2: the Keep becomes a Castle (HP 900, stronger fire). Opens the unit unlocks (Shieldwall Drill, Outrider Stables), the Blacksmith, the Chapel and a doctrine. |
| `citadel` | Citadel | 3 | Keep | 100 | 4 | Castle, a Blacksmith or Chapel | - | Tier 3: the Citadel (HP 1200, fire 5, +1 command point). Unlocks the strongest research and the last doctrine. |
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
| `hospital` | Field Hospital | 2 | Chapel | 40 | 2 | Valour | - | Your squads within 4″ of a Chapel heal 9 HP per model a round. |
| `chosen` | Return of the Chosen | 3 | Chapel | 45 | 3 | Heroic Legend, Citadel | - | A fallen hero comes back after 2 rounds of holding its spot instead of 3. |
| `knightly` | Knightly Order | 2 | Keep | 40 | 2 | Castle | tier 2 pick | Doctrine: Outriders charge 40 % harder and get +2 armour. |
| `yeomanry` | Free Yeomanry | 2 | Keep | 40 | 2 | Castle | tier 2 pick | Doctrine: Crossbows reload faster (volley 35 AP); peasants +3 armour and hit harder. |
| `crusade` | Crusade | 3 | Keep | 70 | 3 | Citadel | tier 3 pick | Doctrine: all soldiers deal 10 % more damage and get +1 defend. |
| `fortress` | Fortress Realm | 3 | Keep | 70 | 3 | Citadel | tier 3 pick | Doctrine: buildings +30 % HP, towers +2″ range, Palisades need half the work. |
| `drill` | Shieldwall Drill | 2 | Barracks | 35 | 2 | Castle | - | Unlocks Shieldwall squads at the Barracks. |
| `stables` | Outrider Stables | 2 | Barracks | 45 | 3 | Castle | - | Unlocks Outriders at the Barracks. |
| `steel3` | Steel Weapons III | 3 | Blacksmith | 80 | 4 | Steel Weapons II | - | Soldiers deal another 15 % more damage. |
| `plate3` | Plate Armour III | 3 | Blacksmith | 80 | 4 | Plate Armour II | - | Soldiers +2 more armour. |
| `whetstones` | Whetstones | 1 | Barracks | 15 | 1 | - | - | Men-at-arms deal 10 % more damage. |
| `padded` | Padded Jacks | 1 | Barracks | 15 | 1 | - | - | Crossbows +1 armour. |
| `hardy` | Hardy Peasants | 1 | Keep | 15 | 1 | - | - | Peasants +6 HP per model. |
| `picks` | Sharpened Picks | 1 | Keep | 20 | 1 | - | - | Peasants mine faster: 9 AP per gold instead of 10. |
| `masonry` | Masonry | 2 | Keep | 35 | 2 | Castle | - | All your buildings +15 % HP. |
| `hoardings` | Hoardings | 2 | Blacksmith | 30 | 2 | - | - | Watchtowers and the Keep fire for +1 damage per shot. |
| `horses` | Horse Breeding | 2 | Barracks | 30 | 2 | Outrider Stables | - | Outriders move 1″ further a round. |
| `shielddrill` | Shield Drill | 2 | Barracks | 40 | 2 | Castle | - | Men-at-arms gain Lock Shields (hits from the front deal 30 % this round). |
| `firearrows` | Fire Arrows | 2 | Blacksmith | 45 | 3 | - | - | Crossbows gain Fire Volley: a circle of burning bolts (2.4 per model) within 14″, arcing over walls. |
| `sweeping` | Sweeping Blow | 2 | Chapel | 50 | 3 | - | - | The Chosen gains Sweep: a full circle swing (14) around him. |

**Undead Legion** (`TECH` in `js/data/tech.js`). Gates: Grave Guard need Grave Vigil; Wraiths need Wraith Pact; Necromancers need Necromancer Circle; Charnel Pit needs Mausoleum; Dark Sanctum needs Mausoleum.

| id | Name | Tier | At | Cost | Rounds | Needs | Doctrine | Effect |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `mausoleum` | Mausoleum | 2 | Crypt | 40 | 2 | a Ossuary | - | Tier 2: the Crypt becomes a Mausoleum (HP 900, graves 12″). Opens the unit unlocks (Grave Vigil, Wraith Pact, Necromancer Circle), the Charnel Pit, the Dark Sanctum and a doctrine. |
| `necropolis` | Necropolis | 3 | Crypt | 70 | 4 | Mausoleum, a Charnel Pit or Dark Sanctum | - | Tier 3: the Necropolis (HP 1140, graves 14″). Unlocks the strongest research and the last doctrine. |
| `restless` | Restless Earth | 1 | Crypt | 15 | 1 | - | - | Graves spread 25 % more where things die. |
| `harvest` | Soul Harvest | 2 | Crypt | 30 | 2 | Mausoleum | - | Every model dying on your graves gives +1 soul. |
| `blight` | Spreading Blight | 2 | Crypt | 25 | 2 | Restless Earth | - | Every Undead building spreads its graves 2″ further. |
| `massgraves` | Mass Graves | 3 | Crypt | 45 | 3 | Soul Harvest, Necropolis | - | Monoliths heal 6 more HP per model and spread graves 3″ further. |
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
| `bonetide` | Bone Tide | 2 | Crypt | 30 | 2 | Mausoleum | tier 2 pick | Doctrine: Warbands and Warriors +3 HP per model; Warriors train in 1 round. |
| `darkarts` | Dark Arts | 2 | Crypt | 30 | 2 | Mausoleum | tier 2 pick | Doctrine: the Lich and Necromancers regain 10 more mana a round; Dark Thunder hits 30 % harder. |
| `horde` | Endless Horde | 3 | Crypt | 60 | 3 | Necropolis | tier 3 pick | Doctrine: Summon Warband raises one more squad (the Lich 3, Necromancers 2). |
| `plague` | Plague of Graves | 3 | Crypt | 60 | 3 | Necropolis | tier 3 pick | Doctrine: enemy squads standing on your graves lose 1 HP per model at the end of every round. |
| `vigil` | Grave Vigil | 2 | Ossuary | 25 | 2 | Mausoleum | - | Unlocks Grave Guard at the Ossuary. |
| `pact` | Wraith Pact | 2 | Ossuary | 30 | 3 | Mausoleum | - | Unlocks Wraiths at the Ossuary. |
| `circle` | Necromancer Circle | 2 | Ossuary | 35 | 3 | Mausoleum | - | Unlocks Necromancers at the Crypt. |
| `bones3` | Sharpened Bones III | 3 | Charnel Pit | 55 | 4 | Sharpened Bones II | - | Skeletons deal another 15 % more damage. |
| `plating3` | Bone Plating III | 3 | Charnel Pit | 55 | 4 | Bone Plating II | - | Skeletons +1 more armour. |
| `dust` | Grave Dust | 1 | Crypt | 10 | 1 | - | - | Skeleton Warbands deal 10 % more damage. |
| `ossified` | Ossified Skin | 1 | Ossuary | 10 | 1 | - | - | Skeleton Warriors +1 armour. |
| `hollow` | Hollow Bones | 1 | Ossuary | 10 | 1 | - | - | Bone Archers move 0.6″ further a round. |
| `conduits` | Soul Conduits | 1 | Crypt | 20 | 1 | - | - | Soul Wells earn +1 soul a round. |
| `bonemason` | Bone Masonry | 2 | Crypt | 30 | 2 | Mausoleum | - | All your buildings +15 % HP. |
| `dread` | Dread Spires | 2 | Charnel Pit | 25 | 2 | - | - | Bone Spires and the Crypt fire for +1 damage per shot. |
| `spectral` | Spectral Speed | 2 | Ossuary | 25 | 2 | Wraith Pact | - | Wraiths move 1″ further a round. |
| `boneshields` | Bone Shields | 2 | Ossuary | 30 | 2 | Mausoleum | - | Skeleton Warriors gain Grave Wall (hits from the front deal 30 % this round). |
| `bonespears` | Bone Spears | 2 | Charnel Pit | 35 | 3 | - | - | Bone Archers gain Bone Spear: a line that hits every enemy on it (2.8 per model), 15″. |
| `shadowwalk` | Shadow Walk | 2 | Dark Sanctum | 45 | 3 | Wraith Pact | - | Wraiths gain Shadow Step: vanish and reappear up to 6″ away, no parting blows. |

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
| Crossing | `crossing` | 48 x 32 | 16" (player 1: x > 32) | 50 | 9, 16, 23 | 4 | 24: 7/3, 25/3 | 0 |
| Twin Rivers | `twinrivers` | 64 x 40 | 21" (player 1: x > 43) | 56 | 10, 20, 30 | 6 | 22: 9/3, 29/3; 42: 31/3, 11/3 | 0 |
| Highland Ruins | `highland` | 64 x 44 | 21" (player 1: x > 43) | 56 | 11, 22, 33 | 6 | - | 1 |
| Great Field | `greatfield` | 80 x 52 | 27" (player 1: x > 53) | 62 | 12, 26, 40 | 8 | 40: 8/3, 26/3.4, 44/3 | 2 |

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
  - **attack** (from the personality's first-attack round and army size): aggression × min(2.2, attack ratio / (attackRatio + skill edge)), + 0.4 with 18+ squads, + 0.3 from round 30, + 0.6 when its population is at 85 %+ of the cap (a maxed army can't grow, so it is used).
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
  - **Only visible enemies** (since 2026-11-26): targets, the locked-in-melee check and `autoSkills` use the
    enemies visible now, not remembered ones (a strike at a hidden squad's id is rejected by the sim).
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

- **Kingdom opening** (since 2026-11-26; both sides start at 0): a 2nd peasant first (priority 140 while
  it has fewer than 2 and isn't threatened), then the first Mine (125) before the first Barracks (118
  until a Mine stands, else 135).
- **Research lists** (§14.9) now include the unit unlocks, level III lines, small and ability upgrades,
  and a list for the Barracks / Ossuary (unlocks first for the roles the personality's mix wants). Gated
  roles are not trained until their unlock is done (`gateOf`).
- **Population:** the cap check uses `popCost` (pop × pair); the AI never cancels sites.
- **Unplaceable sites:** the site request is only "ready" when a free seen site can be placed; a ready
  request whose placement fails holds its cost back only in the first 8 rounds (before, an unplaceable
  first Mine held 30 gold for the whole game and starved the army).
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
  - **The population cap** is respected (`popCost`: pop × pair).

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

## 15b. Results screen and battle statistics (`js/sim/stats.js`, `js/ui/results.js`)
Since 2026-11-26. **Recorded by the sim** at the end of every round (`recordStats`, called last in
`resolveRound`), so it is deterministic, part of the state, the same for both online players, and
readable by tools: `s.stats = { rounds: [{ r, p: [side0, side1] }], tech: [[{ id, r }], ...] }`. Each side
is an array in `STAT_KEYS` order (compact, since the host sends the state every round; about 11 KB for a
90-round game); read with `statOf(entry, p, key)` / `statSeries(s, key, p)`.

| Key | Meaning (per side, for that round) |
|---|---|
| `income` | this round's income: the `income` event's amount + gathering + souls from deaths − decay |
| `bank` / `spent` | resource at the end of the round / spent this round (start bank + income − end bank; refunds lower it; never below 0) |
| `earned` / `spentTotal` | cumulative income / spending |
| `pop` / `squads` | population (§10.2) / army squads alive (no peasants or summons) |
| `trained` / `lost` / `kills` | cumulative squads trained (`spawn`, no summons or revived heroes) / own squads destroyed / enemy squads destroyed (summoned skeletons count for neither) |
| `models` | cumulative enemy models killed (`lost` of hits by this side) |
| `buildings` / `built` / `razed` | finished buildings standing / cumulative finished (incl. instant ones) / enemy buildings destroyed |
| `research` | research finished; `stats.tech[p]` lists each with its round |
| `dmgUnits` / `dmgBuildings` | cumulative damage dealt to enemy squads / buildings (by the hit's source owner; tower and HQ fire included) |

**The results screen** opens when the battle ends (instead of the old Victory card):
- **Header:** the result, the reason, the rounds played, the AI level.
- **Summary table:** both sides; the better value of each row in bold.
- **Graph tabs**, each a line chart per round with one line per side (blue: you, orange: the other side):
  - **Economy:** income a round, total earned.
  - **Units:** population, army squads.
  - **Kills:** squads, models.
  - **Buildings:** standing, enemy destroyed.
  - **Research:** done, plus a timeline of what each side researched and when.
  - **Damage:** to squads, to buildings.
- **Reading the graphs:** hover or tap shows the round's values.
- **Buttons:** "View the battlefield" closes it, and a Results button (in the Tech tree button's place) reopens it; "Play again".
- **Fog:** the enemy's numbers are shown in full once the battle is over (as in RTS score screens).

## 16. Balance status

<!-- BALANCE -->
_Latest run: 2026-11-26, after **HP ×1.5 for units and buildings** (The Chosen excepted), **ranged squads 2
volleys a round and −20 % damage**, **stronger Kingdom melee** (Men-at-arms 6, Shieldwall 4.8, Outriders
armour 6), **strikes that land** (fallback targets, chase), **the 8″ no-build zone** from every enemy
building, and AI fixes (visible-only strikes, Kingdom opening, unreachable sites). AI matchup table
regenerated. `node tools/balance.mjs --games 8` (16 games per map, new AI at Normal both sides, random
personalities; 100-round cap) and `node tools/balance.mjs --vs legacy --games 8`._

**Faction balance, new AI vs new AI:**

| Map | Kingdom wins | Undead wins | Unfinished | Rounds (avg / median / min / max) | How games ended |
|---|---|---|---|---|---|
| Crossing | 3 (19 %) | 13 (81 %) | 0 | 68.0 / 70 / 40 / 89 | HQ destroyed 16 |
| Twin Rivers | 6 (50 %) | 6 (50 %) | 4 | 84.1 / 88 / 63 / 98 | HQ 12, unfinished 4 |
| Highland Ruins | 3 (30 %) | 7 (70 %) | 6 | 79.7 / 80 / 56 / 100 | HQ 10, unfinished 6 |
| Great Field | 4 (57 %) | 3 (43 %) | 9 | 86.6 / 90 / 62 / 94 | HQ 7, unfinished 9 |
| **All** | **16 (36 %)** | **29 (64 %)** | **19 of 64** | | |

**The new AI against the old AI:** as Kingdom 27 / 64 (42 %: Crossing 3, Twin Rivers 14, Highland 3, Great
Field 7 of 16), as Undead 54 / 64 (84 %).

**What changed in the fights (AI-vs-AI, 4 games, same seeds before / after):**

| Measure | Before | After |
|---|---|---|
| Ranged squads' share of all damage | 78 % (Crossbows 43, Bone Archers 35) | **41 %** (Crossbows 19, Bone Archers 22) |
| Melee squads' share (Men-at-arms, Warbands, Warriors) | ~10 % | **39 %** (Men-at-arms 33) |
| Warband: rounds alive after its first hit (median) / dead the same round | 2 / 34 % | **3 / 15 %** |
| Men-at-arms: rounds alive after the first hit (median) | 4 | **6** |
| Strikes that miss (AI games) | 32 % | **6 %** |

**What the numbers say (2026-11-26):**
- **Fights last about 1.5× longer and ranged fire no longer decides everything**, as asked.
- **The Undead lead** (25 / 37 → 22 / 24 → **16 / 29**):
  - The Crossbows carried the Kingdom (in equal-cost duels they beat almost every Undead squad). Without that, the Undead's half-price squads and ~40 free summoned squads a game win most fights.
  - Stronger Kingdom melee (owner's pick) brought the Kingdom from 2 of 10 to about a third of decided games.
  - Even on Twin Rivers and Great Field; Undead-favoured on Crossing (13 / 3) and Highland (7 / 3).
- **Games are long:** 19 of 64 hit the 100-round cap, mostly on the big maps (sturdier buildings too).
- **The new AI as Kingdom loses to the old AI on Crossing and Highland** (3 / 16 each); as Undead it wins 54 / 64. The cause is faction balance (the Kingdom also loses those maps in mirror games), not the AI; the AI test now checks the Undead side only.
- **Possible next levers (the owner decides):**
  - **Summons:** life 3 → 2 rounds, or the summon count.
  - **Kingdom costs:** about −15 %.
  - **More Kingdom buffs:** Men-at-arms +1 armour, Crossbows back to 3 a model.
  - **Upkeep:** lower it to shorten games.

<details><summary>Full report, new AI vs new AI (per faction: buildings finished, squads trained, income, gathering, souls, HQ found, per unit type damage dealt / taken / models lost / squads lost)</summary>

```
Balance report 2026-11-26 · 8 seeds x 2 orders per map · AI normal · stop at round 100

## crossing: 16 games · Kingdom 3 (19% of decided) · Undead 13 (81%) · draws 0 · unfinished 0
   personalities (new AI): warlord 1/5, blightlord 5/6, bonetide 4/5, smithking 1/6, necrarch 4/5, steward 1/5
   rounds (decided): avg 68.0, median 70, min 40, max 89 · ends: {"hq destroyed":16}
   kingdom: built/game {"mine":1.8,"barracks":2.1,"farm":1.8,"banner":1.4,"tower":1.7,"wall":1.6,"forge":0.3,"chapel":0.2} · trained/game {"builder":4.4,"fighter":15.1,"ranged":9.1}
      income/game 964.3 · gathered/game 557.2 · souls/game 0.0 · found enemy HQ in 10/16 games, avg round 28.8
      per unit type (per game): builder dealt 0.3 taken 492.1 models lost 9.7 squads lost 4.8 trained 4.4 | fighter dealt 3799.4 taken 3648.2 models lost 59.4 squads lost 14.6 trained 15.1 | hero dealt 697.5 taken 263.5 models lost 1.0 squads lost 1.0 trained 0.0 | ranged dealt 4391.8 taken 1212.3 models lost 25.4 squads lost 5.9 trained 9.1
   undead: built/game {"wall":4.9,"monolith":3.8,"well":4,"barracks":2.5,"tower":2.6,"pit":0.9,"sanctum":0.8} · trained/game {"swarm":19.6,"summon":32.8,"ranged":19.4,"fighter":7.6,"mage":4.9,"fast":0.4}
      income/game 928.0 · gathered/game 0.0 · souls/game 817.6 · found enemy HQ in 13/16 games, avg round 56.0
      per unit type (per game): fast dealt 25.3 taken 50.6 models lost 1.1 squads lost 0.4 trained 0.4 | fighter dealt 1256.7 taken 730.8 models lost 20.6 squads lost 2.5 trained 7.6 | hero dealt 924.7 taken 244.1 models lost 0.4 squads lost 0.4 trained 0.0 | mage dealt 330.1 taken 99.6 models lost 2.8 squads lost 1.4 trained 4.9 | ranged dealt 5381.1 taken 778.2 models lost 19.2 squads lost 3.6 trained 19.4 | summon dealt 1188.6 taken 1513.2 models lost 60.4 squads lost 14.1 trained 32.8 | swarm dealt 1621.6 taken 2617.4 models lost 110.1 squads lost 18.1 trained 19.6

## twinrivers: 16 games · Kingdom 6 (50% of decided) · Undead 6 (50%) · draws 0 · unfinished 4
   personalities (new AI): warlord 2/5, blightlord 1/6, bonetide 2/5, smithking 2/6, necrarch 3/5, steward 2/5
   rounds (decided): avg 84.1, median 88, min 63, max 98 · ends: {"hq destroyed":12,"unfinished":4}
   kingdom: built/game {"mine":3.6,"farm":2,"barracks":1.6,"banner":1.4,"wall":3.5,"tower":2.8,"forge":0.6,"chapel":0.5} · trained/game {"builder":8.3,"fighter":23.1,"fast":2.1,"ranged":15.4,"tank":0.1}
      income/game 1713.9 · gathered/game 626.2 · souls/game 0.0 · found enemy HQ in 9/16 games, avg round 46.7
      per unit type (per game): builder dealt 0.4 taken 663.2 models lost 13.1 squads lost 6.4 trained 8.3 | fast dealt 855.1 taken 293.7 models lost 3.9 squads lost 1.1 trained 2.1 | fighter dealt 8201.8 taken 5153.6 models lost 83.4 squads lost 19.8 trained 23.1 | hero dealt 724.4 taken 264.6 models lost 0.9 squads lost 0.9 trained 0.0 | ranged dealt 7272.8 taken 1786.1 models lost 38.2 squads lost 9.1 trained 15.4 | tank dealt 0.0 taken 0.0 models lost 0.0 squads lost 0.0 trained 0.1
   undead: built/game {"wall":7.5,"monolith":6.5,"well":6.9,"barracks":2.3,"tower":6.1,"pit":0.8,"sanctum":0.8} · trained/game {"swarm":29.4,"summon":40.3,"ranged":28.3,"fighter":10.7,"mage":6.1,"fast":0.3}
      income/game 1176.0 · gathered/game 0.0 · souls/game 1349.9 · found enemy HQ in 9/16 games, avg round 67.3
      per unit type (per game): fast dealt 13.4 taken 42.3 models lost 1.0 squads lost 0.3 trained 0.3 | fighter dealt 1422.8 taken 1558.4 models lost 46.4 squads lost 6.5 trained 10.7 | hero dealt 538.1 taken 305.6 models lost 0.9 squads lost 0.9 trained 0.0 | mage dealt 921.1 taken 188.2 models lost 5.0 squads lost 2.1 trained 6.1 | ranged dealt 7330.8 taken 2300.6 models lost 64.7 squads lost 13.3 trained 28.3 | summon dealt 1364.4 taken 1944.4 models lost 78.2 squads lost 16.4 trained 40.3 | swarm dealt 1305.6 taken 3636.0 models lost 154.6 squads lost 28.1 trained 29.4

## highland: 16 games · Kingdom 3 (30% of decided) · Undead 7 (70%) · draws 0 · unfinished 6
   personalities (new AI): warlord 1/5, blightlord 2/6, bonetide 2/5, smithking 1/6, necrarch 3/5, steward 1/5
   rounds (decided): avg 79.7, median 80, min 56, max 100 · ends: {"hq destroyed":10,"unfinished":6}
   kingdom: built/game {"mine":3.1,"barracks":1.6,"farm":2.1,"tower":3.3,"wall":2.1,"banner":1.2,"forge":0.4,"chapel":0.2} · trained/game {"builder":10.4,"fighter":22.4,"ranged":15.8,"fast":0.3,"tank":0.4}
      income/game 1416.8 · gathered/game 830.3 · souls/game 0.0 · found enemy HQ in 7/16 games, avg round 34.6
      per unit type (per game): builder dealt 1.7 taken 871.3 models lost 17.4 squads lost 8.6 trained 10.4 | fast dealt 88.6 taken 55.2 models lost 0.8 squads lost 0.3 trained 0.3 | fighter dealt 6446.7 taken 5183.3 models lost 84.3 squads lost 20.5 trained 22.4 | hero dealt 563.8 taken 262.6 models lost 1.0 squads lost 1.0 trained 0.0 | ranged dealt 7022.6 taken 2001.4 models lost 42.4 squads lost 9.8 trained 15.8 | tank dealt 63.0 taken 104.3 models lost 1.0 squads lost 0.3 trained 0.4
   undead: built/game {"wall":8.5,"monolith":6.1,"well":5.3,"barracks":2.2,"tower":6.1,"pit":1.1,"sanctum":0.7} · trained/game {"swarm":26,"summon":42.4,"ranged":26.3,"fighter":9.6,"mage":7.1,"fast":0.9}
      income/game 1155.1 · gathered/game 0.0 · souls/game 1183.2 · found enemy HQ in 12/16 games, avg round 52.7
      per unit type (per game): fast dealt 186.4 taken 129.4 models lost 2.6 squads lost 0.6 trained 0.9 | fighter dealt 1391.6 taken 1178.0 models lost 34.5 squads lost 4.8 trained 9.6 | hero dealt 661.7 taken 313.5 models lost 0.8 squads lost 0.8 trained 0.0 | mage dealt 904.8 taken 238.3 models lost 6.4 squads lost 2.9 trained 7.1 | ranged dealt 7553.1 taken 1654.3 models lost 45.3 squads lost 8.6 trained 26.3 | summon dealt 1380.0 taken 2127.9 models lost 84.6 squads lost 17.2 trained 42.4 | swarm dealt 1423.4 taken 2935.1 models lost 122.9 squads lost 22.4 trained 26.0

## greatfield: 16 games · Kingdom 4 (57% of decided) · Undead 3 (43%) · draws 0 · unfinished 9
   personalities (new AI): warlord 3/5, blightlord 2/6, bonetide 0/5, smithking 1/6, necrarch 1/5, steward 0/5
   rounds (decided): avg 86.6, median 90, min 62, max 94 · ends: {"hq destroyed":7,"unfinished":9}
   kingdom: built/game {"mine":4.6,"barracks":2,"farm":2.4,"banner":1.4,"forge":0.4,"tower":3,"wall":1.9,"chapel":0.1} · trained/game {"builder":7.1,"fighter":27.4,"fast":1,"ranged":20.8,"tank":0.4}
      income/game 2255.0 · gathered/game 512.3 · souls/game 0.0 · found enemy HQ in 10/16 games, avg round 45.5
      per unit type (per game): builder dealt 1.4 taken 531.1 models lost 10.3 squads lost 5.1 trained 7.1 | fast dealt 463.4 taken 162.2 models lost 2.2 squads lost 0.7 trained 1.0 | fighter dealt 9001.3 taken 5814.8 models lost 94.2 squads lost 22.3 trained 27.4 | hero dealt 630.3 taken 261.6 models lost 1.0 squads lost 1.0 trained 0.0 | ranged dealt 8726.7 taken 2441.0 models lost 51.9 squads lost 12.4 trained 20.8 | tank dealt 20.4 taken 117.6 models lost 1.1 squads lost 0.4 trained 0.4
   undead: built/game {"wall":11.8,"monolith":5.8,"well":8.2,"barracks":2.5,"tower":7.4,"pit":1.1,"sanctum":0.8} · trained/game {"swarm":25.1,"summon":44,"ranged":32.4,"fighter":15.3,"mage":9.3,"fast":0.5}
      income/game 1566.9 · gathered/game 0.0 · souls/game 1441.6 · found enemy HQ in 10/16 games, avg round 50.2
      per unit type (per game): fast dealt 13.6 taken 67.3 models lost 1.5 squads lost 0.5 trained 0.5 | fighter dealt 1965.8 taken 2049.1 models lost 58.8 squads lost 7.7 trained 15.3 | hero dealt 448.6 taken 302.3 models lost 0.9 squads lost 0.9 trained 0.0 | mage dealt 950.8 taken 264.1 models lost 6.3 squads lost 2.4 trained 9.3 | ranged dealt 6760.5 taken 2437.1 models lost 69.2 squads lost 14.1 trained 32.4 | summon dealt 1124.0 taken 1998.0 models lost 78.6 squads lost 15.0 trained 44.0 | swarm dealt 1211.1 taken 3026.6 models lost 128.2 squads lost 24.6 trained 25.1
```
</details>

<details><summary>Full report, new AI vs the legacy AI</summary>

```
Balance report 2026-11-26 · 8 seeds x 2 orders per map x 2 (new AI on each side vs the legacy AI) · AI normal · stop at round 100

## crossing: 32 games · Kingdom 3 (9% of decided) · Undead 29 (91%) · draws 0 · unfinished 0
   new AI vs legacy: as kingdom 3/16 (19%) · as undead 16/16 (100%)
   personalities (new AI): warlord 2/5, blightlord 6/6, bonetide 5/5, smithking 0/6, necrarch 5/5, steward 1/5
   rounds (decided): avg 60.3, median 58, min 43, max 81 · ends: {"hq destroyed":32}
   kingdom: built/game {"mine":1.6,"barracks":2,"farm":2.3,"banner":1.5,"wall":2.7,"tower":1.5,"forge":0.3,"chapel":0.1} · trained/game {"builder":8,"fighter":13.8,"ranged":6.1,"fast":0.2}
      income/game 737.9 · gathered/game 516.4 · souls/game 0.0 · found enemy HQ in 22/32 games, avg round 17.5
      per unit type (per game): builder dealt 0.8 taken 774.7 models lost 17.0 squads lost 8.5 trained 8.0 | fast dealt 40.3 taken 38.2 models lost 0.6 squads lost 0.2 trained 0.2 | fighter dealt 4312.1 taken 3284.7 models lost 53.7 squads lost 13.2 trained 13.8 | hero dealt 636.9 taken 261.9 models lost 1.0 squads lost 1.0 trained 0.0 | ranged dealt 1215.1 taken 1082.2 models lost 23.5 squads lost 5.8 trained 6.1
   undead: built/game {"wall":3.8,"well":3.2,"barracks":2.3,"tower":2.2,"monolith":5.9,"pit":0.9,"sanctum":0.8} · trained/game {"summon":25.4,"swarm":39.2,"fighter":3.9,"ranged":10,"mage":1.9}
      income/game 835.7 · gathered/game 0.0 · souls/game 757.8 · found enemy HQ in 30/32 games, avg round 43.4
      per unit type (per game): fighter dealt 813.7 taken 328.4 models lost 8.9 squads lost 1.3 trained 3.9 | hero dealt 634.3 taken 240.2 models lost 0.6 squads lost 0.6 trained 0.0 | mage dealt 228.7 taken 3.9 models lost 0.0 squads lost 0.0 trained 1.9 | ranged dealt 3033.7 taken 118.3 models lost 2.6 squads lost 0.3 trained 10.0 | summon dealt 1488.2 taken 910.7 models lost 35.8 squads lost 10.0 trained 25.4 | swarm dealt 5119.2 taken 3296.0 models lost 129.7 squads lost 21.1 trained 39.2

## twinrivers: 32 games · Kingdom 14 (50% of decided) · Undead 14 (50%) · draws 0 · unfinished 4
   new AI vs legacy: as kingdom 14/16 (88%) · as undead 14/16 (88%)
   personalities (new AI): warlord 4/5, blightlord 5/6, bonetide 5/5, smithking 5/6, necrarch 4/5, steward 5/5
   rounds (decided): avg 69.0, median 70, min 43, max 93 · ends: {"hq destroyed":28,"unfinished":4}
   kingdom: built/game {"mine":2.9,"farm":2.3,"barracks":2.1,"wall":1.7,"banner":1.5,"tower":2,"forge":0.4,"chapel":0.3} · trained/game {"builder":9.7,"fighter":22.8,"ranged":10.5}
      income/game 1173.9 · gathered/game 668.1 · souls/game 0.0 · found enemy HQ in 28/32 games, avg round 37.7
      per unit type (per game): builder dealt 1.2 taken 701.7 models lost 15.3 squads lost 7.5 trained 9.7 | fighter dealt 8679.7 taken 4143.6 models lost 66.3 squads lost 15.5 trained 22.8 | hero dealt 600.7 taken 251.0 models lost 0.9 squads lost 0.9 trained 0.0 | ranged dealt 2884.3 taken 1225.3 models lost 26.3 squads lost 6.4 trained 10.5
   undead: built/game {"wall":7.8,"well":4.3,"barracks":2,"tower":3.8,"pit":0.8,"monolith":4.9,"sanctum":0.6} · trained/game {"swarm":44,"summon":27.2,"fighter":4.9,"ranged":13.3,"mage":3.9}
      income/game 1038.8 · gathered/game 0.0 · souls/game 1037.2 · found enemy HQ in 18/32 games, avg round 37.6
      per unit type (per game): fighter dealt 968.7 taken 740.8 models lost 21.4 squads lost 3.3 trained 4.9 | hero dealt 529.8 taken 282.3 models lost 0.8 squads lost 0.8 trained 0.0 | mage dealt 472.0 taken 42.3 models lost 0.9 squads lost 0.4 trained 3.9 | ranged dealt 4085.0 taken 457.0 models lost 11.9 squads lost 2.2 trained 13.3 | summon dealt 1274.3 taken 933.5 models lost 36.2 squads lost 8.9 trained 27.2 | swarm dealt 2941.5 taken 5119.5 models lost 204.5 squads lost 38.0 trained 44.0

## highland: 32 games · Kingdom 7 (27% of decided) · Undead 19 (73%) · draws 0 · unfinished 6
   new AI vs legacy: as kingdom 3/16 (19%) · as undead 11/16 (69%)
   personalities (new AI): warlord 2/5, blightlord 2/6, bonetide 5/5, smithking 1/6, necrarch 4/5, steward 0/5
   rounds (decided): avg 71.0, median 79, min 27, max 98 · ends: {"hq destroyed":26,"unfinished":6}
   kingdom: built/game {"mine":2.4,"barracks":1.9,"farm":2.4,"wall":2.3,"tower":2.6,"banner":1.6,"forge":0.4,"chapel":0.2} · trained/game {"builder":9.3,"fighter":22.2,"ranged":11.4}
      income/game 1160.1 · gathered/game 658.3 · souls/game 0.0 · found enemy HQ in 18/32 games, avg round 33.8
      per unit type (per game): builder dealt 1.4 taken 757.0 models lost 16.1 squads lost 7.9 trained 9.3 | fighter dealt 6638.9 taken 4878.8 models lost 79.1 squads lost 19.3 trained 22.2 | hero dealt 527.8 taken 238.5 models lost 0.9 squads lost 0.9 trained 0.0 | ranged dealt 4494.2 taken 1593.1 models lost 34.8 squads lost 8.8 trained 11.4
   undead: built/game {"wall":5.5,"well":3.8,"barracks":2.5,"tower":3.6,"monolith":7.3,"pit":0.8,"sanctum":0.7} · trained/game {"summon":25.3,"swarm":64.6,"fighter":5.3,"ranged":10.7,"mage":2.5}
      income/game 981.0 · gathered/game 0.0 · souls/game 1319.1 · found enemy HQ in 29/32 games, avg round 43.7
      per unit type (per game): fighter dealt 1134.0 taken 696.9 models lost 19.9 squads lost 2.8 trained 5.3 | hero dealt 510.8 taken 230.5 models lost 0.6 squads lost 0.6 trained 0.0 | mage dealt 278.7 taken 9.8 models lost 0.1 squads lost 0.0 trained 2.5 | ranged dealt 3524.5 taken 238.4 models lost 6.0 squads lost 0.9 trained 10.7 | summon dealt 987.0 taken 873.0 models lost 33.5 squads lost 8.5 trained 25.3 | swarm dealt 5927.4 taken 6393.0 models lost 250.4 squads lost 43.9 trained 64.6

## greatfield: 32 games · Kingdom 8 (35% of decided) · Undead 15 (65%) · draws 0 · unfinished 9
   new AI vs legacy: as kingdom 7/16 (44%) · as undead 13/16 (81%)
   personalities (new AI): warlord 4/5, blightlord 5/6, bonetide 5/5, smithking 3/6, necrarch 3/5, steward 0/5
   rounds (decided): avg 78.0, median 79, min 35, max 98 · ends: {"hq destroyed":23,"unfinished":9}
   kingdom: built/game {"mine":3.9,"barracks":2.4,"farm":2.5,"banner":1.5,"wall":1.8,"tower":2.7,"forge":0.5,"chapel":0.3} · trained/game {"builder":11.2,"fighter":24.4,"ranged":16}
      income/game 1504.3 · gathered/game 694.4 · souls/game 0.0 · found enemy HQ in 25/32 games, avg round 40.6
      per unit type (per game): builder dealt 1.7 taken 803.6 models lost 17.6 squads lost 8.7 trained 11.2 | fighter dealt 8577.3 taken 4926.3 models lost 79.5 squads lost 19.1 trained 24.4 | hero dealt 571.4 taken 250.6 models lost 0.9 squads lost 0.9 trained 0.0 | ranged dealt 4837.6 taken 1853.9 models lost 39.9 squads lost 9.9 trained 16.0
   undead: built/game {"wall":7.9,"well":4.9,"barracks":2.7,"monolith":7.3,"pit":0.9,"sanctum":0.7,"tower":4.2} · trained/game {"swarm":64,"fighter":6.9,"summon":29,"ranged":16.4,"mage":4.1}
      income/game 1376.0 · gathered/game 0.0 · souls/game 1328.3 · found enemy HQ in 21/32 games, avg round 48.0
      per unit type (per game): fighter dealt 1224.6 taken 889.7 models lost 25.7 squads lost 3.7 trained 6.9 | hero dealt 366.1 taken 238.2 models lost 0.8 squads lost 0.8 trained 0.0 | mage dealt 304.7 taken 17.9 models lost 0.3 squads lost 0.1 trained 4.1 | ranged dealt 5022.7 taken 502.6 models lost 12.1 squads lost 1.7 trained 16.4 | summon dealt 1080.7 taken 915.1 models lost 35.2 squads lost 8.8 trained 29.0 | swarm dealt 4127.6 taken 7111.2 models lost 285.8 squads lost 53.4 trained 64.0
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
- With big armies (up to 50 pop) the nameplates crowd the screen (part of the phone / tablet layout to-do).
- Since start-at-0 and upkeep (2026-11-25), many AI games on the big maps run past 100 rounds, and the AI rarely trains elite squads (their unlock research comes late).

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
| Durability | every `hpPer` and `BUILDINGS.<type>.hp` (×2 on 2026-11-24, ×1.5 on 2026-11-26; The Chosen 260 kept), heals (Monolith 12, Field Hospital 9, Mass Graves +6, Reassemble 3), HP research (Hardy Peasants +6, Bone Tide +3), tier HQ HP in `tech.js`; AI `PRIOR` 450 in `js/ai/learning.js` | how many rounds a fight lasts |
| Ranged squads | `VOLLEY(ap, dmg, ...)` of Crossbows / Bone Archers (40 AP: 2 volleys a round; 2.7 / 1.9 a model since 2026-11-26), their skills, Free Yeomanry `attackAp` 35 | the ranged share of damage (78 % of all damage before the cut) |
| Movement (inches per 100 AP) | `FACTIONS.<f>.units.<role>.move` (default tier × `RULES.moveFactor` × 100: Crossbows 4.8, Wraiths 9); tech `move` effects | how far a squad walks; tier only sets initiative |
| Battle statistics (results screen) | `STAT_KEYS` / `recordStats` in `js/sim/stats.js`; the screen and its tabs in `js/ui/results.js` (`TABS`) | what is recorded each round and which graphs are shown (no effect on play) |
| Population and upkeep | `FACTIONS.<f>.units.<role>.pop` (the `POP` table in `units.js`: 1 / 2 / 3; heroes, builders, summons 0), `RULES.armyCap` (pop cap 50; maps + capBonus × 1.5), `RULES.upkeepPerPop` 0.3, `RULES.upkeepFree` 8 | army size and how much a big army slows the economy |
| Cancel refund | `RULES.siteRefund` 0.75 | refund for cancelling an unfinished building |
| Unit unlock research | `GATES` and the `drill` / `stables` / `vigil` / `pact` / `circle` items in `js/data/tech.js` | when elite squads appear |
| Small / level III / ability upgrades | `TECH` in `js/data/tech.js` (effects `move`, `addSkill`, `fireAdd`, `mineGather`, `wellIncome` besides the older ones) | the longer tree |
| Training time, caps, souls, sites, work reach | `RULES.trainRounds`, `armyCap`, `maxBuilders`, `gatherSlots`, `maxBannerCp`, `maxFarms`, `soulRange`, `soulPerModel`, `soulPerHero`, `siteHp`, `workReach` | |
| Faction identity | `FACTIONS.<f>.hqTrains` (what the HQ trains), `FACTIONS.<f>.maxBuilders` (Kingdom 10, Undead 0), `FACTIONS.undead.rises` (buildings rise, no builders) | |
| Undead rising buildings | `RULES.riseWork` (work per round, 80), `RULES.maxRising` (2 at once), `RULES.undeadMend` (0.05 of max HP per round) | build speed and resilience of the Undead base |
| Souls (death economy) | `soulPerModel` 3 (per model dying on graves: cheap many-model squads pay back more than they cost), `soulPerHero` 15; `FACTIONS.undead.eco.hq` (Crypt, 1), `BUILDINGS.well.income` (2) | the whole Undead economy; the flat incomes are only a floor |
| Ground look (visual only) | `js/render/ground.js` (`TEX` 4 texels per inch, `EDGE` 1.6″ soft edge, shader colours); props in `js/render/graves.js` (`CELL` 0.95″, density cov² × 0.32) and forests in `js/render/table.js` | blight and forest floors as a ground texture |
| Undead economy | `FACTIONS.undead.eco.hq` (6), `BUILDINGS.well.income` (6), `RULES.soulPerModel` (3), `soulPerHero` (15), `RULES.soulKeep` (80), `RULES.soulDecay` (0.2) | how steady vs how death-driven the Undead are; how much a bloodbath can be banked (§10.2) |
| Passives | `PASSIVES` in `js/data/units.js` (each unit's `passive`: kind + numbers); the rules in `resolve.js` (`hitOne`, `outMult`, end of round) and `apFor` in `js/sim/state.js` | each unit type's identity (§5.11) |
| Skeleton Warband | `FACTIONS.undead.units.swarm` (5 × 14 HP, armour 2, 2.8 dmg, `compact` 0.8 base size), `train.swarm` (20 a pair), `RULES.trainRounds.swarm` (2) | the Undead's core squad |
| No-build zone | `RULES.enemyBuildGap` (8″, from every enemy building) in `placeError` | how close you may build to an enemy base (anti-rush) |
| Tech tree chips | `CHIPS` in `js/data/tech.js` | the short effect text on each node |
| Auto-skill choice | `candidates()` scores in `js/sim/skills.js` (§4 table), the −1.5 rotation penalty for last round's skills (`q.lastSk`), up to 4 casts | how often and how variously squads on stances and the AI use their skills |
| Shooters in melee | each shooter's / caster's `melee: STRIKE(ap, dmg, reach)` and the skills' `ranged: true` tag in `js/data/units.js` | how well archers and casters fight back when caught; which skills are blocked when locked in melee (§5.9b) |
| Melee Strike (target attack) | `js/data/units.js`: `STRIKE(ap, dmg, reach)` per unit; `RULES.strikeMult` (1.15), `RULES.strikeLunge` (30 AP); fallback radius 2″ around the aim point in `resolve.js` (`strike`) and `main.js` (`strikePick`) | melee damage and how reliably blows land on a moving target (§5.2) |
| Tech tree | `js/data/tech.js`: `TECH.<id>` (`cost`, `rounds`, `tier`, `needs`, `needsBuilding`, `doctrine`, effects in `units` / `buildings` / `rules`), `GATES` (squads per HQ tier), `BUILDING_GATES`; tech buildings in `BUILDINGS` (`forge`, `chapel`, `pit`, `sanctum`) | when each faction's power arrives; AI research orders per personality in `js/ai/personalities.js` (`research`) |
| Kingdom farms | `BUILDINGS.farm` (`w`, `d` = land used, `slots` = farmers, `income`), `FACTIONS.kingdom.eco.gather.farm` (AP per gold), `FACTIONS.kingdom.train.builder` | late-game gold; land trade-off |
| Mage / mana | `units.<role>.mana` (`max`, `start`, `regen`), each skill's `mana`; `isMage` in `js/data/units.js` | how often the Lich and Necromancers cast |
| Necromancers (troop) | `FACTIONS.undead.units.mage` (2 × 10 HP, bolt `VOLLEY(25, 4, 9)`, mana 60 / 40 / +15, `THUNDER(15, 20, 6, 10, 2, 3, 0.7)`, `SUMMON(20, 35, 4, 1)`), `train.mage` (22), `RULES.trainRounds.mage` (2) | high tier: cost may change |
| Monolith | `BUILDINGS.monolith` (`cost` 20, `work` 120, `grave` 6, `heal: { radius 4, hp 8 }` per model per round); in `FACTIONS.undead.buildings` | how fast the Undead push graves forward and recover between fights |
| Undead tier rule | `FACTIONS.undead.lowTier` (`swarm`, `fighter`, `ranged`) | low tier: only stats change, never `train` costs; high tier: costs may change either way, but only after asking the owner |
| Lich spells | `SUMMON(ap, mana, range, count)`, `THUNDER(ap, mana, dmg, range, jumps, jump, decay)`, `EXPLODE(ap, mana, range, radius, base, perModel)`; summoned squads: `FACTIONS.undead.units.summon` is derived from `units.swarm` right after `FACTIONS` (change the Warband and summons change with it); `RULES.summonTtl` | |
| The Chosen | `LEAP(ap, range, cd, dmg, radius, name)`, `RALLY(ap, radius, cd, armor, dmgMult)`, `MIGHTY(ap, dmg, reach, cosHalf, stun, cd)` | stun length = `stun` AP |
| Population cap | `RULES.armyCap` (50 pop), map `capBonus` × 1.5 (`js/data/maps.js`) | big battles cost frame time and AI time |
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
| `armyCap` | `50` | population cap (squads cost their unit's pop; heroes, builders and summons are free; maps add capBonus x 1.5) |
| `upkeepPerPop` | `0.3` | upkeep: flat income lost per pop above upkeepFree (rounded down, never more than the flat income) |
| `upkeepFree` | `8` | pop that costs no upkeep |
| `siteRefund` | `0.75` | share of the cost refunded when an unfinished building is cancelled |
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
| `trainRounds` | `{"builder":1,"swarm":2,"fighter":2,"ranged":2,"fast":2,"mage":2,"tank":3}` | rounds each role takes to train |
| `queueMax` | `5` | squads waiting per training building |
| `queueMaxBuild` | `5` | buildings waiting in the base build queue |
| `siteHp` | `0.3` | share of max HP a new site starts with |
| `workReach` | `1` | inches between builder edge and footprint to work |
| `soulPerModel` | `3` | souls per model that dies |
| `soulPerHero` | `15` | souls when a hero dies |
| `soulKeep` | `80` | souls banked above this decay at the end of every round |
| `soulDecay` | `0.2` | share of the souls above soulKeep lost each round |
| `enemyBuildGap` | `8` | no building within this many inches of any enemy building (seen or not) |
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
| 2026-11-25 | **Economy rework** (Crypt 1 → 6, Soul Well 2 → 6, souls above 80 decay 20 % of the excess a round, itemised income + Economy panel); **passives for every unit type** (§5.11); **Skeleton Warband** 6 × 8 HP / armour 0 / 2.1 dmg / 14 a pair / 1 round → **5 × 14 / 2 / 2.8 / 20 / 2 rounds**, base ×0.8; **no building within 16″ of a seen enemy building**; tech tree chips + detail panel; Undead cost rule replaced (owner) | Kingdom / Undead of 64: 61 / 3 (0 unfinished) → **35 / 28** (1 unfinished): Crossing 7 / 9, Twin Rivers 13 / 3, Highland 7 / 8, Great Field 8 / 8 (a first try at Crypt 5 / Wells 4 gave 54 / 4). New AI vs the old: Kingdom 62 / 64, Undead 59 / 64 |
| 2026-11-25 | **Shooters locked in melee** (§5.9b): an engaged shooter's volleys and ranged skills (Piercing Bolt, Arrow Storm, Bone Blast, Dark Thunder) turn into a melee strike with its weaker `melee` attack (Crossbows 2, Bone Archers 1.2, Lich 7, Necromancers 1.5 a model); shooters get a Melee order; stances / AI strike back when locked | Kingdom / Undead of 64: 35 / 28 (1 unfinished) → **34 / 26** (4 unfinished): Crossing 7 / 9, Twin Rivers 13 / 3, Highland 8 / 7, Great Field 6 / 7. New AI vs the old: Kingdom 61 / 64, Undead 59 / 64 |
| 2026-11-25 | **Crossbows** volley 4 → 3.4, Piercing Bolt 5 → 4.5; **the Lich** bolt 10 → 13, Dark Thunder 14 → 17, melee 7 → 8; **Rend** max stacks 5 → 10; **auto skills** chosen by score, a skill used last round −1.5 (rotation), looser Rally / Corpse Explosion / Summon rules | Kingdom / Undead of 64: 34 / 26 (4 unfinished) → **25 / 37** (2 unfinished): Crossing 4 / 12, Twin Rivers 9 / 7, Highland 8 / 8, Great Field 4 / 10. New AI vs the old: Kingdom 61 / 64, Undead 61 / 64 |
| 2026-11-25 | **Start at 0** (was 60 gold / 90 souls); **population** per squad (1 / 2 / 3; heroes, peasants, summons 0) against a **cap of 50** (+ map bonus × 1.5; was 30 squads); **upkeep** floor(0.3 × (pop − 8)) from the flat income; **cancel refunds** 75 %; **longer tech tree** (unit unlock research after Tier 2, level III lines, 14 small and 6 ability upgrades); **movement split from tier** (Crossbows 6 → 4.8″, Wraiths 7.2 → 9″); **Wraiths** 9 → 11 damage, charge 5.6 → 6.8; 16″ zone exempt on home ground; AI: unplaceable sites, maxed armies attack | Kingdom / Undead of 64: 25 / 37 (2 unfinished) → **22 / 24** (18 unfinished): Crossing 6 / 10, Twin Rivers 6 / 6, Highland 5 / 6, Great Field 5 / 2; decided games 70–92 rounds on average (were 50–68). New AI vs the old: Kingdom 61 → 38 / 64, Undead 61 → 53 / 64. (Before the home-ground and AI fixes: 17 / 27, 20 unfinished; Kingdom vs old AI 35 / 64) |
| 2026-11-26 | **HP ×1.5** for units and buildings (The Chosen excepted; heals and HP research ×1.5); **Crossbows / Bone Archers** volley 30 → 40 AP and −20 % damage (Crossbows 3.4 → 2.7, Bone Archers 2.4 → 1.9, their skills too); **Kingdom melee** Men-at-arms 5 → 6, Shieldwall 4 → 4.8, Outriders armour 5 → 6; **strikes** hit any enemy in reach when the target can't be reached, chase when nothing is in reach + lunge, lunges pass friends (misses 32 % → 6 %); **no building within 8″ of any enemy building** (was 16″ from seen ones + home ground); AI: visible-only strikes, Kingdom opening, unreachable sites skipped | Kingdom / Undead of 64: 22 / 24 (18 unfinished) → **16 / 29** (19 unfinished): Crossing 3 / 13, Twin Rivers 6 / 6, Highland 3 / 7, Great Field 4 / 3. Ranged share of damage 78 % → 41 %; Warband median life after first hit 2 → 3 rounds. New AI vs the old: Kingdom 38 → 27 / 64, Undead 53 → 54 / 64. (Before the Kingdom melee buff, a quick check gave the Kingdom 2 of 10 decided) |
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
| Squads of several models; damage removes models; a population cap (50) | Dawn of War, Company of Heroes | squad-based armies, losses shown as fewer models, a squad cap | turn-based with simultaneous orders; damage scales with the models left |
| Speed tiers inside a round, simultaneous orders | tabletop wargames (alternating / initiative activation), WeGo games such as Combat Mission | everyone plans, then the round resolves | faster tiers act first; AP is time inside a tier |
| Heroes with three skills | Warcraft III | heroes with a small kit that shapes fights | no hero levels or items |
| Mana mages (the Lich, Necromancers): spells cost mana, regenerate each round | Warcraft III casters | mana pool and regeneration | no cooldowns for mages; casts repeat while AP and mana last |
| Chain lightning (Dark Thunder) | Warcraft III (Far Seer's Chain Lightning) | a bolt that jumps to nearby enemies, weaker each jump | aimed skillshot; first target needs line of sight |
| Stun (Mighty Swing) | Warcraft III (Storm Bolt, Thunder Clap) | a hit that stops the target acting for a while | stun is measured in AP inside the round |
| Temporary summons that crumble | Warcraft III summoned units with a timed life | free bodies that expire | they rise at the end of the round; Corpse Explosion can spend them |
| Undead buildings that build themselves | Warcraft III Undead (summoned buildings), StarCraft Protoss (warped-in buildings) | no worker has to stay to finish a building | a separate limit of 2 rising at once; they mend slowly |
| Workers on farms; farms use land | Age of Empires | farmers gather at farms; farms take building space | 4 farmers per farm; peasants also build and repair |
| Resource sites to claim (Mines, Soul Wells) | Dawn of War (strategic points), Company of Heroes (territory) | fixed spots on the map worth fighting over | Soul Wells only trickle souls and spread graves far |
| Population per squad and upkeep that grows with the army | Dawn of War (squad cap / support cap, upkeep that lowers requisition income), StarCraft (supply), Warcraft III (upkeep tiers) | each squad costs pop against a cap; a big army lowers income | upkeep is a linear tax above 8 pop, taken only from the flat income (never below 0) |
| Weapon / armour levels I–III with rising costs | StarCraft (+1 / +2 / +3 upgrades), Warcraft III Blacksmith | each level costs more and takes longer | level III needs Tier 3 |
| Unit unlock research after a tier | Age of Empires (unit-line research; Stable / Archery Range units by age), Company of Heroes (unlocking units by research) | an elite unit needs its own research, not just the tier | done at the Barracks / Ossuary queue |
| Ability upgrades (a squad gains a skill) | Dawn of War / Company of Heroes (researched squad abilities), Warcraft III (caster abilities by research) | research that adds an ability, not just stats | reuses the game's existing skill kinds |
| Cancel an unfinished building for a partial refund | Warcraft III / StarCraft (cancel refunds 75 %) | a mistake or a lost site isn't a total loss | only before it is finished |
| Starting with no resources | most RTS games (a fixed start, income from then on) | first purchases come from income | both sides start at 0 with their small armies |
| Movement separate from initiative | tabletop wargames (Move characteristic vs initiative) | how far a unit walks is its own stat | tier still decides who acts first |
| Squad durability and time-to-kill (fights that last long enough to react) | Dawn of War (high squad HP, long melee brawls, ranged squads that suppress rather than delete) | sturdy squads and weaker ranged fire, so a fight takes several rounds | HP ×1.5 for units and buildings (2026-11-26; The Chosen excepted); ranged squads fire 2 volleys a round for 20 % less |
| Melee units chase their target | most RTS games (attack orders follow the target; Dawn of War melee squads lock on) | a melee attack keeps after its target instead of swinging at air | a strike with nothing in reach + lunge becomes a move toward the target; at release it hits whatever enemy is in reach |
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
| A steady, readable economy: income from held sites, damped snowballing, an income breakdown | Dawn of War (requisition from captured strategic points), Warcraft III (haunted gold mines; upkeep as a "speed limit"), Company of Heroes (territory income), Game Developer "the importance and challenge of speed bumps in RTS economies", Wayward Strategy "control of economic processes", "RTS economics and player agency" | players see and control where income comes from; a lead shouldn't snowball unchecked | Crypt / Soul Wells pay steadily, deaths pay on graves, souls above 80 decay; the Economy panel shows every source |
| Unique passive per unit type | Warcraft III / StarCraft unit passives (e.g. life steal, armour auras, critical strike), Dawn of War unit abilities | each unit plays differently even with the same orders | one always-on effect each (§5.11) |
| No-build zone near enemy buildings | Company of Heroes / Dawn of War territory (build only in your territory), StarCraft creep / psi fields | stops proxy rushes next to an enemy base | 16″ from enemy buildings the side has seen |
| Tech tree with effect chips and a detail panel | Age of Empires / Civilization tech trees (short effect lines, full text on hover) | readable at a glance, full detail on demand | chip on the node, a panel with a Research button |
| Light and heavy cover that squads walk into; cover from walls by direction | Dawn of War (light / heavy cover: craters, ruins, sandbags; units take cover positions), Company of Heroes (directional cover behind walls) | protection depends on where a squad stands, so position matters | heavy ×0.5 ranged / ×0.75 melee, light ×0.75 ranged; stance squads take cover within 3″ |
| Longer-lived units and buildings | Dawn of War (high HP pools, long fights with retreat and reinforcement) | fights last long enough to react: retreat, reinforce, flank | ×2 HP (2026-11-24), then ×1.5 more (2026-11-26; The Chosen only ×2) |
| Shooters can't shoot while locked in melee | Dawn of War (ranged squads in melee fight with their melee stats and stop shooting), tabletop wargames (units in base contact fight in close combat) | getting into melee neutralises shooters; screening matters | volleys and ranged skills become a weaker melee strike; a Melee button for shooters |
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

