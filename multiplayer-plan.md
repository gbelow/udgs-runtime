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

Done: the selection is the `Selected` type beside the scene and campaign state, kept in each screen's store and never in a schema, so the table's shared state (`app/net/protocol.ts`) leaves it out and a guest landing the host's state leaves their own alone. Commands take their actor as an argument; only projections and hooks read the selection.

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

Done: `character/commands/registry.ts` holds the sheet's edits (one set command per lens registry, typed per family, rather than one `setLens`) and the gear moves apart. A fight carries them as the scene's `edit` and `editGear`, the roster as the campaign's `edit`; the editor's tabs apply the same commands locally.

### 9. Table commands, then the other parts

- `updateTable` (scene and campaign together: `removeFromFight`, `resetFight`) gets its own registry.
- Then campaign, exploration and downtime, one registry each, on the same pattern (`updateCampaign*`: 21 sites).

Done: `domain/registry.ts` is the pattern every registry is built with (the scene's included), and `useSceneDispatch.tsx` holds one dispatch hook per part. The map editor's changes are data too (`campaign/commands/mapRegistry.ts`), carried into a campaign's map by the campaign's `editMap`. A note in the journal acts for its writer (a new `{ author }` actor), as the journal view already ruled. Ruled 2026-10-17: the round flow (contest, next round, continue, end), table pressure, breakage, taking a character out of a fight, resetting it, loading one from a catalog, and a campaign's maps are the GM's; in a party, in a fight or out of one, a player moves only their own character (making, renaming and merging parties is the GM's). Left outside play: who plays which character (`setOwner`) and the campaign's members, which belong to the saved file rather than the state.

## Order

Steps 1–3 and 6 for the action panel first: the most-pressed path, and the harness already covers it. Step 5 next, before any second screen exists. Steps 4, 7, 8 and 9 follow.

## The relay (phase 1)

Built: `relay/` is our own `ws` server (`pnpm relay`, its own `package.json` to deploy alone), one room per campaign id, one host and any number of guests; it wraps a guest's message with who sent it and reads nothing. `app/net/` is the client: the host sends what changed since the last change sent, found by reference (`diff.ts`), and the whole state only to a guest who joins or missed a change; a guest's press goes to the host, which judges it as the guest's profile and plays it with its own dice and ids. Measured over the fuzzer's crowd sessions: a median change of about 2 KB against a fight of about 115 KB. Left for later: what each viewer may see, reconnecting by itself, loading a campaign's journal and maps in chunks on the server.

## Open

- Hidden information in exploration and downtime: more rules apply there; decided when those parts get their registries.
- Ids an item command makes for itself (`duplicateItem` splitting a stack) are random rather than the table's, so a replayed session can differ there.

## Hidden information

Ruled 2026-10-17: a viewer sees the state of only the characters they control. The grid is drawn from one of those characters' perspective, and the characters any of them can pick from are the ones that character detects. A per-viewer projection does this on the host; the GM sees everything.

Ruled 2026-10-18, how the views are made:

- The host builds a view for each guest and sends them only that, diffed against the last view it sent them. The GM, and the host's own screen, are sent the whole state. A guest's `bar` runs on their view and the host judges again.
- Seen in the scene: the characters the viewer controls, those any of them detects (`notices`), and those who share an exchange with them. Whoever is not seen is nowhere in the view, not by id and not by name.
- Each action is marked with the characters it involves (`participants`), written by `setActions` as the facts happen. An exchange (a root action and what it opened) involves the union of its actions' participants. An entry is in a viewer's log when they control one of them or see all of them; where many take part, such as a blast or a crowd, it is in the log when they are involved or see its actor, and the participants they do not see are left out of it.
- The open action and the turn holder are shared, so the panel always shows something is happening; an unseen actor's open action is shown without its actor.
- Exploration and downtime: a viewer sees only the parties of the characters they control. The campaign's journal shows them what was written to those parties and to the campaign as a whole, and not the notes kept from the players.
- Every field of the scene and campaign states is held by a registry typed on the state's keys, each saying how it is hidden, so a field added later does not compile until it says.
- Tested by the fuzzer: after every press, a view for a viewer of one character and one of two parses, names no unseen character's id or name, draws without throwing, and keeps every link in its log; the GM's view is the whole state.

Built for the campaign: `getKnownBy` (campaign rules) names the parties of the characters a viewer plays and so the characters they are told of; the campaign, exploration and downtime each have a censor typed on their own keys (`projections/seen.ts`), and `app/net/view.ts` composes them with the scene's into `viewFor(state, profile)`, the GM getting the state itself. The journal shows a player what was written to their parties and to the campaign, never a GM note or the log of a fight (it names whoever fought). Left: the views are not sent yet, and a text that names an unseen character inside a longer line (a campaign-wide note) is not caught.

Left to decide: what a viewer sees of a detected character they do not control (their whole sheet to begin with, a public face later), and a GM "view as" switch.
