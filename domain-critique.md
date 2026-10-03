# Domain layer critique — worklist

Written 2026-10-03 from a read of `app/domain/` (about 20k lines) and a close read of the
action pipeline (`combat/commands/{action,sequence,reduce,log}.ts`, `rules/settle.ts`).
It is a sample, not an audit: line counts and grep counts are approximate, and each step
says what to verify before acting on it.

What holds up and should be kept: the domain is pure (dice and ids are injected, no
`Math.random` or `Date.now`); there are almost no `any` casts and no TODOs; `ACTIONS` and
`REACTION_OPENERS` are typed so a new kind fails to compile until it is described; commands
refuse by returning the state unchanged; the documented ideas in `combat-map.md` are mostly
true of the code.

The steps are ordered by payoff and by dependency. Each one stands alone unless it says
otherwise. Tick them off as they land.

---

## Step 1 — No silent per-kind dispatch

**Problem.** Per-kind behaviour that is not an exhaustive switch: a chain that names a few
kinds and lets the rest fall through, so a new kind that needs the step compiles without it.

**Audit.** The kind checks fall into three groups; only the second is the problem.

1. *Exhaustive switches — already safe, leave them.* `isDeclarationComplete`,
   `getDeclaredCost`, `getPostStep`, `getTargetIds` (`rules/action.ts`); `getDLTerms`,
   `getRootTestTerms` (`rules/attack.ts`); `getSettled` (`rules/settle.ts`); `getAnswers`
   (`rules/options.ts`). A new kind fails to compile until each has a case — the same
   guarantee a catalog hook would give, while keeping each case beside its rules and
   citations.
2. *Silent chains — the problem.*
   - `commitAction` ternary (`commands/action.ts`): commit-time fields for move, strike,
     cast, fireAgain.
   - `rollAction` ternary (same file): percentile dice for cast, cut, strike/shoot. It also
     fixes the order dice are drawn, so a mistake shifts every later die and the seeded sim.
   - `getRootTest` `default:` (`rules/attack.ts`): any unlisted kind reads as
     `scale: 'degrees'`.
   - `needsDie` (`rules/action.ts`): move and spellTest special-cased over the `die` flag.
   - `getOwnCost` (`rules/action.ts`): overrides for flee, sweep link, fireAgain upkeep,
     move, push; move is priced both here and in `getDeclaredCost`.
   - `getNextStep`: explosion and drag special steps.
   - `reduce.ts` chains (`reducePart`, `reduceBinds`, `reduceFloor`, `reduceBoard`).
3. *Not dispatch — leave them.* `actionPanel.ts` mostly narrows the union to read a field
   (`open.kind === 'shoot' ? open.ammoId : ''`). The rest of `attack.ts` and the gates in
   `options.ts` are rules about particular kinds, not dispatch.

Also: one root's test is described in four places — the `die` flag, `needsDie`,
`getRootTestTerms`, `getRootTest` — and nothing ties them together. They already differ:
move has `die: false` and terms on difficult ground; explosion has DL terms and no test of
its own.

**Direction.** Every per-kind difference is either an exhaustive switch or an `ACTIONS`
flag. `ACTIONS` stays flat data: no hooks, and no write-side code under `rules/`.

1. `getRootTest`: explicit cases instead of `default:`.
2. `rollAction`: an exhaustive `getExtraRolls` in `commands/`. Draw order must not change —
   `pnpm sim` reports identical before and after.
3. `commitAction`: an exhaustive `withCommitFacts` in `commands/`.
4. One exhaustive switch over root kinds returning `{ skill, DL, scale, grazes } | null`;
   `getRootTestTerms`, `getDLTerms`, `getRootTest` and `needsDie` (apart from move) read it.
   Write in `combat-map.md` that `die` means "committed by a die", not "has a test".
5. Fold `getOwnCost`'s per-kind overrides (move, flee, fireAgain upkeep) into
   `getDeclaredCost` (needs `state`; check its callers). Sweep link and push depend on the
   state of the fight, not the kind, and stay.

The `reduce.ts` chains are left to Step 4: once the reducer only applies what the record
says, they shrink, and making them exhaustive first is done twice. `settle` belongs to
Step 4, follow-ups to Step 7.

**Done when.** Outside the `reduce.ts` chains, every per-kind difference is an exhaustive
switch or an `ACTIONS` flag, and the `pnpm sim` report is unchanged.

**Order:** 1 → 2 → 3 → 4 → 5.

**Done (2026-10-03).** All five landed with `pnpm sim` reports byte-identical. Two
departures from the plan:

- `needsDie` was not derived from the test switch. `die` and "has a test" differ for
  more kinds than move: slip and feint have no terms without a tether or a target, and
  a root kind with `die` and no test is refused by `rollAction`, not paid. Deriving one
  from the other would turn that refusal into a free payment. `needsDie`'s two cases
  (move, accepted spellTest) stay; the scale moved into `getRootTestTerms`, and
  `getRootTest` only sums.
- `getOwnCost` keeps flee, sweep link and fireAgain upkeep. These are fixed prices that
  bypass the recipe and the AP repurposing, not per-kind declared costs; folding them
  into `getDeclaredCost` would let a recipe or a repurpose change them. Move and push
  did move into `getDeclaredCost`, which is now private and takes `state`.

---

## Step 2 — Remove the rule-calling-a-command inversion

**Problem.** `rules/` is documented as importing nothing from `commands/`, but
`rules/options.ts:9` imports `actionSurge` from `character/commands/actionSurge` and calls
it at `options.ts:119` (`withReactionSurge`) to find out whether a reaction would be open
after surging. A rule is answered by running a write-side command speculatively.

Also `item/commands/hands.ts` imports `updateSTA` from `character/commands/bleed`.

**Direction.** Give `character/rules/surge.ts` a read-side answer to "what would this
character look like having surged": either a pure `afterSurge(kind)(c)` that is a rule
(and that `actionSurge` then calls), or make the option check read `canSurge` plus the AP
the surge would grant. Then add the missing lint rule: files under `rules/` may not import
from `commands/` (the existing config covers domain-vs-React and components-vs-domain only).

**Done when.** `pnpm lint` fails if a `rules/` file imports a `commands/` file, and passes.

**Checked.** A grep over `combat/{rules,projections}`, `item/{rules,projections}` and
`character/{rules,lenses}` finds exactly one import of a `commands/` file outside tests:
`options.ts:9`. So the fix is one site, and the lint rule can go in as `error` straight
away. `eslint.config.mjs` currently has no such rule (its two rules cover domain-vs-React
and components-vs-domain).

**Done (2026-10-03).** `getSurged(kind)` in `character/rules/surge.ts` is the surged
character, and `actionSurge` is `canSurge ? getSurged : unchanged`; the bleed arithmetic
it needs moved to `getBled` in `character/rules/wounds.ts` (`commands/bleed` re-exports
it). `options.ts` calls `getSurged`. The lint rule covers `rules/`, `lenses/` and
`projections/` against `commands/` and `bot/`, and skips `*.test.ts`, which build
scenarios with commands. `pnpm sim` reports byte-identical. `item/commands/hands.ts` →
`character/commands/bleed` is command-to-command and left to Step 3.

---

## Step 3 — Break the `character` ↔ `item` cycle

**Problem.** The two parts are one module with two folder names.

- `character/rules/afflictions` → `item/rules/containers` → `character/rules/misc`
- `item/rules/hands` → `character/rules/{helpers,body,actionCosts}`;
  `character/rules/damage` → `item/rules/hands`
- `item/commands/hands.ts` → `character/rules/{spells,production,surge,actionCosts}`
- `character/commands/deliver.ts` → `combat/dice` (type)

**Direction.** Pick one. Either extract the shared primitives (`getSize`, scaling helpers,
action-cost table, body-part lookup) into a layer both import and neither re-exports, or
accept that `item` is a sub-namespace of `character` and move it under it. Do not fix it by
adding indirection (callbacks, injected getters).

**Done when.** A dependency-cycle check (madge or an eslint `import/no-cycle` scoped to
`app/domain`) passes in CI.

**Done (2026-10-03), by a different route.** On checking, the two parts were not one module:
there was one 14-file import cycle (10 `character/rules`, 4 `item/rules`, no commands), and
no value depended on itself. Read by value, the stack is one-way: size and scale → item facts
(bulk, holding, burden, laming) → character state (afflictions, penalties, characteristics,
skills) → AP prices (`getActionCost` reads Prestidigitation). The cycle came from files
holding two of those layers. They were split, not merged or indirected:

- `character/rules/size.ts` (new leaf): `getSize` from `misc.ts`, the size multipliers and
  `scaleWeapon`/`scaleArmor` from `helpers.ts`.
- `item/rules/costs.ts` takes the priced item views: `getPutOnView` from `containers.ts`,
  `getBackMoveCost`/`getSlingView`/`getUnslingView` from `hands.ts` (and `hands.ts` no longer
  re-exports the costs).
- `character/rules/donning.ts` (new): don/doff prices and the wear views from `armor.ts`.
- `getGearPenalties` moved from `gear.ts` into `characteristics.ts`, its only reader;
  `gear.ts` is now the attack side alone.

`import/no-cycle` is an `error` for `app/domain/{character,item}/**`. `pnpm sim` reports
byte-identical. Not covered: `combat/rules` has its own 17-file cycle and `combat/commands`
a 4-file one (`action`, `floor`, `log`, `sequence`, Step 6's ground), so the rule is not yet
domain-wide.

---

## Step 4 — The reducer decides rules and recomputes from the character at resolve

**Problem.** `combat-map.md` says whatever an action needs is written onto the record at the
transition, "nothing about an action is computed twice", and "what is previewed is what
lands" (`getSettled`). `reducePart`'s resolve branch does not keep to that.

**Evidence** (`commands/reduce.ts`):

- Rule decisions inside the reducer: a sustained spell is taken hold of only if
  `roll.degree === 'hit'` and not `failed`; a charged weapon is discharged if the degree is
  not a miss (`getChargedWeapon`); `spell.type` picks the branch.
- Values computed at resolve off the character as they stand then, not read from the
  record: `getHOPPrice(p, acc)` for each HOP purchase, `getCastCharges(c, action)`,
  `getCastSize(c, …)`, `getEffortlessCost(landed, …)`.
- `getSettled` writes none of those, so the action panel's preview (it reads `getSettled`)
  cannot show them, and `outcomes.test.ts` (preview equals what the target takes) covers
  only the target side.

**Direction.** Have `getSettled` (or the roll) write the actor-side results onto the record
(`paid HOP`, `charges drawn`, `size`, `holdsSpell`), and let the reducer apply them without
deciding. Then the preview and the landing read one thing.

**Done when.** `reducePart` contains no `degree` comparison and no call to a `get*Price` /
`get*Charges` / `get*Size` rule.

---

## Step 5 — `applyPhase` ordering is implicit (checked: low priority, no bug found)

**What I first suspected.** That `applyPhase` (`commands/log.ts`) feeds the reducers
mismatched snapshots, so a rule read at resolve could mean something different from the
same rule read at preview.

**What I checked, and found.**

- Every reducer is handed the same `s`. Character reduction (`mapCharacters`) only spreads
  `characters`, so `s.board`, `s.floor` and `s.binds` are the same references as in `next`;
  `reduceBinds(s, …)(next.binds)` is therefore not a generation mismatch.
- `land` calls `applyPhase` on a state where the action is already `done` and in `history`.
  `isVoided` reads the log through `getLandedBefore` (`rules/interruption.ts`), which
  takes `history` up to the action's own position, or all of it if the action is not in
  `history` yet. Those two are the same set, because a landing action is last. So the
  preview (`getSettled`, action still at `post`) and the landing agree.
- `settleSevered(before, id)` takes before and after on purpose, and says so.

**What remains.** Correctness of voiding rests on two things nothing names:
`state.history` order (an interruption counts only if it landed earlier), and
`step === 'done'` inside `getInterruptionOf` and `getMoveOverride`. If a future change
reorders `history` or lands an action without `step: 'done'`, voiding silently changes.

**Direction.** Document both dependencies in `combat-map/landing.md`. Add a regression test
only if one breaks. Not worth restructuring the reducers' signatures.

**Not checked.** Cost: `getAction` is a linear `find`, `getDescendantIds` a scan per level,
and `state.actions` is never pruned during a fight, so long fights and sim runs are
quadratic in actions. I did not measure it; check `pnpm sim` timings before caring.

---

## Step 6 — The sequencing engine knows about turns, and recursion has no stated bound

**Problem.** `commands/sequence.ts` is "the engine" for actions, yet it also owns turn
handover: `beginTurn`, `handOverToFleers`, `takeQueuedTurn`, `forceSurge`, and imports
`closeTurn`, `getTurnHolder`, `canTakeQueuedTurn`. Turn state (`inTurnCharacter`,
`turnStartedAt`, `contenders`, `lastContest`, `fleeing`, `fleers`, `turnQueue`,
`forcedSurge`) is a hand-rolled state machine on `CombatState`, written by `sequence.ts`,
`commands/turn.ts`, `closeTurn.ts`, `stress.ts`, `morale.ts`, `nextRound.ts`.

`advance` ↔ `land` recurse mutually (`land` ends in `advance`, `advance` calls `land`;
`advance` also recurses on `isForgone`). Termination holds only because follow-ups are
finite, which is argued in comments and tested by scenarios, not enforced.

**Direction.**
1. Move turn handover out of `sequence.ts` into a `turn` command module and have `advance`
   end by calling one hook ("the stack is empty").
2. Model the turn as one discriminated value (e.g. `turn: { holder, kind: 'normal' |
   'flee' | 'stress', startedAt, contenders, … }`) so that "fleeing with nobody due" or
   "forcedSurge owed to someone not in the fight" cannot be represented. Today those are
   legal states.
3. Either iterate instead of recursing, or add a depth guard that throws in tests so a
   runaway shows up as a failure rather than a hung tab.

**Done when.** `sequence.ts` imports nothing from `turn`/`closeTurn`/`flee` rules except
through a single handover function.

---

## Step 7 — `generateFollowUps` encodes rulings in array order

**Problem.** The play order of follow-ups is the order of a spread list ("last pushed plays
first"). That is a table ruling carried by array position. The comment above
`getFollowUps` has already drifted from the list: the re-aimed spray (`reaimedSpray`) is in
the list and not in the comment.

**Direction.** Give each generator a named priority (a small ordered table next to
`REACTION_OPENERS`), sort by it once, and make the comment generated from or replaced by
that table. A new follow-up then declares where it goes, instead of finding the right slot
in a spread.

**Done when.** Reordering the spread in `generateFollowUps` changes nothing.

---

## Step 8 — Commands refuse silently

**Problem.** Every command returns the state unchanged when refused: `commitAction`
(five separate early returns), `rollAction` (`if (!test && ACTIONS[kind].die) return state`),
`payAll` (`if (!cost) return state`), `resolveAction`. The UI gets reasons for
declarations through `findOption`, but a refused commit, roll or pay has no reason, and
`payAll` refuses the whole action when any one reactor cannot pay without saying who. The
bot and the sim treat a no-op as "nothing happened", which also hides bugs where a command
should have worked.

**Direction.** Keep the "unchanged state" contract, and add the reason on the read side:
`getCommitBlockers(state)`, `getRollBlockers(state)` as rules the commands call, so the
refusal and the panel's explanation are one function (the same move you made for
declarations, idea 8 in `combat-map.md`).

**Done when.** Each early return in `commitAction`, `rollAction`, `payAction` and `payAll`
is a blocker the panel can show.

---

## Step 9 — The action log is both a record and a working set

**Problem.** `state.actions` holds finished facts and also drafts. Cancel, withdraw a
reaction and withdraw an opportunity attack **delete** records; withdrawing a spawned action
**keeps** it as `declined: true` so it is not offered again. `history` is derived inside
`setActions` ("on the stack, no longer live, not declined"). Three representations of where
the fight is (`step` on each action, `stack`, `history`) are kept in line by one function.

There is also no command log: from a state alone you cannot tell what was pressed or in
what order, and the number of dice thrown per kind (a percentile die added to a kind) shifts
every later die, so recorded seeds and sim reports change on any such edit.

**Direction.** Decide which of these you want and write it in `combat-map.md`:
(a) the log is append-only and undo is a separate concept; (b) the log is a working set and
only `history` is the record. Then make withdraw/cancel/decline follow one path. Whether to
add a command log is a product question (replays, bug reports); it is not required for the
rest.

---

## Step 10 — Types and ids

**Problem.**

- `types.ts` (about 1165 lines) and `combat/types.ts` (about 1000) are single files holding
  unrelated schemas (board, binds, hazards, deliveries, every action, morale, stress).
- `ActionBase` carries four provenance links on every action: `reactionTo`, `spawnedBy`,
  `followUpOf`, `recipe`.
- About 41 `Record<string, …>` outside tests. Character ids, item ids, cell keys and weapon
  keys are all `string`; `weaponKey` is "an item id or `natural:<name>`", parsed by
  convention.
- `state.board` is nullable and checked about 52 times in `combat/`; "boardless passes every
  gate" is a rule each of those has to remember.
- A few `as unknown as` in `reduce.ts`, `sequence.ts`, `reactions.ts`.
- `Placement.focus` is documented as "decides nothing yet".

**Direction, in this order.**
1. Brand `CharacterId`, `ItemId`, `CellKey`, and a `WeaponKey` that parses into
   `{ kind: 'item' | 'natural', … }` at the boundary. testing.md already prefers this to
   tests.
2. Split `combat/types.ts` by what it describes (board, binds, actions, turn). Pure moves,
   no behaviour change, so do it in one commit.
3. Decide whether the boardless case is a first-class board (a board with no geometry) or a
   second mode. If the former, the 52 checks collapse.
4. Remove or finish `focus`.

---

## Step 11 — Layout and leftovers

- `combat/rules/` has 55 flat files. Group the obvious families: bind-like (`grapple`,
  `partners`, `bind`, `tether`, `drag`, `cut`); turn-like (`turn`, `flee`, `feint`, `stress`,
  `morale`, `social`, `surge`); spell-like (`cast`, `fireAgain`, `explosion`).
- `getRES` / `getINS` still use the older formula (known; CLAUDE.md says reconcile on
  revival). Leave, but mark staged-vs-dead consistently, since the same file styles mix.
- `combat-map.md`'s "Where a change goes → A new action kind" lists the files you currently
  have to touch. After Step 1 it should shrink; update it then.

---

## Tests

The suite is 30 domain test files. The engine (`sequence.ts`, `reduce.ts`, `log.ts`) is
covered by one 1191-line scenario file, `commands/sequence.test.ts`, and there is no
`reduce`/`log`-level test. Under `instructions/testing.md` that is not a gap in itself.
Two places that file's categories do fit and nothing covers yet:

- **Invariant (author: combat-map idea 5 and 7).** For every kind in `ACTIONS`, a played-out
  action leaves `stack` empty and `history` containing it exactly once unless declined.
  Loop over the catalog so a new kind inherits it. Needs a scenario builder per kind, so do
  it after Step 1.
- **Regression.** Add one the first time Step 5's ordering breaks.

Do not add tests for Steps 7 and 8 beyond what the types and the new blockers already give.

---

## Suggested order

1 (onCommit/onRoll first) → 2 → 4 → 3 → 6 → 7 → 8 → 5 → 10 → 9 → 11.

Reasoning: 2 is small and adds a lint rule that keeps it fixed. 4 needs 1's `settle` hook
and removes the largest set of rule decisions from the write side. 3 and 6 are the big
structural moves; do them with 1 and 4 already in so there is less to move. 5 turned
out, on checking, to be documentation only; do it whenever. 9 is a decision before it is
work.
