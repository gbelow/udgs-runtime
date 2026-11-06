# fallow (UDGS-runtime)

**A character generator and game runner for the tabletop RPG fallowRPG, built to show what a deterministic frontend looks like.**

**Live demo:** https://fallow-app.vercel.app/

The game is the stress test. A ruleset where size, injuries, gear, afflictions, spells and other characters all feed into each other will break any frontend that keeps its rules in components. So this project keeps them out: a pure domain layer owns every rule and every derived number, and React only renders what the domain says and sends back what the player pressed.

> **React is an integration layer. Authoritative game logic is not implemented inside components or hooks.**

### Why a deterministic domain is worth it

The domain is plain synchronous TypeScript. It takes state and returns state, with no React, no stores, no I/O and no hidden clock. Everything else follows from that one property.

* **One source of truth.** A number exists in one place. The sheet, the combat panel, the log and a tooltip cannot disagree, because none of them computes it. Nothing derived is stored, so nothing derived can go stale.
* **The UI cannot get a rule wrong.** A component has no rule to get wrong. It renders a projection and sends a command, so a rules change is a domain change and the screens follow.
* **Bots are ordinary players.** A bot reads the same action panel a person sees and presses the same buttons. It decides nothing the book decides: what it may do is whatever the panel shows open. Because a press is data, the same path serves a click, a bot, a replay and a remote player at a multiplayer table.
* **Testing is cheap and honest.** Pure functions need no mocks, no DOM and no setup beyond the state itself. Thousands of tests run in a plain Node process, with no browser and no server. A fuzzer plays seeded random sessions through the real stores and checks what the architecture promises after every press.
* **It is portable.** Nothing in the domain knows it runs in a browser. The same code runs in Node for tests, in command-line tools (a duel simulator, a damage calculator) and on the server, and it could move to another UI framework or a native client without rewriting a rule.
* **It is explainable.** The domain can say why a value is what it is, and the action log is built to teach the game. The rules read like the book they come from, and each cites its source.

---

## Contents

* [What it does](#what-it-does)
* [Architecture](#architecture)
* [What holds the line](#what-holds-the-line)
* [Testing](#testing)
* [Changing things safely](#changing-things-safely)
* [Design decisions and tradeoffs](#design-decisions-and-tradeoffs)
* [What comes next](#what-comes-next)
* [Tech stack](#tech-stack)
* [Further reading](#further-reading)

---

## What it does

* **Characters.** Creation with XP pools, races, abilities, spells and gear; a sheet whose every number is derived and editable through invertible lenses; wounds, afflictions, encumbrance, money.
* **Campaigns.** Parties on their own clocks, point-crawl maps, a journal, curated collections of catalog entries, profiles with a GM role per campaign.
* **Exploration.** Time passes in exploration turns (ETs): groups travel, search and rest, and meet events on nodes and paths.
* **Downtime.** Days pass in whole blocks: living standards, training, jobs, doctors, learning tests.
* **Scenes.** Combat, chases and free scenes as one action sequence: a hex board with terrain, light, cover, walls and climbing, or no board at all. Actions, reactions, prepared reactions, grapples, spells, area effects.
* **Bots.** Players that read the same action panel a person sees and press the same buttons.
* **Catalogs.** Abilities, spells, gear, races, maps and events are authored in the app and stored as JSON.
* **Multiplayer.** A table relay shares a session between players, with optional manual dice.

---

## Architecture

Data flows one way:

```text
Domain (pure)  →  Zustand stores (non-authoritative)  →  hooks  →  thin UI components
```

### The domain (`app/domain/`)

Pure, synchronous, deterministic. Inside each part of the domain the folder name says what kind of function a file holds:

| Folder | Holds | Answers |
| --- | --- | --- |
| `rules/` | term and DL getters, outcome resolution, legality, tables | "What does the book say about this state?" |
| `commands/` | pure updaters `(state) => state`, usually curried | "What happens when the player presses this?" |
| `lenses/` (character) | invertible `{ get, set }` pairs and view getters | "What does the sheet show, and what do I store when it is edited?" |
| `projections/` (the rest) | state arranged for a screen | "What does this panel render?" |

A lens `set` inverts through the modifiers so that the stored **base** value changes and the derived value never does. For example, derived toughness is `floor(0.5 * STR * DM + base)`, so editing it writes the base term at every size.

### The parts of play

Time is moved by different sequences, and they meet only through the campaign:

```text
                      campaign
            (roster, parties, clocks, maps, journal)
              ↑           ↑            ↑
        exploration    downtime       scene
          (ETs)         (days)   (actions, reactions,
                                  optional board)

   play/  the skill test and the dice, shared by all, importing none
   bot/   a player: reads the scene's panel, presses its buttons
```

The campaign imports no mode. A fight checks characters out of the roster and back in; exploration and downtime never import each other or the scene.

### Every press is data, and each part of the state has one reducer

The write side is a reducer pattern. A command is a pure function from the old state to the new one, and the state is plain, serializable data. There are no callbacks that reach in and mutate, and no side effects hidden in a handler.

* **Commands are registered by name.** Each part keeps a registry (`scene/commands/registry.ts`, `campaign/commands/registry.ts`, `exploration/commands/registry.ts`, `downtime/commands/registry.ts`, `character/commands/registry.ts`). An entry names the updater it runs and whom it acts for. Hooks send a command through one dispatch path that refuses what the screen may not do, and that same path serves a click, a bot and the multiplayer relay.
* **An action in a fight is data too.** A strike, a defense or a grapple is a plain record (kind, actor, target, declarations, roll, status) stored in the scene's state, not a procedure. Its consequences land through one reducer for each kind of thing it can touch: characters, grapples, the objects on the floor (which can take charges) and the board's terrain (which can be acted upon). Each is changed in exactly one place. For characters the reducer is `(character, action) => character`, and the character's role in the action decides what changes: the actor pays, the defender pays for the reaction, the target takes the damage, a bystander is untouched.
* **The action log as working state.** An action is written step by step as it is played (declared, reacted to, rolled, completed), and the rules read it while it is still in play. Actions are keyed by id and link to each other by id (a reaction names the action it answers). Rules follow those links, and facts that happen to an action on its way (an interruption landing on its actor) are stamped on it at the moment they happen. No rule works out what happened from the order of the entries. The log a player reads is a view assembled from this table for display, and an action only appears in it once it has landed.

This is what makes errors easy to find. A bug is a pair of a state and a command, and both are data, so it can be saved, replayed and bisected step by step. Because every step is a pure change of that state, you can see exactly which command first produced a state that should not exist, instead of reconstructing a chain of handlers and effects. The board fuzzer relies on this: it records every session as the starting state plus the commands it sent and the dice each drew, and plays any failure back one step at a time.

### State, hooks, components

* **Stores** (`app/stores/`) coordinate and bound re-renders. They hold no rules.
* **`useActiveCharacterSelector`** runs a caller's selector against the active character inside the owning store's selector, so components re-render when the derived value changes, not when the character reference does.
* **Hooks** (`app/hooks/`) are thin adapters, one per concern.
* **Components** (`app/components/`) are declarative and Tailwind-only. They render projections and call handlers.
* **Server actions** (`app/actions.ts`) are the only persistence boundary. Each reads the profile from the cookie and refuses what that profile may not do.

### Types and data

Every type is a Zod schema. `Character` is a discriminated union of `BaseCharacter` (JSON files) and `CampaignCharacter` (Redis). Loading is deliberately best-effort: arbitrary JSON is parsed through permissive ingest schemas and merged onto a fully defaulted character, because the domain is the authoritative interpreter of stored data and consumers should not parse defensively.

---

## What holds the line

The architecture is enforced through `pnpm lint`.

* The domain may not import stores, React or Zustand.
* Rules, lenses and projections may not import commands or the bot: reading never runs a button.
* `character/` and `item/` may not form an import cycle.
* The parts of play meet only through the campaign.
* Components may not import rules, lenses, projections or commands, so they go through a hook.
* The scene's shared code reaches the chase only through a short, listed set of crossing points.

One convention carries the rest: **no component performs arithmetic on a domain number.** If a component needs `a + b` over game data, the domain owes it a getter. A component reading a raw characteristic like `STR` is the tell that a rule is about to leak into the UI.

---

## Testing

The suite is a filter, not a coverage target. Every test must have an expected value that does not come from the code under test: an invariant, a contract at a real boundary, or a bug that actually happened. Mirror tests, snapshots of derived output and component tests are rejected. Registry completeness is held by type annotations instead of tests.

* `pnpm test:run` runs thousands of tests in a plain Node process, with no DOM and no mocks.
* `pnpm test:fuzz` runs the **board fuzzer**: seeded random sessions press every click and every panel command, including duels, crowds, chases and tables that roll their own dice. After each press it asserts what the architecture promises of any session: nothing throws, the state satisfies the schema and round-trips through storage, and what the view calls closed is refused. A failure names its seed and replays step by step.

The full convention is in [`instructions/testing.md`](instructions/testing.md).

---

## Changing things safely

Start in the domain and work outward:

`app/assets/*.json` → Zod schemas (`domain/types.ts`) → factories (`domain/factories.ts`) → rules, lenses or projections, and commands → stores and hooks → components

1. Decide which layer owns the change: domain, UI or persistence.
2. Change the domain first: a getter in `rules/`, a lens, a projection or a command.
3. Update the ingest schemas and factories if new data is needed.
4. Wire it into a store, hook and component last.
5. Search for an existing pattern before inventing one.

Adding a stat or skill: add it to the schema in `types.ts`, write its term getter in the relevant `rules/` file, and register its lens in `lenses/index.ts`.

---

## Design decisions and tradeoffs

The central decision was to model the game as a deterministic domain that fully owns rules, invariants and data interpretation, with the UI as a pure consumer. A rule change is then a domain change alone, with no coordinated edits across components, stores and persistence. It trades flexibility at the edges for clarity at the core, and it stops the UI from quietly diverging from the rules it represents.

**No global derived-state library.** Redux was rejected for its boilerplate and its focus on action-based mutation rather than memoized computation. Zustand is used only to bound memoization and re-renders. Derived values are recomputed from the domain and never stored.

**Projections make small UI changes cost more.** Putting a screen's shape in a projection or view getter, instead of computing it in the component, means that even a small front-end change (one more column, a different grouping) is a change in two places: the domain shape, then the component. That is a real tax, and in a hand-written codebase it would often not be worth paying. Here it is, because most of this code is written with AI, and the indirection is not hard for AI: the pattern is regular, the layers are lint-enforced, and the places to edit are always the same. The cost falls on the part that is cheap to automate, and the benefit, a UI that cannot drift from the rules, stays.

**Redis over a relational database.** The system works on whole aggregates (characters, campaigns, profiles, collections) with no joins. A campaign is a document naming its characters by id. This keeps iteration fast and makes data evolution an explicit responsibility of the domain.

**Lossy ingestion.** Stored data is loaded best-effort. Arbitrary JSON is parsed through permissive schemas and merged onto a fully defaulted character, and only fields whose name and type match survive. Consumers never parse defensively, and old saves always load as the schema grows. The cost is that a malformed or renamed field disappears silently instead of failing loudly. The choice rests on the domain being the authoritative interpreter of stored data: if the shape of a field changes, the domain, not each consumer, decides what an old value means.

**No VTT integration.** The app is meant to be played online, with each character belonging to a player and every action needing input from several of them. The positions, paths, triggers, lighting and visibility that decide an action are rules, so the app has to be the authority over them. A virtual tabletop would hold its own copy of that state and make the app negotiate with it. So the board has its own renderer, and the cost is giving up the ecosystem of existing tabletop tools.

**JSON for authored content.** Catalogs and base characters are JSON files, which keeps data definition apart from rule evaluation and makes bulk edits easy.

**The rulebook is the source of truth for the rules; the app is the source of truth for the content.** The rules (formulas, tables, terminology) come from a separate LaTeX rulebook. The code encodes each one once and cites the source where a formula is not obvious. Where code and book disagree, that is reported, not silently resolved. The content (abilities, spells, gear, races, maps, events) is authored in the app's own forms, so an edit is made once and applies everywhere. The book's worked examples and statblocks are not an input.

---

## What comes next

The bots already play through the same commands and the same panel as a person. The next ambition is bots driven by language models, using tools. Because the domain answers "what may be done now" with the open actions on the panel, and because every press is a named command, a model can be given the panel as its tool list and can only do what the book allows. The domain stays the rules authority, and the model supplies only the judgment about what to try.

---

## Tech stack

* **Framework:** Next.js 16 (App Router, Server Actions), Turbopack
* **UI:** React 19, Tailwind CSS v4, PixiJS for the board, three.js for dice
* **Language:** TypeScript (strict), Zod 4
* **State:** Zustand
* **Persistence:** Upstash Redis, filesystem JSON
* **Multiplayer:** a WebSocket relay (`relay/`)
* **Tests:** Vitest

---

## Further reading

* [`CLAUDE.md`](CLAUDE.md): the architecture in full, as the working guide for contributors and AI agents
* [`instructions/scene-map.md`](instructions/scene-map.md): the scene's action pipeline and a map of its files
* [`instructions/testing.md`](instructions/testing.md): the testing gate and the fuzzer
* [`instructions/ui-design-patterns.md`](instructions/ui-design-patterns.md): UI conventions
* [`nextSteps.md`](nextSteps.md): feature ideas

---

**Private project.** Not licensed for commercial or public distribution.
Made by Guilherme Below, full-stack engineer.
