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

### 4. The thrower is built from the sender, not the pressing screen

Today `useThrower` rolls a call at once when this screen plays its roller and throws on screen. On a host this becomes `throwerFor(sender, dicePlace)`:
- a call whose roller the sender plays, from a sender who throws on screen, is rolled by the host;
- every other call waits, and its roller's screen answers it with `answerScene`.

Consequence: a player who throws on screen must auto-answer calls made by someone else's command, the way `useAutoThrow` already does for the tray.

### 5. Separate what the viewer selects from what the table shares

`activeCharacterId` sits in `SceneState` and the campaign state and is read in 17 domain files. In multiplayer every screen selects its own character.
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

- Should the host roll for players who throw on screen, or should every player's die always be answered from their own screen?
- Hidden information: a per-viewer view projection is needed for both strategies, but can start as the whole state; when does it start filtering?
