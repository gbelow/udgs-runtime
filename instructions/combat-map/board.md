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
