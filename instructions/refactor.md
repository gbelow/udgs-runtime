Unused things

- getOutcomePreviews (app/domain/combat/projections/outcomes.ts:18) is only called from outcomes.test.ts. The action panel builds its preview from getSettled + getOutcomes directly (actionPanel.ts:243,318). So the test checks "preview equals what lands" through a path the UI never takes. Point the test at getActionPanel(s).outcomes and delete the function.
- rollTest / RollMode (dice.ts) have no callers, so safe and risky tests aren't wired in. You've said inert structure drawn ahead of implementation stays, so I'm noting this, not flagging it.
- Orientation (geometry.ts:19) is a second definition of DirectionSchema (types.ts:48).
- DefenseKindSchema, DefenseKind and Visibility are re-exported from combat/types.ts but nothing imports them from there.
- Small cleanups:
  - isDeclarationComplete has two identical return true groups (rules/action.ts:142-153).
  - rules/action.ts:195-196 has a comment about going along with a push that describes no code.
  - getGrappleNotes also produces the notes for cancellations and pick-ups, so it's really getActionNotes.

Repeated patterns worth unifying

1. Finding the opportunity attack that opened an action is written out by hand in 4 places: damage.ts:109, opportunity.ts:71, commands/sequence.ts:85 and commands/action.ts:85. One getOpeningReaction(state, action) rule would cover them all.
2. "A resolved strike that interrupted the actor" is the same check in isCancelled (opportunity.ts:55), getPushStop (grapple.ts:579) and, close to it, getMoveOverride (move.ts:330).
3. Open-action guards. if (!open || open.status !== 'declared') return state appears 6 times, and the isAnswerable guard 4 times. getRolledOpen already exists in commands/log.ts; adding getDeclaredOpen and getAnswerableOpen next to it would remove the rest.
4. Option literals in options.ts:77-144. Seven hand-written options repeat reactionTo: null, chosen: false, and several compute their availability test twice (strikes.length > 0, spells.some(...)). getGrappleOptions already has the right helper, option(label, draft, cost, reason) with available = reason === null. Move it up and use it everywhere, including getPickUpOption.
5. Weapon-row checks are repeated. getAttackVariant, getAttackOptions and hasUnfocusedRow (attack.ts:57/175/196) each repeat isRowUsable + rowFits + needsFocus. The block/intercept branch of isDeclarationComplete reimplements defRows, and getShotReachOf (board.ts:163) reimplements the variant lookup.
6. Reach and high ground. Math.max(1, getReach(...)) is written three ways (getStrikeReach, getMeleeRange, getGrappleReach), and getStrikeReach repeats isHighGround's check inline.
7. Trigger building in reactions.ts:
   - "Every reaction kind that answers X" is filtered twice (lines 84-86 and 106-108). It belongs in actionCatalog as one function.
   - The approach-step detection (footprint distances, then firstStep) is duplicated between pushTriggers and moveTriggers.
8. Explosion folds. The worse fold over zones runs 3 times in explosion.ts, and getExplosionPayload is recomputed on almost every call (isAimed → isSpray → getExplosionAreas → paxplosionCenters).
9. Character facts living in combat:
   - getAfflictions(c).includes(x) appears 6 times; a hasAffliction belongs in character/rules/affl
   - isImmobile is in grapple.ts:631 but is a character fact.
   - getMovementSpeed (move.ts:31) is a switch that duplicates the registry already in characterd by movement kind).
10. 12 × as CampaignCharacter. The item commands are typed Character → Character and lose the campaign narrowing. Making them generic (<C extends Character>(c: C) => C

Places that break the project's own rules

- Screen text inside rules/. CLAUDE.md says rules answer "what does the book say" and that a file mixing a rule with its view gets split. But labels, reason strings and figh
  - options.ts (the biggest case: findOption only reads .available, so the labels could move out)
  - HOP_LABELS (damage.ts
  - getSpellOptions (cast.ts)
  - getChargeOptions (explosion.ts)
  - getDisarmOptions (grapple.ts)
  - the fight names used in getDragSides                                     The panel's "can commit from the commands.actionPanel.ts:239-240 prices the action with getDeclaredCost + canAfford. commitAction and payAllices a move by the path it will actually walk (getMoveFacts). For a run drawn past a turn the two can disagree, which breaks button shows" rule. Ifound this by reading, not by running it.                           sible rulebook diverts (move.ts:458-463)refuses any shared cell. Every other placement uses canRest, which allows sharing with someone at least two sizes different (creating.tex "Sizce Occupation"). Thang or a divergence, andit's your call.
- getDLTerms (attack.ts:281-284) lists the kinds without a DL by hand in an if chain. Its sibling getRootTestTerms is an exhaustive switch. A new root kind would silently fall into the defender branch.                       filed pure geometry:
  - The "Angles" section of rules/board.ts:229-251 (toPlane, centroid,ngleBetween, angular
  - rules/activeCharacter.ts also holds findHeldItem and getFightName,ile name no longer f
- Not everything in commands/ is a button. log.ts, reduce.ts and sequence.ts are internal helpers for the commands, not buttons. That's fine, but thesn't describe them.

Architectural suggestions
                                                                      port cycles. There a
   - action↔move, action↔opportunity, action↔grapple, action↔attack   attack↔grapple, damae↔trample
                                                                      e cause is that ruleonce. It holds thelow-level log queries everything needs (getOpenAction, getReactionstAction, getRootOf,  top-level module thatimports everyone (isDeclarationComplete, getTargetIds, getNextStep, costs). Moving the queries into a rules/log.ts that imports only types remocles. Moving grapplePartners, isInGrapple,holds, getGrappleGroup) into its own file, and isImmobile into character, removes most of the rest. This works today only because function dee hoisted. A top-lev HOP_TRANSFORMS orGRAZE_SAVE_COST) would crash with a "used before initialization" error.
2. Split the two biggest rule files:                                  grapple.ts (633 linedrag (lines 404-606, withits own types) is a separate mechanic and should become rules/drag.ts.
   - attack.ts holds the opportunity sequencing (getOpportunityState, getOpportunityStop, only caller issequence.ts. That belongs in opportunity.ts.
3. Adding an action kind means editing many scattered switches: settle, getTriggers, isDeclarationComplete, getDeclaredCost, getTargetIds,        tNextStep, getRootTecers, getDeliveries andoptions.                                                                  Cheap first step: a the catalog, the same wayTriggeringAction is. Root-only switches then drop the 13 reaction no-op cases (settle.ts:40-k.ts:327-345) and stayexhaustive.
   - Longer term: a record of handlers per kind, checked with satisfies { [K in ActionKind]: … }, sog a new kind needs.
4. Projections are computed twice per store write. Each *Digest is JSON.stringify(getX(state)), and the hook then calls getX again to render (useBoard.tsx:17-18, useCombatActions.tsx:38-39). getActionPanel is heavy: it runs getAvailableActions for every reactor. Caching each projection per
   state object (a WeakMaould halve the workwithout touching the hooks' gating.


   If I were to do only three things: the cycle split (1), the shared opportunity-reaction helper (the first item under repeated patterns), and fixing the panel-vs-command affordability mismatch. Tell me which ones you want and I'll do them.