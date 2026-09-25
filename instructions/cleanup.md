# Combat domain cleanup

Checklist from the combat-domain audit. `[x]` done, `[ ]` open, `[-]` left as is (reason given).

## Unused

- [x] `newId` defaults of `` `${Date.now()}` `` on `withdrawSpawnedAction`, `rollAction`, `payAction`, `resolveAction`, `pickCell`: never used, and collide when several ids are made in one update — make `newId` required
- [x] `TerrainCell` type: unreferenced
- [x] `nextRound`: dead `if (updatedCharacter.resources)` guard and the to-do header comment
- [x] Exports used only inside their own file: drop `export` (functions only; types that appear in exported signatures and the per-kind schemas in `types.ts` stay exported)
- [-] `rollTest` / `RollMode`, `explodes: true` never passed: staged play.tex mechanics, kept inert on purpose

## Repeated patterns to unify

- [x] Idempotent affliction commands (`inflict`, moved out of deliver.ts, and `cure`), used by `fallProne`/`standUp` (reduce.ts), `breathe` (nextRound.ts), `settleGrapples`
- [x] `withPlacements(state, patch)` for "the state with someone standing elsewhere"
- [x] `isAttackAction` guard for `kind === 'strike' || kind === 'shoot'`
- [x] One per-character deliveries schema for explosion, cast and grapple facts; one flattening helper in outcomes.ts
- [x] `isAreaEffect` predicate; `isTargeted` shared with `SpellOption.targeted`
- [x] One `getDefendingReaction` for `getDefense` and `getDLTerms`; one shield-cover term
- [x] Braced/hook eligibility computed once for `isVariantOpen` and the HOP gate
- [x] `getHeldItem` instead of hand-rolled `held.find`; `hasExplosionPayload` agrees with `getExplosionPayload` on area charges
- [x] Guard boilerplate at the top of the rolled-action commands
- [x] One `getFightName(state, id)`; cast deliveries shaped once for the panel
- [x] `findOpenRoot(state, kind)` for the pending move / explosion / move underway; `parseCoordKey` in boardView; drop the `getBalanceTestTerms` pass-through; spell name straight from `SPELLS`

## Exceptions to the architecture

- [x] Rule tables out of `commands/action.ts` into `rules/`: moves reactions open (`rules/reactionMoves.ts`), escape on stun (`getStunEscapes`), a hit cast opening its area (`opensExplosion`), flank still in reach (`isFlankInReach`), strike landing (`getStrikeLanding`), payable cost (`getPayableCost`)
- [x] Reducer reads only the action: `jumpedTo` on a strike, `paint` on an explosion, `thrown` on a shot, all written at `settle`. The paint fixed a real bug: a smoke charge set off or thrown left no smoke, because the charge was consumed before the paint was read (regression test in `commands/action.test.ts`)
- [ ] `reduceFloor` still reads a disarmed item off its owner in the pre-action state; same shape of fix if wanted
- [x] `trampledBy` pays the stun through a character command instead of editing AP
- [x] `nextRound` / `startTurn` / `resetCombat` tidied (they stay plain `Updater`s, which is how the hooks use them)
