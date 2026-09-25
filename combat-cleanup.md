# Combat domain cleanup

Findings from the audit of `app/domain/combat`, in the order they are worked.

## Leftovers

- [x] `rules/attack.ts`: two comments stacked on `getDefendingReaction` — the shot-defense rationale moved onto `getShotDefense`, where it belongs
- [x] `commands/reduce.ts`: the "Throw" comment moved from `fallProne`/`standUp` onto `releaseThrown`
- [x] `projections/boardView.ts`: duplicated "Push and drag" comment line removed
- [x] Stale "lens" wording in combat comments (`geometry.ts`, `types.ts`, `rules/board.ts`, `rules/explosion.ts`, `rules/damage.ts`, `rules/actionCatalog.ts`) now reads "rule"
- [x] `rules/damage.test.ts` moved to `character/rules/damage.test.ts`, beside the `getOutcome` it tests
- [ ] ~~`getStrikeReach` exported but used only by a test~~ — kept exported: `board.test.ts` imports it
- [ ] `dice.ts` `rollTest` / `RollMode` (safe and risky tests) are not called anywhere — left in place as staged structure; wire them in or confirm they stay

## Repeated patterns

- [x] `makeAction(kind, fields)` in `combat/factories.ts` replaces `ActionSchema.parse({...}) as X` for spawned moves, stun escapes, cast explosions and opportunity strikes, maneuvers and pushes
- [x] `canAnswer(open, characterId)` in `rules/action.ts`: the one rule for "the actor answers only their own explosion", used by `declareReaction`, `getAvailableActions` and the panel's reactors
- [x] `findTrigger(state, root, reaction)` in `rules/reactions.ts`: one trigger match for `declareReaction` (its `draft as { at? }` cast is gone), `pruneReactions` and the catch check in `isDeclarationComplete`
- [x] `isVoided(state, action)` in `rules/opportunity.ts` replaces `isTriggeringAction(a) && isCancelled(state, a)` in `getNextStep`, `getOutcomePreviews` and `getGrappleNotes` (`settle` keeps the narrowing it needs)
- [x] `getLiveReactionsTo` in `rules/action.ts` for reactions still declared; raw `reactionTo ===` filters in `move.ts`, `trample.ts` and `opportunity.ts` go through `getReactionsTo`
- [ ] Settle once, preview from it: move `settle` into `rules/` and have `outcomes.ts` and `actionPanel.ts` read the settled action instead of recomputing facts per kind
- [ ] The mover's placement before and after step `at`: shared by `getStepDelta` (`move.ts`) and `getBlowTrample` (`trample.ts`)
- [ ] Small helpers: a maneuver "landed" (hit or critical) in `grapple.ts` and `actionPanel.ts`; the graze-save price in `reduce.ts`, `cast.ts` and `actionPanel.ts`; the grapple I/II check in `reactions.ts` against `isGrappleRow`; `fightName ?? ''` against `getFightName`; appending to `state.actions`
- [ ] Action labels decided in four places: the catalog, `getCancellableLabel`, the panel label, `getActionLabel`

## Exceptions to the patterns

- [ ] Drag's post-roll phase (`fought`) special-cased in `isAnswerable`, `getNextStep`, `pruneReactions`, `payAction` and `grappleTriggers` — consider an explicit status
- [ ] A cast priced as AP/STA at the roll check but paid as the spell's full cost in the reducer — report to the user if a spell's cost can hold more than AP and STA
- [ ] Action construction in `rules/attack.ts` (`getOpportunityStrike`/`getOpportunityAction`), queried with `id: ''` by `isDeclarationComplete`
- [ ] UI concerns in `rules/`: `pickPathCell`, `getCancellableLabel`, `HOP_LABELS`; the fight-wide item lookup `findHeldItem` lives in `explosion.ts`
- [ ] `saveGraze` checks the rolled cast by hand instead of through `getRolledOpen`
- [ ] `dice.ts` holds play.tex rules outside `rules/`

## Architecture

- [ ] Exhaustive per-kind dispatch: drop the `default:` branches (or move to a per-kind behaviour registry) so a new action kind fails to compile
- [ ] One opportunity-attack sequencer for moves, triggering actions and pushes
- [ ] Split `commands/action.ts`: post-roll choices and opportunity-attack sequencing into their own files
