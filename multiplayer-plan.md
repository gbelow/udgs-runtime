# Multiplayer: commands as data (phase 0)

Work every multiplayer strategy needs (our relay first, then the GM's browser as host over WebRTC). Nothing here knows how messages travel or where saves go.

Direction: the GM's client is the authority. A screen sends a command (plain data plus who sent it); the host gates it, applies it with its own dice and ids, and publishes the new state. While nothing is connected the host is the local store, so the app keeps working through every step.

## What is already in place

- Hooks are already thin: each press maps a name to an updater (`useCombatActions`, `useCombatCommands`, `useChase`, `useBoard`, `useSceneDice`).
- Whom a press acts for is already a domain answer (`getPanelActor`, `readClick`), and `canControl` lives in `domain/profiles.ts`.
- Entropy and ids are injected (`Throw`, `newId`). A die answer is already a command of its own (`answerScene`), with the die as an argument.
- The board harness lists the commands the panel dispatches; the fuzzer checks that state round-trips through storage.

## Steps

### 1. A scene command registry (domain)

`domain/scene/commands/registry.ts`: one entry per press, `kind → (ctx) => (...args) => Updater`, where `ctx = { thrower, newId }` is what the host supplies and `args` are only plain data.

- `SceneCommand` is derived from the registry: `{ kind: K, args: Parameters<…> }`. A new entry types itself, and positional args mean no existing command is rewritten.
- The click is a command too: `{ kind: 'click', args: [click, brush, reposition] }`, read with `readClick`.
- A typed die (morale, held tests) stays an optional argument; the host's thrower takes no arguments from the wire.

### 2. Whom a command acts for (domain rule)

`actsFor(state, command) → characterId | 'gm' | 'table'`, beside `getPanelActor` in `rules/decider.ts`. Each `kind` declares one of:
- its actor or reactor (given in the args, or read with `getPanelActor` / `readClick`),
- the GM (paint, light, board, the reposition tool, breakage, table pressure),
- anyone at the table (next round, end combat, roll contest: the commands refuse it themselves).

This takes over the gates now scattered in the hooks (`forCharacter`, `asReactor`, `as(press)`, `asGm`).

### 3. Apply (domain)

`applySceneCommand(state, sender, command, ctx, owners) → state`. It refuses (returns the same state) when `canControl(sender, actsFor(…))` fails, and otherwise runs the registry entry and `holdForDice`. It is pure and uses no server or browser APIs, so it runs anywhere.

### 4. Every die is answered on its roller's screen

Ruled 2026-10-17: every player's die is answered on that player's own screen, including dice someone else's command called for them (one player can make another roll). Only one action is active at a time, so the calls waiting are always that action's.

- The host rolls at once only for rollers no player plays: bots, and the characters the GM plays (the GM's screen is the host).
- Every other call waits in state, and the roller's screen answers it with `answerScene`. Throwing on screen stops being an instant roll inside the command: the screen auto-answers the call when it arrives, the way `useAutoThrow` already does for the tray. The dice place only changes how a screen answers (tray, typed, at once), never who rolls.
- Whoever may control the roller may answer, so the GM can take a character over and answer for its player (`canControl` already lets the GM).
- `ctx.thrower` becomes `throwerFor(roller)`, built from the owners, not from the sender; `useThrower` goes away.

### 5. Separate what the viewer selects from what the table shares

Ruled 2026-10-17: the selected character is private to each screen. `activeCharacterId` sits in `SceneState` and the campaign state and is read in 17 domain files.
- Commands name their actor explicitly. Most already do (`declareAction(actorId…)`); the ones that read `activeCharacterId` inside a command (`click.ts`, `resetCombat.ts`) take it as an argument.
- Projections take the viewer's selection as a parameter.
- The selection moves to per-screen UI state.
- `inTurnCharacter` stays shared.

### 6. Dispatch in the hooks

A `useSceneDispatch()` hook returns `dispatch(command)`; local mode calls `applySceneCommand` into the combat store with this screen's sender. Convert one hook file at a time and delete the hook-side gates: `useCombatActions`, `useCombatCommands`, `useChase`, `useBoard`, `useSceneDice`, `useCombatState`, `useHandsLens` (`toFloor`), `useVttLink`.

### 7. Harness, fuzzer and bot on the same vocabulary

- The harness's `press` takes a `SceneCommand` and goes through `applySceneCommand`, so the fuzzer exercises the registry and the gate.
- A fuzz failure can then be logged as a command list and replayed.
- `stepBot` returns a command instead of a state; `playBot` applies it.

A test that every command survives JSON is admitted only once a transport exists (testing.md category 2: a real boundary); until then the types hold its form.

### 8. Edits to a character during play

`useActiveCharacterUpdate`'s closures during a fight (`updateInventory(id, updater, gm)`, the lens setters, about 139 `update(` call sites in 32 files) become commands:
- `setLens { registry, key, value }`. The lens registries are already keyed (`skillLenses`, `characteristicLenses`, `movementLenses`), so one command covers them.
- Named inventory commands for the hands and containers.

The editor (building a character) keeps its local closures.

### 9. Table commands, then the other parts

- `updateTable` (scene and campaign together: `removeFromFight`, `resetFight`) gets its own registry.
- Then campaign, exploration and downtime, one registry each, on the same pattern (`updateCampaign*`: 21 sites).

## Order

Steps 1–3 and 6 for the action panel first: the most-pressed path, and the harness already covers it. Step 5 next, before any second screen exists. Steps 4, 7, 8 and 9 follow.

## Open

- Hidden information in exploration and downtime: more rules apply there; decided when those parts get their registries.

## Hidden information in the scene

Ruled 2026-10-17: a viewer sees the state of only the characters they control. The grid is drawn from one of those characters' perspective, and the characters any of them can pick from are the ones that character detects. A per-viewer projection does this on the host; the GM sees everything.
