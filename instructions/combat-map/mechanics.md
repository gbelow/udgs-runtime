# Combat domain: mechanics

Detail for `instructions/combat-map.md`: the rules-bearing features layered on the pipeline. When this and the code disagree, the code wins.

- **Charges and throws** — what releases a charge (`Item.charge`) is read off its spell's
  catalog `triggers`: `impact`, `fire`, `detonate`. A `throw` lands the item on the floor,
  one of a stack, charge and all; if it goes off on impact (`goesOffOnImpact`: an `impact`
  charge, or a mundane explosive's row `payload`) the throw opens an `explosion` at the
  landing cell, committed and waiting on the reflexes, DL the thrower's Accuracy. A
  detonation sets off only `detonate` charges. Nothing reads the `fire` trigger yet.
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
  `outcomes` entry for their own degree (`getSpellTestFacts` → `produceOutcome`).
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
  pass up. A later strike (`isSweepLink`: its `sweepOf` names the first) is prepaid, keeps the sweep's row
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
