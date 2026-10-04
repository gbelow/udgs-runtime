# Combat domain: the board and projections

Detail for `instructions/combat-map.md`. When this and the code disagree, the code wins.

## The board

- `geometry.ts` — hex arithmetic in axial coordinates, no rules: `DIRECTIONS` (also the
  rotation order), `distance`, `setDistance`, `line`, `disk`, `ring`, `rotate`, `walkOut`,
  plane conversion for drawing and cones. One cell is one metre.
- `rules/board.ts` — footprints and occupancy by size, distance between characters, reach
  and shot range, line of sight, high ground, flankers, melee threateners.
- `rules/ground.ts` — where a footprint may cross and where it may come to rest.
- `rules/hazard.ts` — fire and gas left on the ground. A blast paints
  a `HazardLayer` onto each cell it covers (`TerrainCell.layers`). The layer holds the fire
  its own burn deals in that zone, whether the gas suffocates, and the visibility it leaves.
  A layer from a sustained spell names its holder and the explosion that cast it; it is
  read as gone while they do not hold the spell (`isLayerLive`), and a new cast of the
  spell paints over it (`isSupersededBy`). What leaves the fight takes only the live layers
  (`getLiveBoard`). A footprint takes the worst of its cells (`getHazardAt`). Suffocation
  from gas is never stored: `rules/situational.ts` reads it off where the character
  stands, so no command has to settle it. `getFireTouched` reads, off
  the board an action landed, the worst fire the turn holder stands in or walked through (a
  jump touches only where it lands), and `reduceCharacter` raises their `scorch` to it. `endTurn` deals the scorch as burning damage, and
  `nextRound` burns the counter with the fire each character stands in added, as one
  instance. Every burn and radiant hit goes through the counter the same way
  (`getOutcome`).
- `rules/move.ts`, `rules/waypoint.ts`, `rules/trample.ts` — move pricing and legality,
  runs, Balance tests, reachable cells, where the mover stands along a path, where a move
  was cut short, tramples.
- **Cliffs and falls.** Ground a metre or more above or below the cell beside it is a cliff
  (`rules/cliff.ts`): a walk may not step over it, a jump goes up as far as its vertical reach
  clears and comes down as a fall, and a climb (the way over, always a test) is the only
  movement that crosses it on foot. A move's facts carry the fall it ended in (a jump that
  landed lower; a climb that missed, from the highest point it reached to the lower of where
  it began and where it was bound), and landing the move opens a `fall` root over it: the
  faller's own Balance test, whose degree `rules/fall.ts` turns into the damage and afflictions
  the landing delivers. Where the mover stands afterwards is read off the ground there, as for
  any move. A displacement that ends in a fall (a push, a drag) is not wired in yet.
- **Balance on difficult terrain.** A move across difficult cells is closed by a Balance die
  unless the mover's test stands for the turn (`getBalanceMemory`, read off the record: the
  latest of their moves this turn whose die was thrown as a balance test, cleared by a fall or the
  turn's end). A move without a die scores the remembered result against its own DL. The move
  records which test its die was (`test`). A miss leaves the mover prone, with no fall height.
- **Climbing.** The climber's test stands for the round: the first climb of a round throws the
  die (in the mode it declares, among `getClimbModes`: safe from Climber I, risky from Climber II
  and only during a movement surge), and the climbs after it score that result against their own
  DL (`getClimbMemory`, read off the record the way `getBalanceMemory` is, scoped by the `round`
  an action is stamped with). A climb starts at the climber's height (`getClimbStart`: 2 m × RM, more by the jump a
  Jumper II spends to begin it, `leap`): only what the cliffs rise above that is climbed and priced
  (`getClimbCells`); a climb is over cliffs alone (`canStepOver`), and the next cliff starts a climb of its own. One step over a cliff no higher than the start
  is trivial (`isTrivialClimb`): no test, no fall, the price of standing up (or of the jump), and it
  leaves the climber standing (`facts.finish`); a real climb leaves them prone at the top, unless
  Climber III and a critical, and a climb may begin prone. The fall of a failed climb is the height
  reached less the start. The DL is the board's painted DL of the ground gripped, 5 where
  unpainted, with no floor. A graze doubles each block's AP and not its STA; a climber who cannot
  pay for that gives up (`gaveUp`, stamped as the die is paid) and falls like a miss. An attack
  that interrupts a climber does not cancel the climb but has them make a new −3 test (one die per
  attack drawn, thrown with the climb in `redos`): the first that misses cuts the path where they
  were caught and they fall from the highest point reached. A climber is prone while the climb is
  under way (`getSituationalAfflictions`), unless Climber III and a critical. The test's `holds`
  term counts the free parts that take hold (`canClimbWith`: a hand unless the body's part says
  `climbs`), −3 for one and −8 for none.
- **Water and held tests.** A liquid cell has a surface (its elevation), a depth below it and a
  DL. A swimmer's `Placement.depth` is how far below the surface they are; it is read through
  the water they stand in, so it never exceeds the floor, and below the surface they are
  suffocating (`situational.ts`). A **held test** is a test made once a round whose score then
  stands against every DL the round puts to the character: `state.heldTests` holds the calls
  and the rolls (cleared and called again by `nextRound`), only the score is kept, and the
  degree is read off it against each DL (`getDegree`). A call is owed at the round's beginning
  and bars the turn, as morale does; a need that arises mid-round is met by the die of the
  action that has it (a swim move that enters water with no roll yet), which `applyPhase`
  makes the round's. What a roll does once, when made, is the effect registry in
  `commands/heldTest.ts`. A new kind of held test is a word in `HELD_TESTS` (`lists.ts`) and
  its entries in the two registries, which do not compile until they have them. Swim moves
  are priced per metre by the degree that metre's water gives the score, and a dive is swum
  like a metre of path.
- Board edits outside any action (`createBoard`, `importBoard`, `placeCharacter`,
  `turnCharacter`, `paintTerrain`) live in `commands/board.ts` and are refused while an
  action is open. `makeBoard` (`factories.ts`) ingests a VTT snapshot best-effort.

## Reading for the UI: projections

`projections/` shapes the fight for a screen and has no setters.

- `actionPanel.ts` `getActionPanel` — everything the action panel shows: the open action,
  its sub-step, options with reasons, reactors and their pickers, HOP and spell options,
  push outcome.
- `boardView.ts` `getBoardView` — cells, tokens, ghosts, floor items, and what a click on
  each cell would mean (`BoardMode`).
- `roster.ts` `getCombatRoster`, `getRole` — who each character is to the open action.
- `outcomes.ts` — `getOutcomes` (damage previews), `getActionNotes`, `getLastReport` (reads
  the end of `getHistory`).
- `labels.ts` — names for actions, options and HOP purchases.
- `perState.ts` — memoizes a projection per state object. Each big projection exports a
  `…Digest` (its JSON) so a hook re-renders only when the view actually changed, then reads
  the same cached view.

Hooks: `useCombatActions` (pipeline buttons, injects dice and ids), `useCombatCommands`,
`useCombatState`, `useBoard` — thin adapters over the commands and projections above.
