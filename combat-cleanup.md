# Combat domain cleanup

Findings from the audit of `app/domain/combat`, in the order they are worked.

## Leftovers

- [x] `rules/attack.ts`: two comments stacked on `getDefendingReaction` — the shot-defense rationale moved onto `getShotDefense`, where it belongs
- [x] `commands/reduce.ts`: the "Throw" comment moved from `fallProne`/`standUp` onto `releaseThrown`
- [x] `projections/boardView.ts`: duplicated "Push and drag" comment line removed
- [x] Stale "lens" wording in combat comments now reads "rule"
- [x] `rules/damage.test.ts` moved to `character/rules/damage.test.ts`, beside the `getOutcome` it tests
- [x] `getStrikeReach` exported but used only by a test — no change: `board.test.ts` imports it
- [ ] `dice.ts` `rollTest` / `RollMode` (safe and risky tests) are not called anywhere — left in place as staged structure; wire them in or confirm they stay

## Repeated patterns

- [x] `makeAction(kind, fields)` in `combat/factories.ts` replaces `ActionSchema.parse({...}) as X` for every spawned action
- [x] `canAnswer(open, characterId)`: one rule for "the actor answers only their own explosion"
- [x] `findTrigger(state, root, reaction)`: one trigger match for declaring, pruning and the catch check
- [x] `isVoided(state, action)` replaces `isTriggeringAction(a) && isCancelled(state, a)`
- [x] `getLiveReactionsTo`; raw `reactionTo ===` filters go through `getReactionsTo`
- [x] Settle once, preview from it: `rules/settle.ts` `getSettled` is what the resolve writes; `getOutcomePreviews`, the panel's move facts, grapple and push notes and cast deliveries all read it. Casts now show damage outcomes before the resolve, as the report already did after it
- [x] `getStepPlacements` in `move.ts`: the mover either side of a step, shared by `getStepDelta` and `getBlowTrample`
- [x] Small helpers: `isManeuverWon`; `GRAZE_SAVE_COST`; `getMeleeRange(c, fits)` with `isGrappleRow` replaces the grapple I/II pair; every `fightName ?? ''` in combat goes through `getFightName`; `appendActions`
- [x] Action labels: `getActionName` (grab, maneuver, stand up, catalog label) and `getActionNoun` (catalog `noun`: shot, spell, push) in `actionCatalog.ts`, used by the panel, the report, the cancelled note and the "cancel the … to defend" reason. The report of an escape made to stand now reads "stand up"

## Exceptions to the patterns

- [x] Cast price: the reducer pays the AP/STA the roll wrote on the action, like every other kind (the user's ruling: in combat a spell costs only AP and STA; its other costs are exploration's)
- [ ] Question: `spells.ts` charges a sustained spell's upkeep at `end_round` with the spell's full `cost` (exhaustion, IL, ET included). Under the ruling above, should the combat round change charge only AP/STA?
- [x] UI concerns in `rules/`: `pickPathCell` moved into `commands/board.ts`, its only caller; `findHeldItem` moved beside the other fight lookups in `rules/activeCharacter.ts`
- [x] `saveGraze` goes through `getRolledOpen`
- [x] `dice.ts` outside `rules/` — no change: `components/utils.tsx` builds the real dice from it, and components may not import rules
- [x] `getCancellableLabel` and `HOP_LABELS` in `rules/` — no change: they label the option lists the commands gate on, which are rules by the taxonomy ("what may be declared")
- [x] Action construction in `rules/attack.ts` (`getOpportunityStrike`/`getOpportunityAction`) — no change: what an opportunity attack opens is a rule; the caller supplies the id, and the `''` in `isDeclarationComplete` is a query that never issues it
- [x] Drag's post-roll phase (`fought`) — no change: an explicit status would still be drag-only in every place that checks it, since drag is the one action answered twice

## Architecture

- [x] Exhaustive dispatch: `getSettled`, `getTriggers` and `getRootTestTerms` list every kind, so a new action kind fails to compile until it is placed. The reducers keep their catch-alls: most kinds rightly leave the board, the floor and the grapples alone
- [x] Split `commands/action.ts` into `action.ts` (the lifecycle buttons), `choices.ts` (the post-roll choices, added to the purity registry), `sequence.ts` (opportunity-attack sequencing and what a landing opens) and `log.ts` (shared bookkeeping)
- [ ] One opportunity-attack sequencer for moves, triggering actions and pushes — needs a design decision: it touches the table's rulings on where a mover stands, what stops them and when a catch fires
