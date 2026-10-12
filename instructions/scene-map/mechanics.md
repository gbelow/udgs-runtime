# Combat domain: mechanics

Detail for `instructions/scene-map.md`: the rules-bearing features layered on the pipeline. When this and the code disagree, the code wins.

- **Charges and throws** — what releases a charge (`Item.charge`) is read off its spell's
  catalog `triggers`: `impact`, `fire`, `detonate`. A `throw` lands the item on the floor,
  one of a stack, charge and all; if it goes off on impact (`goesOffOnImpact`: an `impact`
  charge, or a mundane explosive's row `payload`) the throw opens an `explosion` at the
  landing cell, committed and waiting on the reflexes, DL the thrower's Accuracy. A
  detonation sets off only `detonate` charges. Nothing reads the `fire` trigger yet; a blow on an object on the floor sets off its `impact` charge (see Attack against an object on the floor).
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
  `outcomes` entry for their own degree (`getSpellTestFacts` → `produceOutcome`). A morale
  spell (`rules/moraleSpell.ts`) opens the same `spellTest` without a link; its degree is a
  morale test's, settled onto the test as `morale` and landed by `reduceCharacter` and
  `compelByTest`.
  Everything a cast produces — its facts, the explosion it opens, a charge, its spell
  tests — is made at the cast's size (`getCastSizeOf`): the caster's own, or the
  environment's for shamanism, one up per amplification, capped at its item's size + 1. A
  cast short of the amplifications its item needs does nothing: `isFailedCast`, written
  onto the cast as `failed` when it lands so the reducer need not measure. Extend is
  declared with the cast, like Quicken, each extension +3 DL (`stepExtend`, `EXTEND`);
  a target must be within the extended range to be aimed at (`canAimCast`). It never
  reaches an explosion's area — the explosion is the effect — only the range a Detonate
  Explosive cast (catalog `detonate`) sets off a charge at (`getChargeOptions` with the
  detonation it opened). A held spell with a catalog `repeat` may be fired again
  (`fireAgain`, `rules/fireAgain.ts`), its item, size, bound target and percentile die
  written at the commit: a spray opens a `paintOnly` explosion from where the holder
  stands, which lays its ground and delivers nothing; a shot delivers the spell's target
  effects to the one target its arc is `boundTo`. An arc whose target leaves its range or
  the caster's sight breaks for good as any action lands (`settleArcs`, `commands/log.ts`).
  A held spray's layers record where the holder stood (`origin`) and go out once they
  are moved (`isLayerLive`). Charges a cast, a repeat or an upkeep draws from its item
  are the catalog's times the VM at the size cast at, a fraction by a percentile die
  (`countCharges`): a cast's is thrown at its roll and spent as it lands, at the size its
  amplifications brought it to. Letting go of the item lets go of the spell. Any interruption
  or stun ends every held spell: a won maneuver (`reduceCharacter`), a blow as it lands
  (`deliver.ts`), a crash (`trampledBy`).
- **Concentration** (`rules/hold.ts`, `commands/hold.ts`; combat.tex "Concentration", "Focus
  surge", "Interruption") — `requiresConcentration` is the one classification: a shot and the
  reload that is part of one, a spell unless quickened, First Aid (the ability's `concentration`
  flag). It drives the focus surge a cast or a shot asks for, the opportunity attacks it draws
  (`getKindTriggers`) and whether it may be held. A concentration action the actor cannot pay
  for, with the focus surge made and the STA at hand (`canHold`), commits as a hold
  (`getHoldCost`, `holding`): it is answered by the opportunity attacks it draws, all the actor's AP
  and its STA are paid at the payment (no die), and once those are fought `advance` parks it
  (`parkHeld`) instead of landing it: the record goes to `held` (off the stack) with `carried` set
  to what was paid, and its actor does nothing else (`closeWhileHolding`). A reaction they make gives it up (`getReactedWithin` notes the held
  action, `giveUpHeld` withdraws it once the reaction is paid), and `getRefundedAP` hands back
  `carried − 1` AP with it, as for an action given up to an opportunity attack; an interruption
  from outside breaks it (`breakHeld`, from `land`) and nothing is returned. Cauterization is a concentration action too. At the round
  change `startFinishing` prices what is left (`carried` comes off the price in `getCostTerms`):
  whoever has the AP finishes, ranked by cunning rolls (`rollCunning`, the turn contest's) when
  there are several; whoever has not holds on, the focus surge made again and every AP carried,
  or loses it without the surge. `releaseNextHeld` takes the next in order up at `react`, drawing
  no opportunity attacks again, once nothing is open (from `nextRound`, and from `advance` after each landing), unless
  `getFinishBar` finds what it needs gone, which fails it (`WithdrawalReason` `failed`) and
  spends none of the new round.
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
- **Cover** (`rules/board/board.ts`) — sight and fire are two lines: `seesAcross` is cut only by an
  opaque blocking cell, `firesAcross` by any blocking cell, glass included, and `getCoverAcross`
  finds the weakest wall on the most open line of fire, met at the sturdiest cell on that line.
  `getCover` answers for a character from a set of cells: total (a blocking cell nothing breaks,
  or a body shield), a wall that breaks (a blocking cell with a RES), or nothing. Shots at a
  character need them out of total cover (`hasLineOfFire`); throws, attacks at the floor and a
  blast's centre need a clear line to the cell (`isAimableCell` given `firesAcross` or
  `seesAcross`); casting, detection and light need sight. Total cover from a blast's origin
  (`getBlastOrigin`: its centre, or the attacker for a spray) keeps a character out of it. A wall
  that breaks lets shots and blasts through and absorbs every blow at its RES as it arrives
  (`Damage.wall`, in `getArriving`), before the degree or a block meets what is left (combat.tex
  "Cover"). A guard made with a body
  shield may take `cover`: when it lands, `setActions` writes `state.bodyCover` (the shield, and the shooter's cell it faces), kept across
  rounds until its owner lands any action or reaction but a careful move. `isBehindBodyShield` reads it, while
  the shield is still in hand, against anything on the shooter's side of them: they can be neither
  seen nor shot from there.
- **Sweeps** (`rules/sweep.ts`) — a sweeping variation (`isSweepVariant`, the normal or any
  heavy attack plus the sweep's AP) is a chain of strikes, one per target, each rolled and
  defended on its own. The first is declared with a `sweepDirection` — on a strike, or on the
  opportunity attack or counterattack that opens one; on a board its commit, or its opening,
  writes the `arc` it reaches after its target (`getSweepArc`: in reach, within the
  semicircle, or the full turn with Death Spin, not fallen, not behind another). When a
  strike of the sweep lands, `getFollowUps` opens the next on top of everything else, carrying
  `share`, what is left of the blow (`getNextShare`: the block, then the body at T2 damage,
  absorb it, `getPassedShare` in `character/rules/damage.ts`). Nothing opens once the share is
  0 — an intercept stopped it, or it was absorbed — or the arc is spent. On a fight without a
  board the next strike opens at `define`, for the attacker to aim at anyone not yet swept or
  pass up. A later strike (`isSweepLink`: its `sweepOf` names the first, its `swept` who the sweep met before it) is prepaid, keeps the sweep's row
  and variation, carries no charge, and draws no opportunity attack; the first draws none from
  any of the sweep's targets. None of the sweep's targets may protect another.
- **Breakage** (`rules/breakage.ts`, `character/rules/breakage.ts`) — a block or guard that meets a
  graze or a miss puts the object in the way at risk, and a strike's own weapon takes the impact
  back; what gets past the defense (`Outcome.arrived`) strikes the armor worn, unless the body is
  bare there (`isArmorBare`) (gear.tex "Equipment Breakage"; a piercing blow breaks only above 3x
  RES). A block absorbs at most the RES of the object it blocks with (`getBlockCap`). `rollAction`
  throws three percentiles for a blow that puts anything at risk (`needsBreakRolls`: `breakRolls`), `getSettled` writes the items it broke
  (`broke`), and `reduceCharacter` breaks them on their owners (`breakItem`). A broken item is not
  usable (`isRowUsable`); a guard declared before its shield broke still counts as having guarded
  (`isRowHeld`). `state.breakage` switches the optional rule off (`toggleBreakage`, refused while
  an action is open); a net cut reads it too.
- **Attack against equipment** (`rules/equipment.ts`) — a strike may be aimed at an item its target
  holds (`StrikeAction.object`, picked beside the body parts; −10 to hit, the table's ruling). It is
  scored and defended as a strike at the holder, delivers nothing to the body (`facts` is null), and
  on a hit or a critical tests the item's weakest part (`getWeakestPart`) with the blow at that
  degree, from `breakRolls.object`. A graze or a miss does nothing to it. A sweep ends at it and its
  hook knockdown is not offered; a block that meets it is tested as any block is.
- **Attack against an object on the floor** (`rules/floorAttack.ts`) — a plain melee strike or a shot may be aimed
  at an item in `state.floor`: `targetId` null and `object` the item's id (`isFloorAttack`), chosen
  by `setTarget` or a click on the item. Nobody answers it (`strikeTriggers` gives none) and it
  draws no penalty; the DL is the immobile-object DL read off the item's bulk (`getFloorAttackDL`:
  −bulk). It is offered only for an item a blow would do something to: one with a RES to test
  (`getObjectPart`: a weapon's weakest part, or an armor's RES, while `state.breakage` is on) or one
  whose charge goes off on impact. A hit or critical tests the RES (the break lands on the floor
  copy: `breakOne` in `reduceFloor`, keyed by the item's id in `breaks`) and opens the impact
  explosion at the item's cell (`struckExplosion`, `commands/sequence.ts`). Grabs, sweeps and
  opportunity attacks never aim at the floor. A shot reaches the floor within the row's carry and in
  sight (`isAimableCell`); a thrown row lands on the item's cell. A shot may equally be aimed at an
  item its target holds, scored as a strike at it is (`isObjectAttack`). A strike or a shot that
  carries burn (`getBurnOf`: the burn in the contact charge of the item it is made with) may also be
  aimed at a space (`cell`, set by `aimAtCell` from a board click: `getAim` field `'cell'`), offered
  only where unlit fuel lies within reach (`getCellTargets`); a space is scored at DL −5
  (`getGroundDL`). Burning damage a hit or graze carries lights the fuel only on the ground the
  attack was aimed at (`getGroundCell`, `lightBurned` in `reduceBoard`, `igniteCell` at the burn's
  heat) — never under a character it hits. A shot at the ground is answered by guards next to the
  space and closer to the shooter (`isGuardingCells`); one that answers it stops the shot
  (`isStoppedByGuard`): no break, no impact charge, no light.
- **Fuel and fire on the ground** (`rules/board/hazard.ts`, `rules/extinguish.ts`) — an item with `fuel`
  (`oil`, `alcohol`: a flask) thrown breaks where it lands instead of lying there: `reduceBoard`
  lays a `HazardLayer` with `fuel` and no fire on the cell (`coatCell`). A coat is harmless until
  something burns in its space; `igniteCell` then sets it burning at the hotter of the fuel's
  burn (`FUEL_BURN`) and the hottest fire there, whether the fire was there already or a blast
  paints it in the same landing. A fire layer lasts until put out: `extinguish` (4 AP, own space
  or next to it, aimed like a throw's landing: `getAim`) removes what burns in the chosen space
  (`extinguishCell`), a coat that was burning with it. Fire does not spread.
- **Prepared reactions** (`rules/prepared.ts`; combat.tex "Preparing a reaction") — a `prepare`
  root is declared in the preparer's turn: first the action it is for (`main`: a strike, shot,
  cast or move, with the row, spell or movement it is made with), then what it waits for
  (`trigger`: an event and who, `enters`, `sighted` or, for a defense, `attacked`); it always
  carries 2 AP of movement, which is never worse to have. It is paid at its commit and lands as any root, and its id is noted in the round's
  `prepared` registry as it lands: what is prepared is every `prepare` named there (`getPrepared`),
  so the round changing, which empties it, is all it takes for it to lapse. `getPreparedTriggers`, read by
  `getTriggers`, offers a `prepared` reaction to a preparer when a committed move comes into the
  trigger — the zone is the action's own reach plus the movement it carries
  (`getPreparedZone`) — at the step that did, counted as an opportunity attack's `at`, so the
  mover is stood on that cell while it is done (`getPreparedState`). It is open only to one who
  can make the action now (`getPreparedBar`). Its opener (`before`) opens the movement first,
  `preparedPart: 'move'`, capped at the 2 AP less what the action needs (`getPreparedMoveBudget`),
  then the action itself, `'main'`, each declared and committed by the preparer like a follow's
  move. `isPreparedRequired` says what may be passed up: the movement unless it is the only way
  the action has someone in reach, the action only when nobody is. A part passed up is
  read off its journal entry (`getPassedUp`). A reaction the preparer
  makes to anything the chain opened cancels what is left of it (`isPreparedCancelled`), and
  nothing a prepared action opens triggers another (`isFromPrepared`). A prepared strike is
  fought like an opportunity attack for what it may do to the mover (`getDrawnOpportunityAttacks`
  lists it), so an interruption stops the move. A preparation answers a move, or, for a defense, an
  attack; only strikes, shots, casts, moves and defenses are prepared.

  **A prepared defense** (`block`, `intercept`, `guard`; `PREPARED_DEFENSES`) is made for an ally,
  never for the preparer (combat.tex "Protect", "Guard"), and waits for the `attacked` event — its
  `who` is the ally, null for anyone but the preparer. `getDefenseTriggers` offers it as a plain
  `block` / `intercept` / `guard` trigger carrying `preparedId`, when the preparer can be on the
  line from where they stand or from any space the movement they carry reaches
  (`getDefensePlacements`: `getReachableCells` at the budget `getPreparedMoveBudget` leaves, each
  tested with the same geometry the plain defense uses — `isOnProtectLine`, `isInInterceptRange`,
  `isOnShotLine` for a guard, anywhere along the arrow's way: the table's ruling, where the plain guard stays adjacent as the book has it). Declared at the react step like any defense, with `preparedId` among its
  identity fields. The die is scored against the defense as it stands, so the movement is walked
  **before it**: `rollAction` first calls `repositionDefenders` (`commands/sequence.ts`), which
  opens the next preparer's move (`preparedPart: 'move'`, spawned by the defense, a root of its own
  that draws opportunity attacks like any move) and leaves the die unthrown until every one has been
  walked or passed up; then any defense left off the line, or cancelled by a reaction its preparer
  made to what the movement drew (`isPreparedCancelled`), is withdrawn as `noLongerTriggered`
  (`getLapsedDefenses`). `isPreparedRequired` lets the movement be passed up only by one already on
  the line; a reposition is complete only when it ends where the defense can be made
  (`isRepositionPlaced`). `getStrikeDefense` / `getShotDefense` count a prepared defense only while
  it is placed and not cancelled. Nothing the movement opens triggers another prepared action
  (`isFromPrepared` reads a prepared defense as an ancestor).
