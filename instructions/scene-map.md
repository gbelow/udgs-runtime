# Combat domain map

A reader's guide to `app/domain/scene/`: the ideas it is built on, how an action moves
through it, and which file holds what. It describes the code as it stands; the history of
how it got here, and the table's rulings behind the sequencing, are in
`instructions/action-stack.md` and `instructions/reaction-openers.md`. When this map and the
code disagree, the code wins — fix the map.

The combat domain covers play both in and out of a fight (a skill test is play, so it lives
here, not under `character/`), and the tactical grid is part of the fight, not a domain of its
own.

## The ideas it rests on

1. **A fight is one value.** `SceneState` (`types.ts`) holds everything: the characters
   (as `CampaignCharacter`s), the round, the actions in play, the record of those landed, the stack, the board,
   the grapples and the floor. It is a Zod schema with a default on every field, so it can
   be parsed from a partial or older payload. Every command is an `Updater`,
   `(state) => state`, and the store (`stores/useCombatStore.ts`) only holds the value and
   applies updaters to it.

2. **An action is data, never a procedure.** A strike, a move, a defense is a record in
   `state.actions` while in play and in `state.record` once landed (`getLog` reads both): who, against whom, what was declared, what the die said, and — once it
   lands — what it came to (`facts`). Nothing about an action is computed twice: whatever
   needed two characters to work out is written onto the record when the transition
   happens, so the reducers that land it need only the record.

3. **Every action runs the same pipeline.** `define → react → roll → post → effect`, stored
   as `ActionBase.step` (`define | react | post | done`). The roll and the effect are
   transitions, not places an action waits.

4. **A stack decides whose turn it is to be played out.** `state.stack` holds ids of root
   actions still being played out; the top is the open one (`getOpenAction`). Anything an
   action opens — the strike an opportunity attack opens, a riposte, the blast of an
   explosion — is pushed over it and played out first. `state.record` holds the actions in the
   order they *landed* (`getHistory`), which differs from the order they were declared, and
   is only ever added to; a draft taken back leaves `state.actions`, never the record. What
   was committed, or offered, and then withdrawn without landing goes into `state.journal`
   with its reason (`withdrawActions`), so nothing leaves play without a trace but a draft.

5. **An action writes only its own record.** Being given up, voided, interrupted or broken is
   never written onto the victim; it is *derived* from the log (`rules/opportunity.ts`,
   `rules/interruption.ts`). Nothing is written onto an action after its commit except by
   its own transitions.

6. **One place changes each part of the state.** Characters change only in
   `reduceCharacter`, binds in `reduceBinds`, the floor in `reduceFloor`, the board in
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

12. **Spaces: the board, none, and the chase, with no adapter between them.** A rule that
    asks where someone is reads the board, and answers "passes" without one (9). The chase
    adds its distances at a fixed set of crossing points in the shared rules and commands
    (distance, shot range, guarding a party member, routing, cover, rest, round length and
    round end, splitting), and lint rule 6 in `eslint.config.mjs` lists them. Each answers
    as if there were no chase when there is none, so a fight on the board runs the code it
    ran before the chase existed. A new crossing point is added to that list on purpose and
    must answer nothing with no chase. The fuzzer plays a chase with no board beside the
    board sessions. Actions that only mean something on a board (move, push, throw, aiming
    an area) are closed without one until a boardless version is built for each, one at a
    time as play needs it (descriptive move and push, then throw, then picking who an area
    catches).
    *Decided 2026-10-11, over a `Space` interface with board, none and chase
    implementations behind every positional question (about 40 files to re-route).*
    *Revisit when* the boardless branches pile up (more and more `isPlaced` and
    `state.board?.` checks spread across rules), or when a new kind of space arrives with
    real positional rules of its own. A VTT feeding positions fills the board and doesn't
    count.

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
| Declarable roots | `strike`, `shoot`, `cast`, `fireAgain` (a held spell fired again without the casting test), `move`, `grapple`, `drag` (one block of push, drag or circling within a grapple), `release`, `holdBack`, `feint` (a cunning test in melee: the loser is forced to take their turn and use an action surge; `land` hands the turn over, `forcedSurge` holds who owes the surge), `pickUp`, `throw` (an item to a cell: its throwing row's reach and price, else a standard action), `drink` (a potion in hand, a standard action; what it gives lasts the fight), `reload` (one arrow or bolt from a quick slot into a held weapon whose row must be reloaded, at the row's reload price; the shot from that row fires what is loaded and leaves it empty; part of the shot: the focus surge, opportunity attacks), `rest`, `prepare` (an action and the trigger it waits for, for 1 AP: see `scene-map/mechanics.md`) |
| Generated roots | `explosion` (opened by a throw whose object goes off on impact, a cast with an area, or a Detonate Explosive cast), `blast` (an explosion going off), `fleeFollowUp` (the flee a strike or a missed shot leaves), `spellTest` (a target's test against a spell cast through a link, or a morale spell's morale test: the caster's action, the target's die), `fall` (the faller's Balance test, opened by a move that ended in a fall: a jump down, a climb that failed), `swimTest` (the swimmer's check, opened by a move that ended in water when they have not tested this round; its roll is theirs for the round) — plus strikes, moves, maneuvers and pushes that other actions open, marked by `spawnedBy` |
| Defenses (to a strike) | `evade` (also to a move), `evasiveJump`, `block`, `intercept` (a block or intercept may be prepared for an ally: see `scene-map/mechanics.md`) |
| Trample answers (to a move) | `evade`, `brace` |
| Reflexes | `evasion`, `guard` (to a shot, which may be prepared for an ally); `avoidExplosion` (to an explosion) |
| Opening reactions | `opportunityAttack` (strike, move, and every triggering kind), `retarget` (the same triggers as an opportunity attack, within a held spray's reach: opens a paint-only `fireAgain` before the root's effect), `counterattack` (strike), `prepared` (move: a preparation whose trigger came; it opens the movement it carries, then its action), `follow` (move), `joinShot` (shoot: a shot of the joiner's own at the same target) |
| Flee | `flee` (move): the movement surge made as a reaction; opens no action, hands the turn over instead |
| Grapple answers | `resist` (grapple, drag); `assist`, `carry`, `letGo` (drag) |

Three links tie the log together: `reactionTo` (a reaction points at its root),
`spawnedBy` (an opened action points at whatever opened it) and `followUpOf` (a follow-up
points at the action it follows). `rules/log.ts` holds every lookup over them, and nothing
else walks them: up (`getAncestry`, `getOrigin`, `getRootOf`, `getOpeningReaction`) and down
(`getDescendants`, `getReactionsTo`, `getSpawned`, `getOpenedBy`, `getOpenedMain`, `getPassedUp` for what was
opened and then passed up, `getDrawnOpportunityAttacks`). What a round or a turn needs to
remember is kept in a registry beside the log, emptied by `nextRound` (`heldTests`, with
every character's stealth roll, made as the round begins; `turnsTaken`: the turns something was committed
in and who rested in each; `prepared`: the preparations landed; `stealthTurns`: for each turn, whom its
holder began it undetected by and the AP their actions in it have spent, loud and to an ear;
all but the tests themselves written by `setActions` as actions land), or stamped on the action that needs it (a move's `held`, a sweep link's
`swept`), never found by scanning the record.

## The pipeline, step by step

| Step (`step`) | UI sub-step (`getNextStep`) | Commands (`commands/action.ts` unless noted) |
|---|---|---|
| `define` | `declare`, `target`, `aim`, `commit` | `declareAction`, `amendAction`, `setTarget`, `commitAction`, `cancelAction`, `withdrawSpawnedAction`; board clicks through `resolveClick` (`commands/click.ts`), which picks `pickCell` / `turnMove` and the rest |
| `react` | `react` | `declareReaction`, `amendReaction`, `withdrawReaction`, `withdrawLastReaction`, `boostPush` (the pusher's +5, also at `define`); then `rollAction(dice, newId)` or, for an action with no die, `payAction(newId)` |
| `post` | `spend`, `aim`, `choose`, `confirm` | `commands/choices.ts`: `spendHOP` / `refundHOP`, `chooseGrapple` (a hit with a grapple row grapples, free, only when the attacker says so), `improveSpell` / `refundImprovement`, `saveGraze`, `aimExplosion`, `chooseManeuver`; then `resolveAction(newId)` |
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
- **roll / pay** (`payAll`) — first, a prepared defense's reposition is walked (`repositionDefenders`) and the die waits; then prices the root and every reaction off their actors as they
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
  a cast opens, the explosion a thrown object goes off as where it lands, what the strike's
  recipes open (a hook's knockdown, an intercept's disarm, then the abilities': a riposte),
  a sweep's next target, and on top the fall a move ended in. A voided root generates only what an
  `evenIfVoided` opener gives (the counterattack).
- **`REACTION_OPENERS`** (`rules/openers.ts`) is typed `{ [K in ReactionKind]: Opener<K> }`:
  a new reaction kind does not compile until it says what it opens (`before`, `after`, or
  nothing). Follow-ups no reaction opens (blast, cast and impact explosions, stun escapes)
  live in `getFollowUps` itself.
- **Recipes** (`rules/recipes.ts`) — actions the rules give a fighter only by a recipe,
  written as data (`RecipeSchema`, `domain/types.ts`), of two types. A `followUp` is what a
  landed strike offers: when it fires (`defended`, `struck`), what it opens (a strike, a
  maneuver), and what that gets (a hit term, a price added or set, unresisted under a
  condition, whether it draws opportunity attacks, whether its maneuver may be gone along
  with). A `contestedReaction` lets its holder answer a strike aimed at them with the
  `counterattack` reaction — the pipeline is `counter.ts` and its opener — and says what its
  strike gets (a hit term). Every fighter has the rules' recipes (`RULE_RECIPES`:
  hook knockdown, intercept disarm); an ability adds its own in `abilities.json` (a stage's
  `recipes`: riposte, counterattack). The action carries the recipe's id (`recipe`): a
  follow-up from when it is opened, a counterattack from its trigger when it is declared,
  passed on to the strike it opens. The hit terms, the price, the triggers and the panel
  label read it from there. A new event, condition or opened kind is a word added to the
  schema and read here; the `Record`s over them do not compile until it is.
- **One follow-up each** — `land` stamps every follow-up still to be declared with
  `followUpOf` (the landed action). Once a character takes one, `advance` passes up their
  others from the same action as they come to the top (`isForgone`, `rules/log.ts`): a
  riposte or a flee, an evasion's move or a flee.
- **None for the interrupted** — `getFollowUps` offers no follow-up still to be declared
  to one the landed action interrupted (`isInterruptedBy`, `rules/interruption.ts`): what
  it landed on them, a shot with the shots joined to it, a crash, an area's or a spell's
  deliveries, or, for its own actor, a tied counterattack's strike. What opens already
  committed (explosions, spell tests, a counterattack's strike) is not a choice and is
  not gated here.
- **Auto-landing** — a root at `post` with nothing to choose (`hasPostChoice`: no HOP to
  spend, spray to point, pick to make, graze to save, rest move or along to decide) is
  landed by `advance` once its attacks are fought. `resolveAction` is only pressed where a
  choice was offered.
- **Withdrawing** an opened action (`withdrawSpawnedAction`: passed up), an answer taken back
  or changed for another (`withdrawReaction`, `declareReaction`), an answer its action no longer
  triggers (`pruneReactions`) and a forgone follow-up take it out of play through
  `withdrawActions`, with what answers it; each is written to `state.journal` with its reason
  (`WithdrawalReason`). Only a draft taken back before its commit (`discardDraft`) leaves nothing.
  An offer made once (a rest's move) is not made again once its journal entry says it was
  passed up (`getPassedUp`, `hasRestMove`); an opportunity attack's strike goes together with
  its reaction.
- **What the table is told** — `projections/episode.ts` `getLastEpisode`: the chain around the
  last action to land (`getOrigin`, `rules/log.ts`), each action with its cost lines
  (`costTerms`, the lines `getOwnCost` sums), the terms of its roll, the surge made for it
  (`surged`), why it came to less than declared, what was withdrawn from it, and where the
  book says it (`ACTIONS[kind].rule`, the table's own ruling where the book is silent). What its
  damage came to on each target is written when it lands (`results`, `commands/results.ts`,
  read off each target as they stand before it lands), the outcome and its steps with the rule
  each follows (`explainOutcome`, `character/rules/damage.ts`); an older record without
  `results` is read live. What its roll and landing changed in the fight (`changes`, found by
  comparing the fight before and after in `applyPhase`, `rules/changes.ts`) is written onto it,
  and what a command outside any action changed on a character (`updateCharacter`, which takes
  a cause) goes to `state.edits`.

## Detail files

Read only the one the change touches.

- `scene-map/mechanics.md` — charges and throws, links and concentration, rest, flee, coordinated shots, sweeps, breakage, attacks against equipment.
- `scene-map/landing.md` — interruption, giving up and voiding; settle then reduce; what the fight puts on a character.
- `scene-map/board.md` — hex geometry, ground, hazards, move rules, board edits; the UI projections and hooks.

## File map

```
app/domain/scene/
├── types.ts            SceneState, Board, every Action schema, derived action types
├── factories.ts        makeAction, makeBoard (ingestion), addCharacterToCombat
│
├── commands/                        the write side
│   ├── action.ts       the pipeline buttons: declare … commit, react, roll/pay, resolve
│   ├── results.ts      getResults: what a landing action's damage comes to on each target, with the steps, written onto it by `land`
│   ├── choices.ts      post-roll choices: HOP, spell improvements, graze save, aims, maneuver picks
│   ├── sequence.ts     advance, land, openBefore, getFollowUps, the flee handover — the engine
│   ├── log.ts          setActions (only writer of actions/stack/record), withdrawActions (the only way out of play but a draft, writes the journal), discardDraft, applyPhase, pruneReactions
│   ├── reduce.ts       reduceCharacter / Grapples / Floor / Board, by phase
│   ├── bind.ts         settleBinds
│   ├── breakage.ts     toggleBreakage: the optional equipment-breakage rule on or off
│   ├── board.ts        board editing, pickCell / turnMove (clicks during an action)
│   ├── click.ts        resolveClick: what a click on a cell, token, floor item or the turn button does
│   ├── floor.ts        dropToFloor, throwOffShieldToFloor, pickFloorItem
│   ├── characters.ts   removeFromCombat, updateCharacter
│   ├── parties.ts      joinFight, addToFight, moveToParty, splitOff, renameParty: the scene's parties, inherited from the campaign and changed by the table
│   ├── nextRound.ts    round change: charges and upkeep of held spells, gas, burning, bleed, AP reset, the holders' focus surge, the free paint-only fireAgain (`upkeep`) each held spray's holder owes an aim
│   ├── turn.ts         startTurn, toggleContest, rollContest, endTurn, surge (turn-gated)
│   ├── closeTurn.ts    a holder's turn over: surge AP lost, fire burns (endTurn and a won feint)
│   ├── morale.ts       rollMorale: the will test a round's call is answered with, and what it leaves
│   ├── heldTest.ts     held tests: rollHeld answers a round's call; holdRoll writes a roll down and lets its effect work; holdThrown makes the die of a held test thrown as an action's (a swim test, a climb, a balance test) the round's (called by applyPhase at the roll); dropFallenBalance (at the resolve)
│   ├── swim.ts         sink, sinkInArmor: the swimmer goes deeper, no deeper than the floor
│   ├── social.ts       say: intimidate, taunt, rally or an abusive's insult for 5 AP, written to `state.pressure`; surrender (flag in `state.surrendered`), unsurrender (free), negotiate (5 AP only), defaultToCoward
│   ├── stress.ts       oweStress (the last morale test makes the activated limit stress actions owed into `state.compulsions`; tanatosis and a martyr who can pay make theirs at once), compelByTest (a morale spell's test landing: a miss owes a limit stress action at once, bound to its caster as the spell says; Pacify takes one back; `land` calls it, and `advance` hands the turn to the compelled once nothing is open, closing the holder's as a feint does), takeStressTurn (the next owed turn begins; also called by endTurn), markStress
│   ├── fight.ts        sendToFight, returnFromFight, removeFromFight, resetFight, loadIntoFight, loadOntoRoster: characters off the campaign's roster into the scene and back under the ids they left with, in the parties the scene left them in, with the ETs it took
│   ├── chase.ts        startChase, declareChase (a party's move for the round, head of the chain first: run, run the other way, shoot, hide, with what it scouts for), resolveChase (hiders hide, every live link is run — the two ends' ways, the faster deciding when they pull apart, a skirmish's way waiting for the round's end — runners pay, skirmish AP, scouting), followParty, putBack, giveUp, mergeBack, runOn, setPartyFighting, joinFight, crossObstacle, turnAround, setChaseCover, endChase; endChaseRound (called by nextRound: skirmish ways, places run towards, arrivals, disconnected parties out)
│   ├── resetCombat.ts
│
├── rules/                           what the book says about a state
│   ├── board/                       the grid: what only a fight on the board asks
│   │   ├── geometry.ts     hex math, no rules
│   │   ├── board.ts        footprints, distance, reach, sight, flankers, threateners
│   │   ├── ground.ts       crossable and restable cells
│   │   ├── cliff.ts        what is a cliff, which movement may step over one, the climb's DL, the fall a move ends in
│   │   ├── waypoint.ts     where the mover stands along a path
│   │   ├── reach.ts        getReachableCells: the spaces a declared move may be taken to (every reader of a move's reach asks here; `move.ts` `getWalkableCells` is the raw walk)
│   │   ├── hazard.ts       fire and gas on the ground, what a footprint stands in, what a move walks through, the fire a landing touched, fuel catching fire
│   │   ├── light.ts        light: the board's level (bright, dim, dark) and darkness painted on it; bright within the radius of a light held in hand or lying on the floor — an item's own, or one Lamp or Revealing Light cast into it — walls casting shadow (`getCellLight`, `getLightOf`, `isUnlit`); Darkseeing drunk sees clearly in dim light
│   │   └── boardMode.ts    getBoardMode (what the open action wants of a click), getFloorPicker
│   │
│   ├── actionCatalog.ts ACTIONS (with each kind's `rule`), isReaction/isRootAction/isDefense
│   ├── deliveries.ts   what an action delivered, per character
│   ├── changes.ts      getChanges: what a step changed in the fight, by comparing it before and after
│   ├── log.ts          open action, stack lookups, reactionTo/spawnedBy lookups
│   ├── action.ts       declaration completeness, costs, getNextStep, needsDie, targets
│   ├── options.ts      getAvailableActions / findOption: what may be declared, and why not
│   ├── turn.ts         whose turn it is; who may start, contest or end one, or surge
│   ├── surge.ts        the actions behind each surge allowance in `SURGES` (tables.ts), and a flee turn
│   ├── feint.ts        who may be feinted, the cunning terms, who the test forces
│   ├── flee.ts         who may flee, its price, the stop it puts on a move, who a landed action offers or sends fleeing
│   ├── reactions.ts    getTriggers: who may answer a committed action, with what
│   ├── openers.ts      REACTION_OPENERS: what each reaction opens, before or after
│   ├── settle.ts       getSettled: an action as it lands
│   ├── interruption.ts getInterruptions, isBroken
│   ├── opportunity.ts  opportunity attacks: board state while fought, stops, giving up, isVoided
│   ├── coordinated.ts  joined shots: the lead, the group, the shot a join opens
│   ├── counter.ts      the contested-reaction pipeline: counterattack slot (before / tie / after) and its strike
│   ├── recipes.ts      follow-ups and contested strikes as data: who may make them, their hit, price and opportunity attacks
│   ├── sweep.ts        sweeps: the arc, the chain of strikes, the share each passes on
│   ├── protect.ts      protecting another: the line, Defender and Defensive Advance steps
│   ├── attack.ts       weapon rows per action, test terms and DLs, defending reaction
│   ├── test.ts         isWon and resisted: what a test's degree means for an action
│   ├── breakage.ts     the blow a block met: what it broke, the dice it needs, the setting's bar
│   ├── damage.ts       attack deliveries, interruption, HOP options and prices, hooked motion
│   ├── delivery.ts     a row's damage as it leaves the weapon
│   ├── weaponRow.ts    rows in hand, usable rows, variants
│   ├── cast.ts         spells: options, facts, improvements, graze save, explosion a cast opens
│   ├── fireAgain.ts    held spells fired again: options, prices, charges, the arcs broken, a shot's facts
│   ├── explosion.ts    payload, areas, zones, spray vs disk, who is reached, terrain paint
│   ├── move.ts         movement prices, path legality, runs, Balance, move override, jumps
│   ├── approach.ts     how a mover's way brings them to someone: distances along it, the step that first comes within a range
│   ├── prepared.ts     prepared reactions: what is prepared in the round, its zone and triggers (a move's, and an attack's for a defense made for an ally), what a fired one opened, a defense's reposition, cancelling and no chaining
│   ├── fall.ts         a fall: its DL, damage, what each degree of the Balance test leaves of it
│   ├── reactionMoves.ts the moves evasion, follow and explosion reflexes open
│   ├── trample.ts      crashes: Force comparisons from moves, braced blows and catches
│   ├── extinguish.ts   the burning spaces in reach to muffle, and a space with its fire put out
│   ├── grapple.ts      grapple rows, maneuvers, grabs, releases, stun escapes, grapple facts
│   ├── partners.ts     who is grappled with whom
│   ├── bind.ts         which binds still hold (grapple, tether, arc, link): each holder against what they maintain it with
│   ├── situational.ts  what the fight puts on a character: gas suffocation, grapple afflictions
│   ├── morale.ts       aggravators and the DL (social pressure of the round before included), who a round calls to a test, the outcome of each degree; `state.morale` holds the calls, and a turn waits on them
│   ├── heldRoll.ts     held tests, the reads: a character's roll for the round, the one a move carries (`getMoveHeld`), what bars a roll or the turn
│   ├── heldTest.ts     held tests, the registry of called kinds (`HELD_DEFS`, typed over `CALLED_TESTS`): who the round calls, the skill terms, the DL of a call, the ways it may be rolled
│   ├── swim.ts         the water a footprint stands in (surface, floor, DL), depth, the swim test's terms, each metre's degree off the held score, the dive, the prone a swim out of the water ends in
│   ├── social.ts       who a social action may be said to, and when it, a surrender, an unsurrender or a negotiation is barred
│   ├── stress.ts       limit stress actions: what each compels (`STRESS_DUTIES`), the substitutions, the owed order (worst morale test first), the bars that keep the turn open until the duty is done or cannot be, `isMartyrGuard` (a martyr holding the surge may run onto the protect line: `getDefenderSteps`), and what a spell binds the compelled turn to: `isCompelledTarget` (read by `getTargetIds`), `isCompelledAway` (read by `getReachableCells` and the move's completeness)
│   ├── moraleSpell.ts  morale spells (`MORALE_SPELLS`, tables.ts): whom a cast tests (the target, or every mind the caster's synesthesia or link reaches), what Suggestion may suggest, the outcome a test settles to (`getMoraleOutcome`, written on the spell test as `morale`)
│   ├── drag.ts         push and drag: sides, the +5 order, prices, the block's way and reach
│   ├── floor.ts        items on the floor, reachable, a shot's thrown weapon, one of a stack, one broken
│   ├── floorAttack.ts  a strike or a shot aimed at an item on the floor or a space of the ground: its DL, what it can be aimed at, the explosion it sets off, where it lands
│   ├── ignition.ts     the burning damage an attack carries, which lights the fuel where it lands
│   ├── throw.ts        what can be thrown, how far, at what price, what lands
│   ├── reload.ts       reloads: the rows in hand that are reloaded, why one cannot be, the stack it takes and what it leaves in the weapon (`Item.loaded`)
│   ├── detection.ts    senses: how impaired each of an observer's senses is against a target (`none`, `partial`, `total`: line of sight, darkness no light reaches, bad and zero visibility, fog's radius, a sense's range, touch and smell at 0 m being a grapple partner, camouflage carried, the afflictions that blind, deafen or worsen a sense), and what each detects at; `getActionHeading`, the way a landed action leaves a one-cell token facing, drawn only (written by `reduceBoard`)
│   ├── stealth.ts      whether an observer has a target (`notices`): outside the target's turn by the board (an unimpaired active sense detects, a partial one tests against the round's score); in their own turn only against whoever is in their `stealthTurns` entry, by the best reactive sense against the score less the turn's noise and the pending action's (`noise`, stamped at commit by `getNoise`); `getTargetIds` closes who is not noticed, `getTriggers` drops who does not notice the actor; `getReactionSensePenalty`, the penalty of the sense a reaction relies on, on the reaction's own test
│   ├── aim.ts          where the open action waits to be pointed on the board
│   ├── chase.ts        a chase (`state.chase`, combat.tex "Chases"): the chain of links (each party chases at most one other, at a tier; a team is the side that ran away first or gave chase), the starting chain, who is held (fighting, separated, joining), far links frozen while enemies are at combat range, who declares and in what order, run speeds, who is caught, what may be declared and resolved, the tier between two parties (the farthest on the chain between them, `getChaseDistance`, read by `getDistanceBetween`, so reach, shot penalties, spells and senses see it; a shot crosses tiers by the tier its range names, `reachesTier`), how long a round takes (`state.elapsed`), the routing bonus, cover, skirmish AP, the hiding, scouting and crossing tests, following, putting back, merging back, joining a fight, and a party splitting (`getSplitChase`, called by splitOff)
│   ├── fight.ts        getReturnBar, isFromRoster, getHomecoming: why the scene cannot give its characters back now, and the party it gives each back to
│   └── fighters.ts     active character, fight names, who holds an item
│
└── projections/                     read-for-UI, no setters
    └── actionPanel.ts, boardView.ts, chase.ts, roster.ts, outcomes.ts, episode.ts, labels.ts, turn.ts, morale.ts, heldTests.ts, senses.ts, prepare.ts
```

The combat domain calls into `character/` (costs, afflictions, deliveries, skill terms,
effects) and `item/` (hands, items). The skill test itself (`resolveTest`, `getDegree`) and
the dice live in `domain/play/`, shared with every other part of play; the character's effect
processor (`character/commands/deliver.ts`) rolls a delivery's test there and reads it with
`resisted` from `rules/test.ts`.

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
  knockdowns; protecting; coordinated shots; sweeps.
- `commands/action.test.ts`, `commands/combat.test.ts` — pipeline guards and round change.
- `rules/*.test.ts` — boardless fights pass every gate; reach; moves; grapples; reactions.
- `projections/outcomes.test.ts` — the preview is what the target takes.
- `record.test.ts` — a record's terms add up to its roll and cost; nothing but a draft leaves play without landing or reaching the journal.
- `factories.test.ts` — board ingestion is total and round-trips.

All tests follow `instructions/testing.md`.
