1. Unused things

What: rollTest and RollMode (safe/risky dice)
Where: dice.ts:5,31
Notes: Nothing calls them outside the file, and no test does either. The play.tex
safe/risky rule is written but never reachable.
────────────────────────────────────────
What: newId = () => \${Date.now()}`` default arguments
Where: commands/action.ts:131,229,258,494, commands/board.ts:86
Notes: Every caller in hooks/ passes its own newId, so these defaults never run.
They also put Date.now inside the pure domain, which goes against the "entropy
is injected" promise in dice.ts.
────────────────────────────────────────
What: CombatStateSchema as a way to load a saved fight
Where: types.ts:570-574
Notes: Only tests parse it. The store (useCombatStore.ts:31-38) writes out the
defaults by hand, so the "a saved fight can be rehydrated" comment describes a
path that doesn't exist.
────────────────────────────────────────
What: TerrainCell type, GrappleAfflictionSchema
Where: types.ts:74,169
Notes: Unused. grapple.ts:20 redefines GrappleAffliction locally instead of using
the schema.
────────────────────────────────────────
What: if (updatedCharacter.resources) guard, and the comment "+6 AP, cap at 6"
Where: nextRound.ts:47-58
Notes: resources is always present on a campaign character. The code actually
applies +8 capped at 8, which matches combat.tex "reset to 8 AP minus any
negative AP", so only the comment is stale. The literal 8 is also written
separately in domain/factories.ts:105.
────────────────────────────────────────
What: Stale comment: "every object in the fight is in somebody's hands — nothing
can be left on the ground yet"
Where: explosion.ts:48-50
Notes: There is a floor now. getChargedItem(state, itemId) still only searches
hands, so a charged item lying on the floor can't be set off. That may be a
real gap, not just an old comment.
Status: comment fixed (function is now findHeldItem). OPEN: should a charge on
the floor be detonatable?
────────────────────────────────────────
What: getBalanceTestTerms
Where: move.ts:282
Notes: It only passes through to getBalanceTerms.

2. Repeated patterns that should be unified

1. Finding a weapon row (7 copies). findWeaponRow exists in rules/action.ts:66, but the same "wielded by key, then attack by name" lookup is written out again in reduce.ts:120,179, board.ts:101,153 and explosion.ts:32,79. The copies probably exist because rules/action.ts sits above board.ts/explosion.ts in the import graph. Moving findWeaponRow/isRowUsable into a lower-level file (for example rules/weaponRow.ts or item/rules/hands) would remove all of them. Building every row a character holds ({ wielded, weapon: wielded.weapon, atk }) is also repeated in getAttackOptions, hasUnfocusedRow, defRows and getGrappleRows.
   DONE: findWeaponRow, isRowUsable, WeaponRow and a new getWeaponRows live in combat/rules/weaponRow.ts (a leaf: imports only item/rules/hands and character/rules/gear). All six inline lookups and the four row builders use it.
2. Two different functions both named getChargedItem. One is damage.ts:176 (c, action) → Item; the other is explosion.ts:51 (state, itemId) → {holder, item}. reduce.ts imports one and rules/action.ts imports the other. This one is a real trap.
   DONE: damage.ts's is getChargedWeapon; explosion.ts's is findHeldItem.
3. Affordability check (5 copies). canAfford (rules/action.ts:312), priceFor (commands/action.ts:399), canPay (actionPanel.ts:340), the HOP gate in damage.ts:280 and affordable in move.ts:515 all do the same check. It should be one rule.
   DONE: character/rules/cost.ts canAfford already existed; its parameter is now Pick<Cost, 'AP' | 'STA'> so ActionCost fits. All combat copies (plus canSaveGraze) use it.
4. payCost({ ...cost, exhaustion: 0, IL: 0, ET: 0 }) (8 copies). A payAPSTA(cost) helper, or making payCost accept a partial cost, would cover them.
5. Applying every delivery to a character. (facts[c.id] ?? []).reduce((acc, d) => deliver(d)(acc), c) appears 3 times in reduce.ts.
6. Placing a character on a cell at its ground height (5 copies). { ...from, cell, elevation: terrain[coordKey(cell)]?.elevation ?? 0 } appears in move.ts twice, grapple.ts twice and commands/board.ts.
7. Replacing a grapple pair or dropping holders (3 copies). reduceGrapples (reduce.ts:147) repeats replacePair (grapple.ts:149). The "drop released holders, then drop grapples nobody holds" logic appears in reduceGrapples, getDragSides and getHeldGrapples. Some grapple helpers take Grapple[] and others take state, with no obvious reason for which.
8. Grapple facts read off an action. getGrappleFacts in reduce.ts:128 and the inline copy in outcomes.ts:54 are the same.
9. Opportunity-attack bookkeeping.
   - getOpportunityAttacks (move.ts:317) and getDrawnOpportunityAttacks (opportunity.ts:10) are the same function apart from a filter and a sort.
   - The strike | grapple | drag check is written twice where an isOpportunityAction guard would do.
   - reaction.reactionTo ? getAction(state, reaction.reactionTo) : null appears about 6 times. It needs a getRootOf(reaction) helper.
10. "First step closer while within range" loop. It appears in moveTriggers and again in pushTriggers (reactions.ts), and the hook loop is a third variation of it.
11. Breadth-first cell search. getReachableCells (move.ts:505) and getCircleCells (grapple.ts:494) run the same search. The "crossable" check also duplicates the one inside isPathLegal.
12. Run-block heading walk. getRunPath and getRunHeading (move.ts:215,238) both walk the path in running blocks to find the heading.
13. Command boilerplate.
    - rollAction and payAction share the same price-every-reaction loop.
    - spendHOP/refundHOP and improveSpell/refundImprovement are the same bump/unbump on a counter record.
    - Spawned moves are built with ActionSchema.parse({kind:'move', id, actorId, budget, prepaid, spawnedBy}) four times.
    - type Updater is declared in 4 command files.
14. Building a damage delivery. getHoldDeliveries (grapple.ts:245) writes out a full Damage object and delivery by hand. It repeats delivering() and the base Damage from getAttackFacts in damage.ts.
15. Picking the test's terms per action kind. actionPanel.ts:302-303 chooses score and DL terms for each kind with a nested ternary, repeating what getRootTest already decides. A getRootTestTerms(state, root) → {skill, DL} used by both would keep the preview and the roll from drifting apart.
16. Schema fragments.
    - variant/location are repeated across strike, shoot, explosion and opportunityAttack (the same situation as WeaponRowRef).
    - z.number().int().min(0).max(5) for a direction appears 4 times, and aimExplosion re-checks the same bounds by hand.
    - '../lists' is imported twice in types.ts:3-4, and './move' twice in rules/action.ts:20,27.
17. Rule constants written inline in several places.
    - The opportunity -2 appears 3 times (action.ts:448, grapple.ts:237,438).
    - The passive/unresisted -5 appears twice.
    - The size-5 force threshold appears in both trample and drag.
    - Since these are cross-cutting rather than one skill's modifiers, they would sit better in tables.ts.
18. Two ways of building render digests. getActionPanelDigest uses JSON.stringify. getCombatRosterDigest builds its string by hand, so it has to be kept in step with the fields manually.

3. Big exceptions to the patterns and rules

1. rules/action.ts (958 lines) mixes rules with view code. It holds real rules (getDLTerms, getRootTest, isDeclarationComplete) alongside view output:
   - option lists with labels and reason strings (getAvailableActions, getSpellOptions, getImprovementOptions, getLocationOptions, AttackOption);
   - getCancellableLabel with its own ad-hoc kind→word table;
   - UI step state (ActionStep, getNextStep).

   CLAUDE.md says a file mixing a rule with its view should be split. Commands depend on findOption, so the availability decision is a rule, but the labels and reasons belong in projections/. HOP_LABELS in damage.ts:203 is the same mix on a smaller scale.
2. Logic lives in the store. useCombatStore.removeCharacter removes the placement, prunes grapples and settles them, and updateActiveCharacter settles grapples too. CLAUDE.md says stores hold no rules, so this should be a removeFromCombat command.
3. resetCombat leaves the old actions behind. It wipes characters, grapples and floor but keeps actions, activeCharacterId and inTurnCharacter, so the action log still refers to characters who are gone. This looks like a bug, not just untidiness.
   DONE: resetCombat also clears actions, activeCharacterId and inTurnCharacter.
4. Two parallel spell-casting pipelines. Combat casting goes through CastAction (improved, getSOPRemaining, getImprovementOptions). The sheet path still uses the older character/commands/spells.ts flow (castSpell, applyModification, pendingAction), shown through useSpellLens, and nextRound still clears pendingAction. The same SOP bookkeeping and option shaping exists twice.
5. Hand-kept lists that should come from the action catalog.
   - isTriggeringAction (opportunity.ts:3) repeats the TriggeringAction type by hand.
   - commitAction (commands/action.ts:117) has its own list of which kinds need a target. getNextStep and getTargetIds each decide that differently.
   - sameDraft compares fields by hand with casts.

   Flags such as targeted and triggering on ACTIONS would keep these in one place.
6. resolveAction is a 30-line chained ternary with an inline function (commands/action.ts:498-531), and it calls getNextStep three times. A per-kind "facts at resolve" switch, like getTriggers, would match the rest of the codebase.
7. Commands that don't go through amendAction. pickCell (move path) and turnMove in commands/board.ts edit state.actions directly, skipping the re-parse. The explosion branch of the same pickCell does go through amendAction.
8. Files outside the three-folder layout. reduce.ts is the character/board reducer and imports rules like a command would. actionCatalog.ts is a rules table. rules/activeCharacter.ts is a selector. commands/addCharacterToCombat.ts isn't a state updater at all: it's a character factory with an @/ import and ==. Only reduce.ts really matters here.
9. Comments attached to the wrong function. The long DL comment (rules/action.ts:409-419) sits above getCastTerms instead of getDLTerms. The grapple/evasive-jump comment (:527-533) sits above getCancellableLabel instead of defenseGate. The block-rounding comment (move.ts:41-45) sits above getMoveBlockCells instead of getMoveCost.

If you want to start somewhere, the cheapest wins with the most payoff are the getChargedItem rename, one affordability rule, moving findWeaponRow down a layer, and deciding what resetCombat should clear. Splitting the view code out of rules/action.ts is the biggest structural cleanup.