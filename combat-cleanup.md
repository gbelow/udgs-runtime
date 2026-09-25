# Combat domain cleanup

Findings from the audit of `app/domain/combat`, in the order they are worked.

## Leftovers

- [x] `rules/attack.ts`: two comments stacked on `getDefendingReaction` — the shot-defense rationale moved onto `getShotDefense`, where it belongs
- [x] `commands/reduce.ts`: the "Throw" comment moved from `fallProne`/`standUp` onto `releaseThrown`
- [x] `projections/boardView.ts`: duplicated "Push and drag" comment line removed
- [x] Stale "lens" wording in combat comments now reads "rule"
- [x] `rules/damage.test.ts` moved to `character/rules/damage.test.ts`, beside the `getOutcome` it tests
- [x] `getStrikeReach` exported but used only by a test — no change: `board.test.ts` imports it
- [x] `dice.ts` `rollTest` / `RollMode` (safe and risky tests) are not called anywhere — kept: staged structure, the user confirmed it stays

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
- [x] `spells.ts`: a sustained spell's upkeep at the round change charges only the AP/STA of its casting cost
- [x] UI concerns in `rules/`: `pickPathCell` moved into `commands/board.ts`, its only caller; `findHeldItem` moved beside the other fight lookups in `rules/activeCharacter.ts`
- [x] `saveGraze` goes through `getRolledOpen`
- [x] `dice.ts` outside `rules/` — no change: `components/utils.tsx` builds the real dice from it, and components may not import rules
- [x] `getCancellableLabel` and `HOP_LABELS` in `rules/` — no change: they label the option lists the commands gate on, which are rules by the taxonomy ("what may be declared")
- [x] Action construction in `rules/attack.ts` (`getOpportunityStrike`/`getOpportunityAction`) — no change: what an opportunity attack opens is a rule; the caller supplies the id, and the `''` in `isDeclarationComplete` is a query that never issues it
- [x] Drag's post-roll phase (`fought`) — no change: an explicit status would still be drag-only in every place that checks it, since drag is the one action answered twice

## Architecture

- [x] Exhaustive dispatch: `getSettled`, `getTriggers` and `getRootTestTerms` list every kind, so a new action kind fails to compile until it is placed. The reducers keep their catch-alls: most kinds rightly leave the board, the floor and the grapples alone
- [x] Split `commands/action.ts` into `action.ts` (the lifecycle buttons), `choices.ts` (the post-roll choices, added to the purity registry), `sequence.ts` (opportunity-attack sequencing and what a landing opens) and `log.ts` (shared bookkeeping)
- [x] One opportunity-attack sequencer: `advanceOpportunities` in `commands/sequence.ts` replaces `advanceMove` and `advanceTriggering`. `getDrawnOpportunityAttacks` gives the fight order (path order for a move or a push, declaration order otherwise); `getOpportunityStop`, `isOpportunityReached` and `getOpportunityState` in `rules/attack.ts` say when the run ends, which attacks are never reached, and where everyone stands while each is fought. The user's rulings it follows:
  - every declared attack on a cast, shot or other triggering action is still fought after one cancels it
  - a push's third-party attacks are fought like a move's: in path order, with the group stood one step short of each stretch (the push records where it set out from, `from`)
  - only the pusher's interruption stops a push, and it is cut short where it got to rather than undone; later stretches are never reached
- [x] Cancelling to defend repurposes AP: the given-up action records the attack it was given up for (`cancelledFor`), and its AP pays towards the first defense against that attack (`getRepurposedAP`, `lessRepurposed`, `getOwnCost`); STA is paid in full and unused AP is lost. Options and the panel show the reduced price
- [x] Found while testing the push: its Force comparison was read live at the resolve, so a blow taken while its attacks were fought changed how far it went. The comparison is now written when the push is paid (`compared`, `getDragComparison`), as a die is written at the roll
- [x] The board's ghosts of where a push lands follow the path as cut short
