# Combat domain: interruption and landing

Detail for `instructions/combat-map.md`. When this and the code disagree, the code wins.

## Interruption, giving up, voiding

- `getInterruptionOf(landed, victim)` (`rules/interruption.ts`) — what a landed strike,
  grapple maneuver or push did to someone: `none | interrupted | stunned`.
- `getInterruptions(state, action)` — what the action's descendants (through `reactionTo`
  and `spawnedBy`) landed on its actor *before its own effect*, ordered by `history`. A
  counterattack's tied strike is skipped (a tie breaks neither).
- `isBroken` — any such interruption, except for a move (cut short where caught,
  `getMoveOverride` in `rules/move.ts`) or a push (stopped by its comparison, or only by a
  stun of the pusher, `getPushStop` in `rules/drag.ts`).
- `rules/opportunity.ts` — `getGivenUpFor` / `isCancelled` (the actor of any action but
  movement gives it up by answering an opportunity attack it drew with anything but the SD),
  `getMidActionTerm` (the -2 on that answer, or on one made while standing up) and
  `isVoided` (cancelled or broken). A voided action lands nothing at its resolve
  (`applyPhase` skips it), settles with no facts, generates no follow-ups, and its price is
  still paid.

## Landing: settle, then reduce

- `getSettled(state, open)` (`rules/settle.ts`) — the exhaustive switch over `RootAction`
  that writes each kind's `facts` from the fight as it stands: attack deliveries,
  interruption and trample for a strike, the thrown item for a shot, grapple facts for a
  maneuver, path facts for a move, zone deliveries and terrain paint for a blast, cast
  deliveries per character.
- `applyPhase(state, actions, phase)` (`commands/log.ts`) — lands the board, reads the fire
  it left the turn holder in, runs every character through `reduceCharacter`, then the floor
  and binds reducers, then `settleBinds`.
  Phases: `roll` (the price leaves the actor), `save` (a cast's graze bought up), `resolve`
  (the action lands).
- `reduceCharacter` hands deliveries to the character domain's own effect processor
  (`character/commands/deliver.ts`); combat never computes damage on the target side.
- A grapple seizes the weapon each holder holds with (`Grapple.anchors`): the grab's row,
  or a free grapple row for grappling back. It grabs nobody else, and only its grapple
  rows are used, against nobody but the partner (`isSeizedUse`, read by `getTargetIds`,
  `isDeclarationComplete` and `getFreeAttackOptions`, the rows the panel offers).
- `settleBinds` (`commands/bind.ts`) lets go for any holder whose seized weapon is
  no longer a grapple row in hand,
  after anything that could take it from them — also called by `updateCharacter`,
  `dropToFloor` and `removeFromCombat`.
- What the fight puts on a character is never stored on them: `rules/situational.ts`
  reads suffocation off the gas they stand in and grappled/immobile off `state.binds`
  (`getSituationalAfflictions`, `hasFightAffliction`, `isSuffocating`, `isImmobile`). Combat
  rules ask these, not the character's own afflictions; the SD getter and the affliction
  board take them as a `situational` argument.
