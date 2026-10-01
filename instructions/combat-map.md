# Combat domain map

A reader's guide to `app/domain/combat/`: the ideas it is built on, how an action moves
through it, and which file holds what. It describes the code as it stands; the history of
how it got here, and the table's rulings behind the sequencing, are in
`instructions/action-stack.md` and `instructions/reaction-openers.md`. When this map and the
code disagree, the code wins — fix the map.

The combat domain covers play both in and out of a fight (a skill test is play, so it lives
here, not under `character/`), and the tactical grid is part of the fight, not a domain of its
own.

## The ideas it rests on

1. **A fight is one value.** `CombatState` (`types.ts`) holds everything: the characters
   (as `CampaignCharacter`s), the round, the action log, the stack, the history, the board,
   the grapples and the floor. It is a Zod schema with a default on every field, so it can
   be parsed from a partial or older payload. Every command is an `Updater`,
   `(state) => state`, and the store (`stores/useCombatStore.ts`) only holds the value and
   applies updaters to it.

2. **An action is data, never a procedure.** A strike, a move, a defense is a record in
   `state.actions`: who, against whom, what was declared, what the die said, and — once it
   lands — what it came to (`facts`). Nothing about an action is computed twice: whatever
   needed two characters to work out is written onto the record when the transition
   happens, so the reducers that land it need only the record.

3. **Every action runs the same pipeline.** `define → react → roll → post → effect`, stored
   as `ActionBase.step` (`define | react | post | done`). The roll and the effect are
   transitions, not places an action waits.

4. **A stack decides whose turn it is to be played out.** `state.stack` holds ids of root
   actions still being played out; the top is the open one (`getOpenAction`). Anything an
   action opens — the strike an opportunity attack opens, a riposte, the blast of an
   explosion — is pushed over it and played out first. `state.history` records the order
   actions *landed*, which differs from the order they were declared.

5. **An action writes only its own record.** Being given up, voided, interrupted or broken is
   never written onto the victim; it is *derived* from the log (`rules/opportunity.ts`,
   `rules/interruption.ts`). Nothing is written onto an action after its commit except by
   its own transitions.

6. **One place changes each part of the state.** Characters change only in
   `reduceCharacter`, grapples in `reduceGrapples`, the floor in `reduceFloor`, the board in
   `reduceBoard` (all `commands/reduce.ts`), driven by `applyPhase` (`commands/log.ts`). The
   log and stack change only in `setActions`.

7. **What is previewed is what lands.** `getSettled` (`rules/settle.ts`) computes the landed
   action; the resolve writes exactly that and the panel's previews read the same function.

8. **A command refuses exactly what the UI shows as closed.** Declarations go through
   `findOption` (`rules/options.ts`), the same list the panel renders with reasons, and a
   refused command returns the state unchanged, so the store can dispatch blindly.

9. **A fight without a board is a legal fight.** `state.board === null` means every
   positional gate passes; board rules answer null or "passes" when the board or the
   placement is missing.

10. **The domain holds no entropy.** Dice come in as a `Dice` function
    (`components/utils.tsx` `realDice` is the one `Math.random` seam) and ids as a
    `newId: () => string` (hooks pass `crypto.randomUUID`).

11. **An action waits only where someone owes a decision.** The step changes only at a
    commitment (commit, roll or pay, resolve); a step whose only move would be forward is
    taken by the command or `advance` instead of waiting for a click. Everything declared
    before the commit is one screen, free to edit in any order. A commit nobody can answer
    (`hasOpenAnswer`, `rules/options.ts`) is rolled or paid at once; a rolled root with
    nothing to choose (`hasPostChoice`, `rules/action.ts`) lands at once. A new step or
    choice must say who owes it, or it will be skipped.

## The action catalog

`rules/actionCatalog.ts` `ACTIONS` is the one table of what each kind is, typed
`satisfies { [K in ActionKind]: ActionDef<K> }` so a new kind in the union fails to compile
until it has an entry. Flags: `type` (action | reaction), `price` (row of the action-cost
table, or null when the declaration prices it), `reactsTo`, `die`, `movement` (goes on
while its actor reacts; every other action is given up to react), `targeted`, `generated`
(never declared by a player), `identity` (fields telling two options of a kind apart).

Types derived from it in `types.ts`: `ReactionKind` / `ReactionAction`, `RootAction` (every
non-reaction), `InterruptibleAction` (every non-reaction but movement), `DeclarableKind`,
and `ActionDraft` (what a click declares).

| Group | Kinds |
|---|---|
| Declarable roots | `strike`, `shoot`, `cast`, `move`, `grapple`, `drag` (one block of push, drag or circling within a grapple), `release`, `holdBack`, `pickUp`, `throw` (an item to a cell: its throwing row's reach and price, else a standard action), `rest` |
| Generated roots | `explosion` (opened by a throw whose object goes off on impact, a cast with an area, or a Detonate Explosive cast), `blast` (an explosion going off), `fleeFollowUp` (the flee a strike or a missed shot leaves), `spellTest` (a target's test against a spell cast through a link: the caster's action, the target's die) — plus strikes, moves, maneuvers and pushes that other actions open, marked by `spawnedBy` |
| Defenses (to a strike) | `evade` (also to a move), `evasiveJump`, `block`, `intercept` |
| Trample answers (to a move) | `evade`, `brace` |
| Reflexes | `evasion`, `guard` (to a shot); `avoidExplosion` (to an explosion) |
| Opening reactions | `opportunityAttack` (strike, move, and every triggering kind), `counterattack` (strike), `follow` (move), `joinShot` (shoot: a shot of the joiner's own at the same target) |
| Flee | `flee` (move): the movement surge made as a reaction; opens no action, hands the turn over instead |
| Grapple answers | `resist` (grapple, drag); `assist`, `carry`, `letGo` (drag) |

Two links tie the log together: `reactionTo` (a reaction points at its root) and
`spawnedBy` (an opened action points at whatever opened it). `rules/log.ts` holds every
lookup over them (`getReactionsTo`, `getRootOf`, `getOpenedBy`, `getOpeningReaction`,
`getDrawnOpportunityAttacks`).

## The pipeline, step by step

| Step (`step`) | UI sub-step (`getNextStep`) | Commands (`commands/action.ts` unless noted) |
|---|---|---|
| `define` | `declare`, `target`, `aim`, `commit` | `declareAction`, `amendAction`, `setTarget`, `commitAction`, `cancelAction`, `withdrawSpawnedAction`; board clicks through `pickCell` / `turnMove` (`commands/board.ts`) |
| `react` | `react` | `declareReaction`, `amendReaction`, `withdrawReaction`, `withdrawLastReaction`, `boostPush` (the pusher's +5, also at `define`); then `rollAction(dice, newId)` or, for an action with no die, `payAction(newId)` |
| `post` | `spend`, `aim`, `choose`, `confirm` | `commands/choices.ts`: `spendHOP` / `refundHOP`, `improveSpell` / `refundImprovement`, `saveGraze`, `aimExplosion`, `chooseManeuver`; then `resolveAction(newId)` |
| `done` | — | — |

- **define** — free to edit or cancel. Only one root can be declared at a time
  (`declareAction` refuses while anything is open), and only by the character whose turn
  it is (`inTurnCharacter`, `rules/turn.ts`); while a movement or combat surge has AP left,
  only what it allows (`rules/surge.ts`).
- **commit** (`commitAction(dice, newId)`) — checks the declaration is complete
  (`isDeclarationComplete`), aimed legally (`getTargetIds`) and affordable
  (`getPayableCost`), then locks it at `react`. A move records `from` here. When nobody
  has an answer open to it, it is rolled or paid in the same update.
- **aiming an attack** — an attack is aimed at the target's chest when the target is picked
  (`getDefaultAim`, `rules/attack.ts`), again on every retarget; a target with no chest is
  left unaimed, and the declaration is incomplete until a place it has is picked
  (`isAimOnTarget`).
- **react** — triggers are read off the locked action (`getTriggers`, `rules/reactions.ts`);
  each character gets one answer, and a new one replaces the old. `pruneReactions` drops
  answers the declaration no longer triggers.
- **roll / pay** (`payAll`) — prices the root and every reaction off their actors as they
  stand, throws the root's die and each reaction's own die (in declaration order), and
  takes every price, all in one update: no state exists where a die is known and its price
  unpaid. The root goes to `post`, its reactions to `done`. Refused as a whole if anyone
  cannot pay.
- **post** — choices made once the result is known; each only edits the rolled record and
  is reversible (except `saveGraze`, whose price is paid as it is bought).
- **effect** (`resolveAction` → `land`) — settle, apply, generate follow-ups.

Reactions are never played out on their own: they are paid with their root and close with
it. What a reaction *opens* is a root of its own.

## Sequencing: the stack, `advance` and `land`

`commands/sequence.ts` is the engine. Every command that changes the pipeline ends in
`advance`.

```
payAll ──► advance ──► top at post? ──► openBefore: first reaction whose
                                         REACTION_OPENERS[kind].before opens something
                                         → push it, stop (the table plays it out)
                          │ nothing left to open, and the top has nothing to decide
                          │ (explosion, drag)
                          ▼
resolveAction ─────────► land(top)
                          getSettled → applyPhase('resolve') → close
                          push getFollowUps(...) → advance again
```

- **Before the effect** — `openBefore` walks `getReactionsInOrder` (`rules/openers.ts`): the
  drawn opportunity attacks in the order the root reaches them (path order for a move or a
  push), then the other reactions as declared. It opens one at a time; when that lands,
  `advance` resumes the root and opens the next.
- **After the effect** — `getFollowUps` builds the list pushed over the landed action; the
  **last pushed is played first**. Bottom to top: the blast (under everything), whatever
  reactions open `after` (evasion and follow moves, explosion escapes, a lower-rolled
  counterattack), escapes a stun opens, the spell tests a linked cast opens, the explosion
  a cast opens, the explosion a thrown object goes off as where it lands, a hook's knockdown, and a riposte on top. A voided root generates only what an
  `evenIfVoided` opener gives (the counterattack).
- **`REACTION_OPENERS`** (`rules/openers.ts`) is typed `{ [K in ReactionKind]: Opener<K> }`:
  a new reaction kind does not compile until it says what it opens (`before`, `after`, or
  nothing). Follow-ups no reaction opens (blast, cast and impact explosions, hook knockdown,
  stun escapes, riposte) live in `getFollowUps` itself.
- **One follow-up each** — `land` stamps every follow-up still to be declared with
  `followUpOf` (the landed action). Once a character takes one, `advance` passes up their
  others from the same action as they come to the top (`isForgone`, `rules/log.ts`): a
  riposte or a flee, an evasion's move or a flee.
- **Auto-landing** — a root at `post` with nothing to choose (`hasPostChoice`: no HOP to
  spend, spray to point, pick to make, graze to save, rest move or along to decide) is
  landed by `advance` once its attacks are fought. `resolveAction` is only pressed where a
  choice was offered.
- **Charges and throws** — what releases a charge (`Item.charge`) is read off its spell's
  catalog `triggers`: `impact`, `fire`, `detonate`. A `throw` lands the item on the floor,
  one of a stack, charge and all; if it goes off on impact (`goesOffOnImpact`: an `impact`
  charge, or a mundane explosive's row `payload`) the throw opens an `explosion` at the
  landing cell, committed and waiting on the reflexes, DL the thrower's Accuracy. A
  detonation sets off only `detonate` charges. Nothing reads the `fire` trigger yet.
  Whatever the charge went off in is destroyed as the explosion lands, held or on the floor.
- **Links and concentration** (`character/rules/concentration.ts`) — a caster holding a
  sustained spell is concentrating: every option but a cast is closed (`options.ts`), and
  only the linking spell they hold, again, or a spell whose `sustaining` requirement they
  hold may be cast. A linking spell (catalog `linkDL`) keeps who it links on the caster's
  held entry (`targets`), and each link raises every cast's DL. A cast of a linking spell,
  or of one cast through it, that hits opens a committed `spellTest` per target
  (`openSpellTests`); the target's die against the caster's side of the spell's test links
  them on a miss or graze, and a hit or better breaks the link; a willing target may take
  it without a die (`acceptSpellTest`), as a miss. What lands on the target is the spell's
  `outcomes` entry for their own degree (`getSpellTestFacts` → `produceOutcome`).
  Everything a cast produces — its facts, the explosion it opens, a charge, its spell
  tests — is made at the cast's size (`getCastSizeOf`): the caster's own, or the
  environment's for shamanism, one up per amplification, capped at its item's size + 1. A
  cast short of the amplifications its item needs does nothing: `isFailedCast`, written
  onto the cast as `failed` when it lands so the reducer need not measure. Extend is
  declared with the cast, like Quicken, each extension +3 DL (`stepExtend`, `EXTEND`);
  a target must be within the extended range to be aimed at (`canAimCast`). It never
  reaches an explosion's area — the explosion is the effect — only the range a Detonate
  Explosive cast (catalog `detonate`) sets off a charge at (`getChargeOptions` with the
  detonation it opened). Any interruption
  or stun ends every held spell: a won maneuver (`reduceCharacter`), a blow as it lands
  (`deliver.ts`), a crash (`trampledBy`).
- **Rest** — `rest` is a root with no die, priced by the action-cost table, and the one
  action of their own a character may declare outside their turn; it may take AP negative as long as the next round starts positive (`canAffordRest`), and lands as
  `restCharacter` (STA back). Effortless is the same rest landing with the cast
  (`restWhileCasting`), the AP raised to the rest's. While either waits at `post`, its
  actor may make the rest's careful movement once, in their own turn (`moveWhileResting`,
  `rules/rest.ts`):
  a move opened over it, careful only, its 4 AP prepaid, played out before the rest or
  the spell lands.
- **Flee** (`rules/flee.ts`) — against a move it is a reaction; after a strike, or an
  evasion a shot missed, it is a `fleeFollowUp` pushed beneath the other follow-ups
  (`getFleeFollowUps`), declared as flee or end (`flee`, end by default; committed as
  end it is withdrawn), offered only to one who can flee (`getFleeBar`: not in turn, not
  immobile or grappled, the surge affordable). Either is priced as the movement surge, made
  at the payment. A move a flee answers stops one space short of the flee's step
  (`getFleeStep`, read by `getMoveFacts`), so the mover pays only for what is walked. `land`
  adds whoever the landed action sends fleeing to `state.fleers`; once the stack is empty,
  `advance` calls `handOverToFleers`: the turn is put aside, not ended, and each fleer takes a flee turn in
  declaration order (`state.turnQueue`), limited to what the movement surge allows
  (`getFleeBarFor`), before the interrupted turn resumes. `endTurn` takes the next queued
  turn.
- **Coordinated shots** (`rules/coordinated.ts`) — any other shooter may answer a shot with
  `joinShot`, declared with the row, way of shooting and ammo of the shot it opens, priced
  by that shot. Each is opened before the lead shot's effect (`REACTION_OPENERS`), in the
  order declared, so they land at the same point as the lead, and none is opened once the
  lead is voided. A joined shot is a `shoot` root of its own with its own roll and
  delivery. The target's one evasion is declared against the lead (`getShotLead`) and every
  shot is scored against it; a guard answers only the shots it stands in front of
  (`isGuardingShot`, per shooter). A joined shot triggers only the opportunity attacks its
  shooter draws. The evader's flee follows the lead's roll; their move is lost if any shot
  interrupted them (`getShotGroup`).
- **Withdrawing** an opened action (`withdrawSpawnedAction`) marks it `declined` (kept in the
  log so it is not offered again, left out of `history`); an opportunity attack's strike is
  instead removed together with its reaction.

## Interruption, giving up, voiding

- `getInterruptionOf(landed, victim)` (`rules/interruption.ts`) — what a landed strike,
  grapple maneuver or push did to someone: `none | interrupted | stunned`.
- `getInterruptions(state, action)` — what the action's descendants (through `reactionTo`
  and `spawnedBy`) landed on its actor *before its own effect*, ordered by `history`. A
  counterattack's tied strike is skipped (a tie breaks neither).
- `isBroken` — any such interruption, except for a move (cut short where caught,
  `getMoveOverride` in `rules/move.ts`) or a push (stopped by its comparison, or only by a
  stun of the pusher, `getPushStop` in `rules/drag.ts`).
- `rules/opportunity.ts` — `getGivenUpFor` / `isCancelled` (the actor of any action but
  movement gives it up by answering an opportunity attack it drew with anything but the SD),
  `getMidActionTerm` (the -2 on that answer, or on one made while standing up) and
  `isVoided` (cancelled or broken). A voided action lands nothing at its resolve
  (`applyPhase` skips it), settles with no facts, generates no follow-ups, and its price is
  still paid.

## Landing: settle, then reduce

- `getSettled(state, open)` (`rules/settle.ts`) — the exhaustive switch over `RootAction`
  that writes each kind's `facts` from the fight as it stands: attack deliveries,
  interruption and trample for a strike, the thrown item for a shot, grapple facts for a
  maneuver, path facts for a move, zone deliveries and terrain paint for a blast, cast
  deliveries per character.
- `applyPhase(state, actions, phase)` (`commands/log.ts`) — lands the board, reads the fire
  it left the turn holder in, runs every character through `reduceCharacter`, then the floor
  and grapples reducers, then `settleGrapples`.
  Phases: `roll` (the price leaves the actor), `save` (a cast's graze bought up), `resolve`
  (the action lands).
- `reduceCharacter` hands deliveries to the character domain's own effect processor
  (`character/commands/deliver.ts`); combat never computes damage on the target side.
- A grapple seizes the weapon each holder holds with (`Grapple.weapons`): the grab's row,
  or a free grapple row for grappling back. It grabs nobody else, and only its grapple
  rows are used, against nobody but the partner (`isSeizedUse`, read by `getTargetIds`,
  `isDeclarationComplete` and `getFreeAttackOptions`, the rows the panel offers).
- `settleGrapples` (`commands/grapple.ts`) lets go for any holder whose seized weapon is
  no longer a grapple row in hand,
  after anything that could take it from them — also called by `updateCharacter`,
  `dropToFloor` and `removeFromCombat`.
- What the fight puts on a character is never stored on them: `rules/situational.ts`
  reads suffocation off the gas they stand in and grappled/immobile off `state.grapples`
  (`getSituationalAfflictions`, `hasFightAffliction`, `isSuffocating`, `isImmobile`). Combat
  rules ask these, not the character's own afflictions; the SD getter and the affliction
  board take them as a `situational` argument.

## The board

- `geometry.ts` — hex arithmetic in axial coordinates, no rules: `DIRECTIONS` (also the
  rotation order), `distance`, `setDistance`, `line`, `disk`, `ring`, `rotate`, `walkOut`,
  plane conversion for drawing and cones. One cell is one metre.
- `rules/board.ts` — footprints and occupancy by size, distance between characters, reach
  and shot range, line of sight, high ground, flankers, melee threateners.
- `rules/ground.ts` — where a footprint may cross and where it may come to rest.
- `rules/hazard.ts` — fire and gas left on the ground. A blast paints
  a `HazardLayer` onto each cell it covers (`TerrainCell.layers`). The layer holds the fire
  its own burn deals in that zone, whether the gas suffocates, and the visibility it leaves.
  A layer from a sustained spell names its holder and the explosion that cast it; it is
  read as gone while they do not hold the spell (`isLayerLive`), and a new cast of the
  spell paints over it (`isSupersededBy`). What leaves the fight takes only the live layers
  (`getLiveBoard`). A footprint takes the worst of its cells (`getHazardAt`). Suffocation
  from gas is never stored: `rules/situational.ts` reads it off where the character
  stands, so no command has to settle it. `getFireTouched` reads, off
  the board an action landed, the worst fire the turn holder stands in or walked through (a
  jump touches only where it lands), and `reduceCharacter` raises their `scorch` to it. `endTurn` deals the scorch as burning damage, and
  `nextRound` burns the counter with the fire each character stands in added, as one
  instance. Every burn and radiant hit goes through the counter the same way
  (`getOutcome`).
- `rules/move.ts`, `rules/waypoint.ts`, `rules/trample.ts` — move pricing and legality,
  runs, Balance tests, reachable cells, where the mover stands along a path, where a move
  was cut short, tramples.
- Board edits outside any action (`createBoard`, `importBoard`, `placeCharacter`,
  `turnCharacter`, `paintTerrain`) live in `commands/board.ts` and are refused while an
  action is open. `makeBoard` (`factories.ts`) ingests a VTT snapshot best-effort.

## Reading for the UI: projections

`projections/` shapes the fight for a screen and has no setters.

- `actionPanel.ts` `getActionPanel` — everything the action panel shows: the open action,
  its sub-step, options with reasons, reactors and their pickers, HOP and spell options,
  push outcome.
- `boardView.ts` `getBoardView` — cells, tokens, ghosts, floor items, and what a click on
  each cell would mean (`BoardMode`).
- `roster.ts` `getCombatRoster`, `getRole` — who each character is to the open action.
- `outcomes.ts` — `getOutcomes` (damage previews), `getActionNotes`, `getLastReport` (reads
  the end of `history`).
- `labels.ts` — names for actions, options and HOP purchases.
- `perState.ts` — memoizes a projection per state object. Each big projection exports a
  `…Digest` (its JSON) so a hook re-renders only when the view actually changed, then reads
  the same cached view.

Hooks: `useCombatActions` (pipeline buttons, injects dice and ids), `useCombatCommands`,
`useCombatState`, `useBoard` — thin adapters over the commands and projections above.

## File map

```
app/domain/combat/
├── types.ts            CombatState, Board, every Action schema, derived action types
├── factories.ts        makeAction, makeBoard (ingestion), addCharacterToCombat
├── geometry.ts         hex math, no rules
├── dice.ts             d10 with explosions; rollTest (safe/risky) drawn ahead, unwired
│
├── commands/                        the write side
│   ├── action.ts       the pipeline buttons: declare … commit, react, roll/pay, resolve
│   ├── choices.ts      post-roll choices: HOP, spell improvements, graze save, aims, maneuver picks
│   ├── sequence.ts     advance, land, openBefore, getFollowUps, the flee handover — the engine
│   ├── log.ts          setActions (only writer of log/stack/history), applyPhase, pruneReactions
│   ├── reduce.ts       reduceCharacter / Grapples / Floor / Board, by phase
│   ├── grapple.ts      settleGrapples
│   ├── board.ts        board editing, pickCell / turnMove (clicks during an action)
│   ├── floor.ts        dropToFloor, pickFloorItem
│   ├── characters.ts   removeFromCombat, updateCharacter
│   ├── nextRound.ts    round change: upkeep, gas, burning, bleed, AP reset
│   ├── turn.ts         startTurn, toggleContest, rollContest, endTurn, surge (turn-gated)
│   ├── resetCombat.ts
│
├── rules/                           what the book says about a state
│   ├── actionCatalog.ts ACTIONS, isReaction/isRootAction/isDefense
│   ├── log.ts          open action, stack lookups, reactionTo/spawnedBy lookups
│   ├── action.ts       declaration completeness, costs, getNextStep, needsDie, targets
│   ├── options.ts      getAvailableActions / findOption: what may be declared, and why not
│   ├── turn.ts         whose turn it is; who may start, contest or end one, or surge
│   ├── surge.ts        the actions behind each surge allowance in `SURGES` (tables.ts), and a flee turn
│   ├── flee.ts         who may flee, its price, the stop it puts on a move, who a landed action offers or sends fleeing
│   ├── reactions.ts    getTriggers: who may answer a committed action, with what
│   ├── openers.ts      REACTION_OPENERS: what each reaction opens, before or after
│   ├── settle.ts       getSettled: an action as it lands
│   ├── interruption.ts getInterruptions, isBroken
│   ├── opportunity.ts  opportunity attacks: board state while fought, stops, giving up, isVoided
│   ├── coordinated.ts  joined shots: the lead, the group, the shot a join opens
│   ├── counter.ts      counterattack slot (before / tie / after) and its strike
│   ├── riposte.ts      when a riposte opens, its discount
│   ├── protect.ts      protecting another: the line, Defender and Defensive Advance steps
│   ├── attack.ts       weapon rows per action, test terms and DLs, defending reaction
│   ├── test.ts         resolveTest: skill vs DL → degree and HOP
│   ├── damage.ts       attack deliveries, interruption, HOP options and prices, hook knockdown
│   ├── delivery.ts     a row's damage as it leaves the weapon
│   ├── weaponRow.ts    rows in hand, usable rows, variants
│   ├── cast.ts         spells: options, facts, improvements, graze save, explosion a cast opens
│   ├── explosion.ts    payload, areas, zones, spray vs disk, who is reached, terrain paint
│   ├── move.ts         movement prices, path legality, runs, Balance, move override, jumps
│   ├── waypoint.ts     where the mover stands along a path
│   ├── reactionMoves.ts the moves evasion, follow and explosion reflexes open
│   ├── trample.ts      crashes: Force comparisons from moves, braced blows and catches
│   ├── board.ts        footprints, distance, reach, sight, flankers, threateners
│   ├── ground.ts       crossable and restable cells
│   ├── hazard.ts       fire and gas on the ground, what a footprint stands in, what a move walks through, the fire a landing touched
│   ├── grapple.ts      grapple rows, maneuvers, grabs, releases, stun escapes, grapple facts
│   ├── partners.ts     who is grappled with whom
│   ├── situational.ts  what the fight puts on a character: gas suffocation, grapple afflictions
│   ├── drag.ts         push and drag: sides, the +5 order, prices, the block's way and reach
│   ├── floor.ts        items on the floor, reachable, a shot's thrown weapon, one of a stack
│   ├── throw.ts        what can be thrown, how far, at what price, what lands
│   ├── aim.ts          where the open action waits to be pointed on the board
│   └── fighters.ts     active character, fight names, who holds an item
│
└── projections/                     read-for-UI, no setters
    ├── actionPanel.ts, boardView.ts, roster.ts, outcomes.ts, labels.ts, turn.ts
    └── perState.ts     memoize once per state object
```

The combat domain calls into `character/` (costs, afflictions, deliveries, skill terms,
effects) and `item/` (hands, items). The one call back is the character's effect processor
(`character/commands/deliver.ts`), which rolls a delivery's test with `rules/test.ts` and
`dice.ts`, since a skill test is play and lives here.

## Where a change goes

- **A new action kind.** Add its schema to `types.ts` and to `ActionSchema`; add its
  `ACTIONS` entry; the compiler then walks you through the exhaustive switches
  (`getSettled`, `getPostStep`, `getKindTriggers`, `getRootTestTerms`, …). If it changes
  characters, the grid, the floor or grapples on landing, add its branch to the reducer
  that owns that part.
- **A new reaction kind.** Same, with `type: 'reaction'`; `REACTION_OPENERS` will not
  compile until it has an entry. Its trigger goes in `rules/reactions.ts`, its option and
  reasons in `rules/options.ts`, its completeness in `isDeclarationComplete`.
- **A new follow-up no reaction opens.** Add it to `getFollowUps`, minding the push order
  (last pushed plays first).
- **A new choice after the die.** A command in `commands/choices.ts` guarded by
  `getRolledOpen`, a branch in `getPostStep`, and the field on the action schema.
- **A rule change.** Read the `.tex` first, change the rule in `rules/`, cite it beside the
  code. Commands and projections should not need to change.

## Tests

- `commands/sequence.test.ts` — the sequencing invariants, played through the commands
  (`playOut`, scenarios): opportunity attacks fought once and before the action that drew
  them, never chained; broken actions land nothing; giving up by defending; explosions and
  sprays reach only who is still in the area; counterattack orders; ripostes; hook
  knockdowns; protecting; coordinated shots.
- `commands/action.test.ts`, `commands/combat.test.ts` — pipeline guards and round change.
- `rules/*.test.ts` — boardless fights pass every gate; reach; moves; grapples; reactions.
- `projections/outcomes.test.ts` — the preview is what the target takes.
- `factories.test.ts` — board ingestion is total and round-trips.

All tests follow `instructions/testing.md`.
