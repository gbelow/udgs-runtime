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
   `state.actions`, a table keyed by id that holds it both in play (`state.live`) and once landed
   (`state.landed`): who, against whom, what was declared, what the die said, and — once it
   lands — what it came to (`facts`). Nothing about an action is computed twice: whatever
   needed two characters to work out is written onto the record when the transition
   happens, so the reducers that land it need only the record.

3. **Every action runs the same pipeline.** `define → react → roll → post → effect`, stored
   as `ActionBase.step` (`define | react | post | done`). The roll and the effect are
   transitions, not places an action waits. One more step stands apart: `held`, an action
   that requires concentration committed without the AP for it, paid as far as the AP went
   and waiting for the round to change. It is in play (`state.live`) but never on the stack,
   until the round change takes it up at `react` (`mechanics.md`, Concentration).

4. **A stack decides whose turn it is to be played out.** `state.stack` holds ids of root
   actions still being played out; the top is the open one (`getOpenAction`). Anything an
   action opens — the strike an opportunity attack opens, a riposte, the blast of an
   explosion — is pushed over it and played out first. `state.landed` holds the ids in the
   order they *landed* (`getHistory`), which differs from the order they were declared, and
   is only ever added to; a draft taken back leaves the table and `state.live`. The ordered
   log (`getLog`) is put together from those lists for whoever shows it. What
   was committed, or offered, and then withdrawn without landing goes into `state.journal`
   with its reason (`withdrawActions`), so nothing leaves play without a trace but a draft.

5. **An action writes only its own record, but for what happens to it on the way.** Apart
   from its own transitions, the only things written onto an action after its commit are
   facts that happen to it while it is still in play, and `setActions` writes them
   at the moment they happen: the interruptions landed on its actor (`interruptions`) and
   the reactions its actor declared within it (`reactedWithin`). No rule finds them by the
   order or place of anything in the log. Being given up or voided is derived from those
   (`rules/opportunity.ts`, `rules/interruption.ts`).

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

10. **The domain holds no entropy.** Dice come in from whoever throws them (`Throw`,
    `play/calls.ts`): a plain `Dice` function answers every die at once (bots, tests, the
    fuzzer), and a `Thrower` may leave a die to the table. A command that throws test dice
    runs through `calling` (`commands/calling.ts`): each die is a call, and while any waits,
    the command keeps nothing but `state.calls` and what to carry on with (`state.resume`);
    `answerScene` (`commands/answer.ts`) puts a die in and, with the last, runs that
    command again over the calls. A die is called for only where a rule reads it: a
    target's die for what an action delivers when it lands (`getOwedDice`,
    `rules/settle.ts`), a climber's redo when an attack interrupting the climb lands
    (`getInterruptedClimb`), so `advance` and `land` take the caller and stop while a die
    waits. While the scene waits, nothing else moves: the options and the board show
    closed (`getDiceBar`), the busy bars say so, another calling command is refused, and
    the store keeps any change that leaves the calls as they were from landing
    (`holdForDice`, `play/calls.ts`). Percentiles (breakage, charges, the
    chase's coin) are never called for. `components/utils.tsx` is the one `Math.random` seam; ids come as a
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
(never declared by a player), `identity` (fields telling two options of a kind apart), `group` (the panel heading its options go under), `rest` (counts as a rest: open at the round's rest step and may overdraw the AP to come).

Types derived from it in `types.ts`: `ReactionKind` / `ReactionAction`, `RootAction` (every
non-reaction), `InterruptibleAction` (every non-reaction but movement), `DeclarableKind`,
and `ActionDraft` (what a click declares).

| Group | Kinds |
|---|---|
| Declarable roots | `strike`, `shoot`, `cast`, `fireAgain` (a held spell fired again without the casting test), `releaseSpell` (a held spell let go of in the actor's turn, for nothing: open while concentrating, immobile or under a surge, `reduceCharacter` calls `releaseSpell`), `move`, `grapple`, `drag` (one block of push, drag or circling within a grapple), `release`, `holdBack`, `feint` (a cunning test in melee: the loser is forced to take their turn and use an action surge; `land` hands the turn over, `forcedSurge` holds who owes the surge), `pickUp`, `throw` (an item to a cell: its throwing row's reach and price, else a standard action), `drink` (a dose of a potion in hand, a standard action, as many doses as the drinker's VM: `character/commands/consume.ts` `takeDose`; a heal lands at once, what lasts is kept as a `potion` active entry for its ETs, worn off as the campaign clock passes), `firstAid` and `cauterize` (abilities.tex "Medicine", `rules/medicine.ts`: aimed at a bleeding character next to the actor or the actor, the focus surge made, priced by the ability; First Aid's medicine test against twice the bleed lowers it 0/0/1/2 and on a hit staunches it until the round changes, `injuries.staunched`; Cauterization lands 10 burn ignoring armor and 2 bleed off, no die), `plant` (abilities.tex "Crossbow and Shield": a body shield in hand set down in the planter's space facing a cell next to them, for a standard action; it lies on the floor with `planted`, and covers its planter while they stand there, as a held one after a guard does; taking it back is a pick up), `reload` (one arrow or bolt from a quick slot into a held weapon whose row must be reloaded, at the row's reload price; the shot from that row fires what is loaded and leaves it empty; part of the shot: the focus surge, opportunity attacks), `rest`, `prepare` (an action and the trigger it waits for, for 1 AP: see `scene-map/mechanics.md`), `social` (combat.tex "Social actions": what it `say`s — intimidate, rally, an abusive's insult, negotiate, surrender, unsurrender — for 5 AP, unsurrendering free; counted as a rest (`ACTIONS[kind].rest`), so open in the actor's turn or the round's rest step and free to overdraw the AP to come, unsurrendering at any time) and `taunt` (its one enemy picked as the target); the panel lists both under a social heading (`ACTIONS[kind].group`) |
| Generated roots | `explosion` (opened by a throw whose object goes off on impact, a cast with an area, a Detonate Explosive cast, or the GM at a cell with an effect and a DL of their own), `blast` (an explosion going off), `fleeFollowUp` (the flee a strike or a missed shot leaves), `spellTest` (a target's test against a spell cast through a link, or a morale spell's morale test: the caster's action, the target's die), `fall` (the faller's Balance test, opened by a move that ended in a fall: a jump down, a climb that failed), `swimTest` (the swimmer's check, opened by a move that ended in water when they have not tested this round; its roll is theirs for the round) — plus strikes, moves, maneuvers and pushes that other actions open, marked by `spawnedBy` |
| Defenses (to a strike) | `evade` (also to a move), `evasiveJump`, `block`, `intercept` (a block or intercept may be prepared for an ally: see `scene-map/mechanics.md`) |
| Trample answers (to a move) | `evade` (opens the evader's block of basic movement out of the mover's way before the move lands, forced when the mover ends in their space, `rules/sidestep.ts`), `brace`; unanswered, or braced, it is a crash, and one the mover wins in the space it ends in is displaced first (`rules/displace.ts`) |
| Reflexes | `evasion`, `guard` (to a shot, which may be prepared for an ally); `avoidExplosion` (to an explosion) |
| Opening reactions | `opportunityAttack` (strike, move, and every triggering kind; it opens a strike, a maneuver against a grapple partner, or, by one who has learned Archer's Reflexes, a quick shot, `mode: 'shoot'`, open to them wherever the root draws an opportunity attack from anyone while they have made the focus surge; nobody joins that shot), `retarget` (the same triggers as an opportunity attack, within a held spray's reach: opens a paint-only `fireAgain` before the root's effect), `counterattack` (strike), `prepared` (move: a preparation whose trigger came; it opens the movement it carries, then its action), `follow` (move), `joinShot` (shoot: a shot of the joiner's own at the same target) |
| Flee | `flee` (move): the movement surge made as a reaction; opens no action, hands the turn over instead |
| Grapple answers | `resist` (grapple, drag); `assist`, `carry`, `letGo` (drag) |

Three links tie the log together: `reactionTo` (a reaction points at its root),
`spawnedBy` (an opened action points at whatever opened it) and `followUpOf` (a follow-up
points at the action it follows). They are kept only on the action that points, like a
foreign key; `rules/log.ts` indexes them once for each table of actions (`getLinks`), so a
lookup either way is a lookup, never a scan. It holds every lookup over them, and nothing
else walks them: up (`getAncestry`, `getGivenRiseBy` without follow-ups, `getOrigin`, `getRootOf`, `getOpeningReaction`) and down
(`getReactionsTo`, `getSpawned`, `getOpenedBy`, `getOpenedMain`, `getPassedUp` for what was
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
| `define` | `declare`, `target`, `aim`, `commit` | `declareAction`, `amendAction`, `setTarget`, `commitAction`, `cancelAction`, `withdrawSpawnedAction`; board clicks through `readClick` (`commands/click.ts`), which picks `pickCell` / `turnMove` and the rest |
| `react` | `react` | `declareReaction`, `amendReaction`, `withdrawReaction`, `withdrawLastReaction`, `boostPush` (the pusher's +5, also at `define`); then `rollAction(dice, newId)` or, for an action with no die, `payAction(newId)` |
| `post` | `spend`, `aim`, `choose`, `confirm` | `commands/choices.ts`: `spendHOP` / `refundHOP`, `chooseGrapple` (a hit with a grapple row grapples, free, only when the attacker says so), `improveSpell` / `refundImprovement`, `saveGraze`, `aimExplosion`, `displaceTrampled` (where a won crash puts its defender), `chooseManeuver`; then `resolveAction(newId)` |
| `done` | — | — |

- **define** — free to edit or cancel. Only one root can be declared at a time
  (`declareAction` refuses while anything is open), and only by the character whose turn
  it is (`inTurnCharacter`, `rules/turn.ts`); while a movement or combat surge has AP left,
  only what it allows (`rules/surge.ts`). Before the combat has started
  (`rules/started.ts`, round 0) nobody takes a turn, anyone declares, nothing costs
  AP or STA, and no surge is made or asked for (flee and feint are closed): every price
  check, payment and surge requirement is handed whether the combat has started. The first
  round starts everyone at the round's AP and full STA.
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
  unpaid. A cast, a held spell fired again and a strike (or counterattack) declared with
  something that leaves a test also throw their target's die (`targetDice`, `rules/tested.ts`), read when they land. The root goes to `post`, its reactions to `done`. Refused as a whole if anyone
  cannot pay.
- **post** — choices made once the result is known; each only edits the rolled record and
  is reversible (except `saveGraze`, whose price is paid as it is bought).
- **effect** (`resolveAction` → `land`) — settle, apply, generate follow-ups. An instant
  delivery that leaves its target a test is tested in the settle with the die they threw
  (`withDeliveredTests`), so what it lands, an interruption above all, is known before any
  follow-up is offered; one they beat is dropped, and each test is written on the action
  (`tested`). Only a test someone owes a choice on (accepting a link, safe or risky) is an
  action of its own.

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
│   ├── calling.ts      calling: a command's test dice as calls kept on the scene while any waits on the table
│   ├── answer.ts       answerScene: a die put into a call, and with the last, the command that called carried on
│   ├── log.ts          setActions (only writer of actions/live/stack/landed), withdrawActions (the only way out of play but a draft, writes the journal), discardDraft, applyPhase, pruneReactions
│   ├── reduce.ts       reduceCharacter / Grapples / Floor / Board, by phase
│   ├── bind.ts         settleBinds
│   ├── breakage.ts     toggleBreakage: the optional equipment-breakage rule on or off
│   ├── board.ts        board editing, pickCell / turnMove (clicks during an action)
│   ├── click.ts        readClick: what a click on a cell, token, floor item or the turn button does
│   ├── registry.ts     sceneCommands: every scene press and board click as data (kind and plain args), the command it runs and whom it acts for; applySceneCommand refuses what the sender may not do. Lists the chase's commands without being a crossing point (eslint rule 6)
│   ├── tableRegistry.ts tableCommands: what crosses between the campaign and the fight (sent, brought back, loaded, taken out, reset), as data on the same pattern (domain/registry.ts)
│   ├── gmExplosion.ts  setOffExplosion: the GM's explosion at a cell, a one-effect disk with its own DL and no producer (`source: 'gm'`), opened committed
│   ├── floor.ts        dropToFloor, throwOffShieldToFloor, pickFloorItem
│   ├── characters.ts   removeFromCombat, updateCharacter, impose (the GM lays a delivery — a test and what rides on it — on the characters picked, each rolling their own pending die)
│   ├── parties.ts      joinFight, addToFight, moveToParty, splitOff, renameParty: the scene's parties, inherited from the campaign and changed by the table
│   ├── nextRound.ts    the round change, a step at a time (its order in `rules/roundChange.ts`, where it stands in `state.roundStep`): nextRound (AP received on top of what is left, tanatosis woken, the round's registries emptied, swimming and stealth called), continueRound (bleeding, then the environment: burning and gas; the AP cut down to the round's and the round end's upkeep paid by whoever keeps nothing going; then who joins, then the morale calls; then back to turns); in a chase a step with nothing for anyone passes on its own (with everyone running: no rest, no joining, no morale calls for runners; the chase step while a chase is on), leaving only the ticks and the concentration choice between chase rounds, holdOn / letGo (a concentrating character's choice, written to `state.concentration`: held spells' charges, upkeep and the focus surge, an action held over carried on, or everything let go and the held actions finished)
│   ├── hold.ts         actions held over to the next round: holdOver (the commit), giveUpHeld (a reaction gives it up), breakHeld (an interruption breaks it), finishHeld (the round change: who finishes and the cunning order), carryOver (holding on), releaseNextHeld (taken up at `react` once nothing is open; called by `advance`)
│   ├── turn.ts         startTurn, toggleContest, rollContest, endTurn, surge (turn-gated)
│   ├── closeTurn.ts    a holder's turn over: surge AP lost, fire burns (endTurn and a won feint)
│   ├── morale.ts       rollMorale: the will test a round's call is answered with, and what it leaves
│   ├── heldTest.ts     held tests: rollHeld answers a round's call; holdRoll writes a roll down and lets its effect work; holdThrown makes the die of a held test thrown as an action's (a swim test, a climb, a balance test) the round's (called by applyPhase at the roll); dropFallenBalance (at the resolve)
│   ├── swim.ts         sink, sinkInArmor: the swimmer goes deeper, no deeper than the floor
│   ├── social.ts       landSocial: what a landed `social` or `taunt` leaves (called by `land`'s `landOnTable`, beside the feint's and the spell test's) — the pressure written to `state.pressure`, the surrender flag in `state.surrendered`, an abusive's insult or a traitor's negotiation marked done; defaultToCoward (the GM's)
│   ├── stress.ts       oweStress (the last morale test makes the activated limit stress actions owed into `state.compulsions`; tanatosis and a martyr who can pay make theirs at once), compelByTest (a morale spell's test landing: a miss owes a limit stress action at once, bound to its caster as the spell says; Pacify takes one back; `land` calls it, and `advance` hands the turn to the compelled once nothing is open, closing the holder's as a feint does), takeStressTurn (the next owed turn begins; also called by endTurn), markStress
│   ├── fight.ts        sendToFight, returnFromFight, removeFromFight, resetFight, loadIntoFight: characters off the campaign's roster into the scene and back under the ids they left with, in the parties the scene left them in, with the ETs it took; one brought straight in under an id the campaign gives and lends (`lent`), released when they are gone
│   ├── chase.ts        startChase (the runners leave the grid), declareChase (a party's move for the round, head of the chain first: run, run the other way, shoot, hide, with what it scouts for), confirmChase (tail to head once everyone has declared; what is confirmed is final), resolveChase (hiders hide, every live link is run — the two ends' ways, the faster deciding when they pull apart, a skirmish's way waiting for the round's end — runners pay, skirmish AP, scouting), followParty, putBack, giveUp, mergeBack, setPartyFighting (a party running again leaves the grid), joinFight, crossObstacle, turnAround, setChaseCover; endChaseRound (called by nextRound: skirmish ways, places run towards, arrivals, disconnected parties out); endChaseRoundChange (called as the round change ends: a party with nobody alive is out, its pursuers taking over its link)
│   ├── endCombat.ts    endCombat: the rounds end and everyone stays — `leaveFight` on each, the round back to 0 with nothing the rounds held, held actions finished (`finishHeld`) for nothing; the log stays; `endScene` is the ending itself, shared with following a party
│   ├── parked.ts       followScene: once a chase is over (`isChaseOver`) the table picks the party the scene follows, ending the chase and the combat with everyone staying; the other parties are parked off the grid, and the follow can be switched later out of combat
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
│   │   ├── light.ts        light: the board's level (bright, dim, dark) and darkness painted on it; bright within the radius of a light held in hand or lying on the floor — an item's own, or one Lamp or Revealing Light cast into it — walls casting shadow (`getCellLight`, `getLightOf`, `isUnlit`); a Darkseeing potion taken (its `light:dim` suppression) sees clearly in dim light
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
│   ├── interruption.ts getInterruptions, isBroken; getInterruptionBy: the strongest of what a landed action did to someone's own action (its blow, a shot group's, a crash, its deliveries), read by isInterruptedBy and the stun escapes
│   ├── tested.ts       the tests a landing action's instant deliveries leave their targets (and what follows a strike's blow), rolled with the dice they threw with it
│   ├── declaration.ts  the declarations an attack is made with (`StrikeDeclaration`, `ShotDeclaration` in types.ts), copied whole by picks read off the schema
│   ├── strikeDeclaration.ts one strike declaration, whatever declares it (a turn, an opportunity attack, a counterattack, a preparation, a recipe, a sweep): its context (what it answers, the step that drew it) and the variations open there
│   ├── modifiers.ts    every yes-or-no an action is declared with besides what it is (each kind's `modifiers`: catch, Martial Spirit, Tackle, Gentle Art, Precise Evasion, Technical Lift, Defensive Advance, Lunge, Jump Shot), each with when it is allowed, its price, what it puts on the test, what it delivers with a blow, and whether it is offered as a toggle or as an answer of its own
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
│   ├── fall.ts         a fall: its DL and test terms, the landing's ground (the damage per degree is `character/rules/fall.ts`, shared with the `fall` effect)
│   ├── impose.ts       the GM's test: the draft the form fills, the delivery it makes (a fall is tested on Balance against its height's DL, its degree read directly), why nothing can be laid on now
│   ├── reactionMoves.ts the moves evasion, follow, explosion reflexes and an evade open
│   ├── sidestep.ts     an evade's step: opened before the trample lands with the mover off the board (put back by `reduceBoard` from the step's `passing`), its reach (off the mover's heading, level, dry), forced when the mover ends in the evader's space, why evading is closed then
│   ├── displace.ts     a won crash in the space the move ends in: who is displaced, the spaces the attacker may put them in (`getAim` 'displace', picked by `displaceTrampled`), the forced movement each is made into before the move lands (`land`), and where the move reads them meanwhile (`withDisplaced`)
│   ├── trample.ts      crashes: Force comparisons from moves, braced blows and catches
│   ├── extinguish.ts   the burning spaces in reach to muffle, and a space with its fire put out
│   ├── jumpAttack.ts   a jump declared as Lunge or Jump Shot (abilities.tex): what each costs and opens, where it may land (a jump shot backward, at half the jump), and the attack it opens from there
│   ├── plant.ts        a body shield planted (abilities.tex "Crossbow and Shield"): the shields one may plant, the cells it may face
│   ├── steadyArms.ts   a shot declared on a careful path (abilities.tex "Steady Arms"): the path and the step it is fired from are part of the shoot declaration; the steps before it are walked first as a move of their own (opened committed by `commitAction`), the shot is made from where they end, the steps after it are offered as a move once it has landed; the declaration reads the shooter as standing at the firing step (`getFiringState`). Both moves are bought with the shot's AP (`getCarriedMove`, shared with the move a rest allows)
│   ├── grapple.ts      grapple rows, maneuvers, grabs, releases, stun escapes (of whoever a landed action stunned), grapple facts
│   ├── partners.ts     who is grappled with whom
│   ├── bind.ts         which binds still hold (grapple, tether, arc, link): each holder against what they maintain it with
│   ├── situational.ts  what the fight puts on a character: gas suffocation, grapple afflictions
│   ├── morale.ts       aggravators and the DL (social pressure of the round before included), who a round calls to a test, the outcome of each degree; `state.morale` holds the calls, and a turn waits on them
│   ├── heldRoll.ts     held tests, the reads: a character's roll for the round, the one a move carries (`getMoveHeld`), what bars a roll or the turn
│   ├── heldTest.ts     held tests, the registry of called kinds (`HELD_DEFS`, typed over `CALLED_TESTS`): who the round calls, the skill terms, the DL of a call, the ways it may be rolled
│   ├── swim.ts         the water a footprint stands in (surface, floor, DL), depth, the swim test's terms, each metre's degree off the held score, the dive, the prone a swim out of the water ends in
│   ├── social.ts       who hears a social action (`getHeard`), and why each one, a taunt included, is closed beside what closes any own action
│   ├── stress.ts       limit stress actions: what each compels (`STRESS_DUTIES`), the substitutions, the owed order (worst morale test first), the bars that keep the turn open until the duty is done or cannot be, `isMartyrGuard` (a martyr holding the surge may run onto the protect line: `getDefenderSteps`), and what a spell binds the compelled turn to: `isCompelledTarget` (read by `getTargetIds`), `isCompelledAway` (read by `getReachableCells` and the move's completeness)
│   ├── moraleSpell.ts  morale spells (`MORALE_SPELLS`, tables.ts): whom a cast tests (the target, or every mind the caster's synesthesia or link reaches), what Suggestion may suggest, the outcome a test settles to (`getMoraleOutcome`, written on the spell test as `morale`)
│   ├── drag.ts         push and drag: sides, the +5 order, prices, the block's way and reach
│   ├── floor.ts        items on the floor, reachable, a shot's thrown weapon, one of a stack, one broken
│   ├── floorAttack.ts  a strike or a shot aimed at an item on the floor or a space of the ground: its DL, what it can be aimed at, the explosion it sets off, where it lands
│   ├── ignition.ts     the burning damage an attack carries, which lights the fuel where it lands
│   ├── throw.ts        what can be thrown, how far, at what price, what lands
│   ├── medicine.ts     First Aid and Cauterization: who may be tended, the bar, the price off the ability, the test, what lands
│   ├── hold.ts         concentration: which actions require it (`requiresConcentration`), the held ones (`getHeldOf`), whether a reaction gives one up and what it gets back (`isGivingUpHeld`, `getHeldRefund`)
│   ├── reload.ts       reloads: the rows in hand that are reloaded, why one cannot be, the stack it takes and what it leaves in the weapon (`Item.loaded`)
│   ├── detection.ts    senses: how impaired each of an observer's senses is against a target (`none`, `partial`, `total`: line of sight, darkness no light reaches, bad and zero visibility, fog's radius, a sense's range, touch and smell at 0 m being a grapple partner, camouflage carried, the afflictions that blind, deafen or worsen a sense), and what each detects at; `getActionHeading`, the way a landed action leaves a one-cell token facing, drawn only (written by `reduceBoard`)
│   ├── stealth.ts      whether an observer has a target (`notices`): outside the target's turn by the board (an unimpaired active sense detects, a partial one tests against the round's score); in their own turn only against whoever is in their `stealthTurns` entry, by the best reactive sense against the score less the turn's noise and the pending action's (`noise`, stamped at commit by `getNoise`); `getTargetIds` closes who is not noticed, `getTriggers` drops who does not notice the actor; `getReactionSensePenalty`, the penalty of the sense a reaction relies on, on the reaction's own test
│   ├── aim.ts          where the open action waits to be pointed on the board
│   ├── chase.ts        a chase (`state.chase`, combat.tex "Chases"): the chain of links (each party chases at most one other, at a tier; a team is the side that ran away first or gave chase), the starting chain, a party leaving the chain (`getRechained`: its pursuers take over its link, shared by merging back and a party with nobody alive, `getChaseWithoutDead`), the stage each party stands at in the round (`getChaseStage`: deciding, then running, skirmish or routing), who is held (fighting, joining), far links frozen while enemies are at combat range, who declares and in what order, run speeds, who is caught, what may be declared and resolved, the tier between two parties (the farthest on the chain between them, `getChaseDistance`, read by `getDistanceBetween`, so reach, shot penalties, spells and senses see it; a shot crosses tiers by the tier its range names, `reachesTier`), how long a round takes (`state.elapsed`), the routing bonus, cover, skirmish AP, the hiding, scouting and crossing tests, following, putting back, merging back, joining a fight, and a party splitting (`getSplitChase`, called by splitOff)
│   ├── parked.ts       isParked, isOffGrid, getFollowSceneBar, isFollowOpen: who is parked (another party followed) or off the grid (running or parked: not placed, the view offers no placing), and when the scene may follow a party
│   ├── fight.ts        getReturnBar, getEndCombatBar, getJoinBar, isFromRoster, getHomecoming: why the scene cannot give its characters back (not until the combat is ended), end the combat or take one in now, and the party it gives each back to
│   ├── started.ts      isCombatStarted, isChargedIn: whether the first round is under way, which is what makes turns exist and AP and STA prices get paid
│   ├── roundChange.ts  the round change: its phases in order (`ROUND_PHASES`), where it stands (`getRoundPhase`: the morale tests, the limit stress actions and the chase read off the state inside `roundStep` 'morale'), what it bars of the turns, the AP still to come, who has to hold on or let go and why they cannot, and what keeps the table from moving it on
│   └── fighters.ts     active character, fight names, a party's living members and its name, who holds an item
│
└── projections/                     read-for-UI, no setters
    └── actionPanel.ts, boardView.ts, cards.ts, roundChange.ts, chase.ts, parked.ts (whom the scene may follow once a chase is over), roster.ts, outcomes.ts, episode.ts, labels.ts, turn.ts, morale.ts, heldTests.ts, senses.ts, prepare.ts, modifiers.ts (the modifier toggles every panel that declares an action shows)
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
- **A new way to declare a strike.** Hold `StrikeDeclaration` and open the strike with
  `pickStrikeDeclaration`; add it to `StrikeHolder` (`rules/strikeDeclaration.ts`). What it
  may be declared as is read off its context, so a rule that depends on how the strike came
  about asks the context (what it answers, the step that drew it), not the kind.
- **A new modifier.** A boolean in the kind's `modifiers` object (types.ts);
  `DECLARATION_MODIFIERS` (`rules/modifiers.ts`) will not compile until it has an entry.
  The price, the completeness check, the test, the blow, the answers offered and every
  panel read the table.
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
