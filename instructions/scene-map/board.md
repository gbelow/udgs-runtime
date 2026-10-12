# Combat domain: the board and projections

Detail for `instructions/scene-map.md`. When this and the code disagree, the code wins.

## The board

- `rules/board/geometry.ts` — hex arithmetic in axial coordinates, no rules: `DIRECTIONS` (also the
  rotation order), `distance`, `setDistance`, `line`, `disk`, `ring`, `rotate`, `walkOut`,
  plane conversion for drawing and cones. One cell is one metre.
- `rules/board/board.ts` — footprints and occupancy by size, distance between characters, reach
  and shot range, line of sight and line of fire, cover (see `mechanics.md` "Cover"), high
  ground, flankers, melee threateners.
- `rules/board/ground.ts` — where a footprint may cross and where it may come to rest.
- `rules/board/hazard.ts` — fire and gas left on the ground. A blast paints
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
- `rules/move.ts`, `rules/board/waypoint.ts`, `rules/trample.ts` — move pricing and legality,
  runs, Balance tests, reachable cells, where the mover stands along a path, where a move
  was cut short, tramples.
- **Cliffs and falls.** Ground a metre or more above or below the cell beside it is a cliff
  (`rules/board/cliff.ts`): a walk may not step over it, a jump goes up as far as its vertical reach
  clears and comes down as a fall, and a climb (the way over, always a test) is the only
  movement that crosses it on foot. A move's facts carry the fall it ended in (a jump that
  landed lower; a climb that missed, from the highest point it reached to the lower of where
  it began and where it was bound), and landing the move opens a `fall` root over it: the
  faller's own Balance test, whose degree `rules/fall.ts` turns into the damage and afflictions
  the landing delivers. Where the mover stands afterwards is read off the ground there, as for
  any move. A displacement that ends in a fall (a push, a drag) is not wired in yet.
- **Balance on difficult terrain.** A move across difficult cells is closed by a Balance die
  unless the mover's test stands for the round (a held test, below: the first move's die is
  held, and a fall drops it, `dropFallenBalance`). The one score is held against the DL of every difficult cell on the path
  (`getDifficultSteps`), and the mover falls at the first the way they move is not safe on
  (`getFallStep`); the die's own DL is the first cell's. The move records which test its die was
  (`test`). A miss leaves the mover prone, with no fall height.
- **Climbing.** A climb is on one face: the step over a cliff from the cell the climber is in to
  the next (`getClimbPlan`), with the DL painted on the higher cell (`climbDL`; a face with none
  has nothing to hold, so only a trivial climb crosses it, `isClimbable`). The climber's test
  stands for the round: the first climb of a round throws the die (in the mode it declares, among
  `getClimbModes`), which is held, and the climbs after it score that result against their own
  DL, with the `holds` term swapped for the one the climber has now (`withHolds`). A climb starts at the
  climber's height (`getClimbStart`: 2 m × RM, more by the jump a Jumper II spends, `leap`), and
  only the first move up a face takes that: what is left is climbed in moves of `metres` each, at
  a block's price per metre. One step over a face no higher than the start is trivial: no test, no
  fall, the price of standing up (or of the jump), and the climber is left standing. A move that
  stops short leaves the climber hanging (`Placement.climb`, `elevation` their feet): prone, with
  no high ground, able to climb on or let go (a declared `fall` from where they hang, DL by
  height). A graze costs 5 AP a metre and a climber who cannot pay gives up (`gaveUp`) and falls
  like a miss, from the height the declared metres reached; a critical costs no STA, and 1 AP a
  metre when risky. An attack that interrupts a climber has them make a new −3 test (one die per
  attack drawn, thrown with the climb in `redos`); a miss cancels the move and they fall from the
  height they hung at. Reaching the top leaves them prone, unless Climber III and a critical. The
  test's `holds` term counts the free parts that take hold (`canClimbWith`: a hand unless the
  body's part says `climbs`), −3 for one and −8 for none.
- **Water and held tests.** A liquid cell has a surface (its elevation), a depth below it and a
  DL. A swimmer's `Placement.depth` is how far below the surface they are; it is read through
  the water they stand in, so it never exceeds the floor, and below the surface they are
  suffocating (`situational.ts`). A **held test** is a test made once a round whose score then
  stands against every DL the round puts to the character: `state.heldTests` holds the calls
  and the rolls (cleared and called again by `nextRound`), only the score and its skill terms
  are kept, and the degree is read off it against each DL (`getDegree`). Held tests are swim,
  climb and balance. Only swim is called (`CALLED_TESTS`): a call is owed at the round's
  beginning and bars the turn, as morale does. A need that arises mid-round is met by the die
  of the action that has it (the swim test a move into water opens, a climb, a walk across
  difficult ground), which `applyPhase` makes the round's (`holdThrown`). A move carries the
  held tests its mover had made when it left its declaration (`held`, written by
  `setActions`), and from then on reads those (`getMoveHeld`), never the round's, so a landed
  move still reads as it was resolved. What a roll does once, when made, is the effect
  registry in `commands/heldTest.ts`. A new kind of held test is a word in `HELD_TESTS`
  (`lists.ts`) and its effect, which does not compile until it has one; a called kind is also
  a word in `CALLED_TESTS` and its entry in `HELD_DEFS`. Rules ask the registry what holds for
  the round; they do not scan the log for it. Swim moves
  are priced per metre by the degree that metre's water gives the score, and a dive is swum
  like a metre of path.
- Board edits outside any action (`createBoard`, `importBoard`, `placeCharacter`,
  `turnCharacter`, `paintTerrain`) live in `commands/board.ts` and are refused while an
  action is open. `makeBoard` (`factories.ts`) ingests a VTT snapshot best-effort.
- What a click on the board means is `resolveClick` (`commands/click.ts`), read off the state
  at the click through `getBoardMode` and `getFloorPicker` (`rules/board/boardMode.ts`); the hook
  only dispatches it.

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
- `domain/perState.ts` (shared with every part) — memoizes a projection per state object. Each big projection exports a
  `…Digest` (its JSON) so a hook re-renders only when the view actually changed, then reads
  the same cached view.

Hooks: `useCombatActions` (pipeline buttons, injects dice and ids), `useCombatCommands`,
`useCombatState`, `useBoard` — thin adapters over the commands and projections above.
