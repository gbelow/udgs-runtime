# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

**chargenfallow** (a.k.a. UDGS-runtime) is a Next.js character generator / game-running tool for the tabletop RPG "fallowRPG". Its explicit purpose is to explore **deterministic frontend architecture**: a pure domain layer fully owns all game rules and derived values, while React acts only as an integration/rendering layer. When making changes, preserve this inversion — authoritative logic must never leak into components or hooks.

## Commands

```bash
pnpm dev      # dev server with Turbopack (localhost:3000)
pnpm build    # production build with Turbopack
pnpm start    # serve production build
pnpm lint     # eslint
pnpm test     # vitest (watch)
pnpm test:run # vitest single run
```

Package manager is **pnpm**, Node v20+. Redis persistence requires `.env` with `UPSTASH_REDIS_URL` and `UPSTASH_REDIS_TOKEN` (see `.env.example`).

## Architecture

Data flows in one direction: **Domain (pure) → Zustand stores (non-authoritative) → hooks → thin UI components.**

### Domain layer (`app/domain/`) — the heart of the project

Pure, synchronous, deterministic, zero React dependencies. Each part of the domain (`character/`, `scene/`, `item/`, `campaign/`, `exploration/`) is split into three kinds of pure function, and the folder name says which kind a file holds:

- **Rules** (`rules/`) answer "what does the book say about this state?": term and DL getters, outcome resolution, path legality, line of sight, affliction and wound tables, what may be declared. These are the functions that cite a `.tex` line. Rules import nothing from the two folders below.
- **Commands** (`commands/`) are the write side — the buttons a player can press: pure updaters `(character) => character` or `(state) => state`, often curried, that call rules to decide what happens. The folder also holds the write-side machinery those buttons share, which is not a button itself: under `scene/`, the action-log bookkeeping (`log.ts`), the reducers that land a phase of an action on each character, the grapples, the floor and the board (`reduce.ts`), and the sequencing that carries the stack on after every command (`sequence.ts`).
- The read-for-UI side differs by part. Under `character/` it is **lenses** (`lenses/`): invertible `{get, set}` pairs over a character, where `set` inverts through the modifiers so the stored *base* value changes, never the derived value, plus the view getters (`getWeaponPanels`, `getArmorPanel`, `getSpellSheetRows`…) that shape the character for a screen. Registries are aggregated in `lenses/index.ts` (`skillLenses`, `characteristicLenses`, `movementLenses`), keyed by the corresponding type. Under `scene/`, `item/`, `campaign/` and `exploration/` it is **projections** (`projections/`): state arranged for a screen — the action panel, board view, roster, outcome previews, the hands and container panels, the catalog rows — with nothing to invert. Neither has a lens: nothing there has a `set`.

A file that mixes a rule with its view is split, not filed under whichever half is bigger.

The parts of play are split by the sequence that moves time, and meet only through the campaign; an ESLint rule (`import/no-restricted-paths`) holds the lines:

- `domain/campaign/` holds what every sequence reads and moves, and has no loop of its own: the roster of everyone in play who is not in a fight, the parties they are in, when each party is — each on a timeline of its own (a clock in whole ETs; days are a rule over it, and how many ETs of a day are daylight; anything shorter is played out in a scene), or outside time, as an encounter is, until it is placed on one; only a party in play on a timeline feels time pass, and only through the sequence it is in — exploring (ETs) or in downtime (days), as a whole party, never a character apart from it; exploration's `toDowntime` takes a party in a settlement out, and downtime's `toExploration` brings it back once nobody in it is on an activity — and a party is synced to another timeline only forward, either placed there or living the time between — and where each party is — a node of one of the campaign's point crawl maps, each the campaign's own copy of a map from the catalog (authored in the Catalog tab's Maps, saved as JSON under `app/assets/maps`), so what play changes on it stays in the campaign; a node is made of a terrain preset from the terrain catalog that the node keeps only its changes to. Collections are not the campaign's: each is a curated list of one catalog's entries by key (made in the Catalog tab's Collections), owned by the profile that made it and shared with named profiles or with every member of a campaign, offered by a picker beside the lists read off the catalog itself, whole and by category; their types, commands and projection still sit under `domain/campaign/`, and who may read or change one is in `domain/profiles.ts`. It keeps a journal too: entries written to a party at its moment, or to the campaign as a whole — notes by hand (some kept from the players) and what play records at the command where it happens (an ET's results, days of downtime, a return from a scene, a sync, a fight's log when the table saves it). A path has a DL each way and events that happen one way or both. A character is on the roster or in the fight, never both — the scene's `sendToFight` / `returnFromFight` move them across, and a party or a single character is sent or brought back, and the clock of a party moves on by the ETs the table says the fight took (none by default) once, when the last of its fighters comes back; a character sent to a fight keeps their id and sits out what they planned that ET; the fight takes their party from the campaign, the table may change it before and during the fight, and the campaign takes them back in whatever party the fight left them in (a party made in the fight joins the campaign where the first party it was fighting with is). Nobody sent from the roster is ever lost: removing or resetting gives them back. The campaign imports no mode.
- `domain/scene/` is the action sequence (`play.tex` "Scene"): actions, reactions, the optional board. Combat, chase, boardless play and free scenes are one sequence varied along two axes, not separate folders: time (rounds, each kind with its AP budget, or free, with no rounds and no AP) and space (the board, boardless, or the chase's distances between sides).
- `domain/exploration/` is the ET sequence. Its state (each party's groups and camp, rests, the ET's opening and results) sits beside the campaign in the campaign store, and its commands take `{ campaign, exploration }` together. Each member plans their ET (a group going on an exploration action, a spell whose cost takes the ET, a rest, or idle), and only a group that travels splits off as a party of its own; search and travel meet the events on nodes and paths, each read by the degree the group's score reaches against it. It may read and move the campaign but never import the scene: an event that becomes an episode hands characters over through the campaign's check-out.
- `domain/downtime/` is the days sequence (`story.tex` "Downtime"): each character's living standard and the one activity they are on (training with a trainer the table accepts, training alone, job, doctor, learning test), resolved whole on its last day; time spent elsewhere while it is under way cancels it. Its state sits beside the campaign in the campaign store like exploration's, its commands take `{ campaign, downtime }`, and the days pass for every party in play on a timeline that is in downtime only with a plan every purse pays for. It imports neither exploration nor the scene.
- `domain/play/` is the skill test and the dice (`play.tex` "How skills work"), shared by every part and importing none of them.

`domain/bot/` is a player, not a part of the rules: pure functions that read a `SceneState` through the scene rules and answer with the same commands a person presses (`stepBot`, `playBot`). It decides nothing the book decides — what it may do is whatever `getAvailableActions` shows open — and a hook or server action drives it.

Before working in `scene/`, read `instructions/scene-map.md`: the action pipeline, the stack and its sequencing, and a map of every file. It points to detail files under `instructions/scene-map/` (mechanics, landing, board); read only the one the change touches.

Rule invariant: derived wound/stat values scale STR by the size damage-multiplier and add the stored base term unscaled — `floor(0.5 * STR * DM + base)` (see `getTGH`). This form keeps the base at a `+1` coefficient so the generic lens setter inverts at every size. Never add a setter that bypasses this — change the base, not the derived output. (The commented-out `getRES`/`getINS` still use the older `floor((0.5 * STR + base) * DM)`; reconcile them to the current form if you revive them.)

### Types & data ingestion (`domain/types.ts`, `domain/factories.ts`)

- **All types are Zod schemas.** `Character` is a discriminated union of `BaseCharacter` (`type: 'base'`, has `path`, stored as JSON files) and `CampaignCharacter` (`type: 'campaign'`, adds `injuries`/`afflictions`/`resources`, stored in Redis). Narrow with `isBaseCharacter` / `isCampaignCharacter` (`domain/utils.ts`).
- **Ingestion is intentionally lossy/best-effort.** `makeCharacter` / `makeCampaignCharacter` parse arbitrary raw JSON through permissive `*IngestSchema`s, then deep-merge onto a fully-defaulted empty character; only fields matching type+name survive. This is deliberate — data shape is versioned and the domain is the authoritative interpreter, so don't add defensive parsing in consumers.
- Game rule tables (afflictions, damage arrays, etc.) live in `domain/tables.ts`.

### State, hooks, UI

Zustand (`app/stores/`) only coordinates and bounds memoization/re-renders; it holds no rules. `useAppStore` is created via a per-request provider and **must be accessed inside `AppStoreProvider`**. `useActiveCharacterSelector` is the key indirection: it reads the current tab (`edit`, the run screen's `scene` | `exploration` | `downtime`, …), finds the store that owns it (`TAB_OWNER`), and runs the caller's selector against the active character *inside* the owning store's selector, so re-renders gate on the derived value rather than the character reference. Its companion `useActiveCharacterUpdate` returns a unified `update(updater)` that dispatches to the right store, so the same domain logic works identically in editing and combat.

Hooks (`app/hooks/`) are thin adapters, one per concern — keep new logic out of them; add it to a rule, lens, projection or command and expose it here. Components (`app/components/`) are declarative and Tailwind-only (no CSS files); they render domain projections and call hooks, and never own or mutate derived state. Server actions in `app/actions.ts` are the only persistence boundary, and each reads who is asking from the profile cookie and refuses what that profile may not do (Redis for profiles, for collections, for campaign characters and for campaigns — a campaign document naming its characters by id, shaped in `domain/saves.ts`, with player characters kept in their own records and every other character under the campaign's key — and filesystem JSON under `app/characters/<path>/<name>.json` for base characters).

## Conventions

- TypeScript strict; functional components with hooks; `const`/`let`, never `var`.
- Prefer server actions for mutations; client components only when necessary.
- **No component performs arithmetic on a domain number.** Components render values and call handlers. If a component needs `a + b` over game data, add the getter to the domain and expose it through a hook — never compute it in JSX. When the domain lacks the *shape* the UI needs (a table, a set of rows), add a **view getter**: a pure `(c: Character) => RenderableShape`, like `getStrikeTerms`, `getDamageTiers`, or `getWeaponAttackRows`. A component reading a raw characteristic (`STR`, `STA`, `TGH`) is almost always about to do arithmetic with it — that's the tell.
- Six ESLint rules in `eslint.config.mjs` enforce the layering mechanically, so a violation fails `pnpm lint`: the domain may not import stores, React, or Zustand; rules, lenses and projections may not import commands or the bot (tests excepted); `character/` and `item/` may not form an import cycle (size → items → character state → AP prices; split a file that imports upward); the parts of play meet only through the campaign (the campaign imports no mode, exploration, downtime and combat never import each other, and `play/` imports none of them); components may not import rules, lenses, projections or commands (`import type` is fine; `BreakMe.tsx` is exempt); and the scene's shared rules, commands and projections reach the chase only through the crossing points listed in rule 6 (see `instructions/scene-map.md` idea 12).
- When adding a stat/skill/characteristic: add it to the Zod schema in `types.ts`, write its term getter in the relevant `rules/` file, and register the lens in `lenses/index.ts`. Many entries are commented out (magic schools, extra characteristics) — uncommenting is how features are staged in.
- New game mechanics: check `rule_graph.json` for name collisions and use the `urn:ttrpg:` namespace when extracting rules. `tools/` holds Python scripts (`extract_rule_graph.py`, `visualize_schema.py`) that generate `rule_graph.json` / `dangling_references.json`.
- On Windows, avoid chained `cmd /c dir && type`; use single commands to reduce process-spawn overhead.
- Don't leave comments describing the diff or the reasoning behind a change — that belongs in the commit message, not the file

## Testing culture

`instructions/testing.md`, imported below, governs every test in this repo — what gets written, what gets rejected, and the conventions around both. Apply it before writing, proposing, or reviewing a test. Registry completeness is held by the type annotations on the registries themselves (`Record<keyof Skills, …>` and friends) rather than by tests; add the annotation when a new registry appears.

@instructions/testing.md

## The rulebook (authoritative source for game rules)

The tabletop rules this app implements live in a separate, **read-only** LaTeX repo: `C:/Users/Administrator/code/RPG_Below_v7_en` (registered as an additional working directory; writes are denied, and its own `CLAUDE.md` forbids AI editing of the `.tex` text).

**It is the source of truth for game rules; this repo is only an implementation of them.** Before writing a lens, command, or table entry that touches a rule, formula, table, or piece of terminology, read the relevant `.tex` rather than inferring the rule from existing code. If code and rulebook disagree, say so instead of silently picking one. Do not copy rules prose into this repo — encode the rule in the domain layer and cite the source (e.g. `// combat.tex "Strike"`) where a formula is non-obvious.

Read `RPG_Below_v7_en/CLAUDE.md` first for its full file map and design principles. Quick index:

- `play.tex` — **core skill test** (d10 + skill vs DL, degrees of success, exploding die, safe/risky) and the four game loops. Any question about test resolution starts here.
- `creating.tex` — character model: attributes (STR/AGI/STA), size, races/age, master skill list and **value formulas**, character creation. Maps to `domain/character/rules/` and `types.ts`.
- `combat.tex` — combat and everything grid-based. Maps to `domain/scene/`.
- `gear.tex` — gear properties and gear sheets. Maps to `domain/character/rules/gear.ts`, `armor.ts` and `app/assets/`.
- `story.tex`, `survival.tex`, `abilities.tex`, `spells.tex`, `war.tex`, `monsters.tex` — social/knowledge, exploration, abilities, spells, mass combat, NPCs.
- `main.toc` — generated table of contents; the fastest way to locate a section before grepping.

Cheat-sheets in `RPG_Below_v7_en/.claude/skills/*/SKILL.md` (`skill-test-core`, `attack-resolution`, `advancement`, `size-table`, `game-loops`) are the cheapest way to get the shape of a mechanic; each names the `.tex` to confirm against. Prefer: skill file for orientation → `.tex` for exact wording.

## Roadmap context

`nextSteps.md` (feature ideas) and `README.md` (architecture rationale, tradeoffs, and the "how to change things safely" workflow) hold design intent. `ui-design-patterns.md` contains the instructions for ui.
