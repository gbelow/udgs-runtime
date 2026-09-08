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

- Package manager is **pnpm** (`pnpm-lock.yaml`; the old `yarn.lock` is deleted). Node v20+.
- Tests run on **Vitest** (`pnpm test` / `pnpm test:run`). Test files (`*.test.ts`) live alongside the domain code they exercise — lenses, commands, factories, and items.
- Requires `.env` with `UPSTASH_REDIS_URL` and `UPSTASH_REDIS_TOKEN` (see `.env.example`) for Redis persistence.

## Architecture

Data flows in one direction: **Domain (pure) → Zustand stores (non-authoritative) → hooks → thin UI components.**

### Domain layer (`app/domain/`) — the heart of the project

Pure, synchronous, deterministic, zero React dependencies. Two complementary patterns:

- **Lenses** (`domain/character/lenses/`, `domain/combat/`) — *read-side*. A `Lens<T, V>` has `get(subject)` / `set(subject, value)`. Every derived stat (skills, characteristics, movement, gear-affected values) is computed fresh from the character via a getter. `set` inverts through the modifiers so the stored *base* value changes, never the derived value. Lens registries are aggregated in `lenses/index.ts` (`skillLenses`, `characteristicLenses`, `movementLenses`), keyed by the corresponding type. Getters compose (e.g. `getStrike` calls `getMelee` + affliction penalties).
- **Commands** (`domain/character/commands/`, `domain/combat/commands/`) — *write-side*. Each exports a pure updater `(character) => character` (often curried, e.g. `addAffliction(key)(c)`). Combat commands operate on the combat state.

Rule invariant: derived wound/stat values scale STR by the size damage-multiplier and add the stored base term unscaled — `floor(0.5 * STR * DM + base)` (see `getTGH`). This form keeps the base at a `+1` coefficient so the generic lens setter inverts at every size. Never add a setter that bypasses this — change the base, not the derived output. (The commented-out `getRES`/`getINS` still use the older `floor((0.5 * STR + base) * DM)`; reconcile them to the current form if you revive them.)

### Types & data ingestion (`domain/types.ts`, `domain/factories.ts`)

- **All types are Zod schemas.** `Character` is a discriminated union of `BaseCharacter` (`type: 'base'`, has `path`, stored as JSON files) and `CampaignCharacter` (`type: 'campaign'`, adds `injuries`/`afflictions`/`resources`, stored in Redis). Narrow with `isBaseCharacter` / `isCampaignCharacter` (`domain/utils.ts`).
- **Ingestion is intentionally lossy/best-effort.** `makeCharacter` / `makeCampaignCharacter` parse arbitrary raw JSON through permissive `*IngestSchema`s, then deep-merge onto a fully-defaulted empty character. Only fields matching type+name survive; unknown keys are stripped. This is deliberate — data shape is versioned and the domain is the authoritative interpreter, so don't add defensive parsing in consumers.
- Game rule tables (afflictions, damage arrays, etc.) live in `domain/tables.ts`.

### State layer (`app/stores/`) — Zustand, deliberately non-authoritative

Zustand only coordinates and bounds memoization/re-renders; it holds no rules.
- `useCharacterStore` — the single character being edited (`edit` tab).
- `useCombatStore` — map of `CampaignCharacter`s in a fight, active character, round/turn.
- `useAppStore` — created via a per-request provider (`appStoreProvider.tsx`, `createAppStore`), holds selected tab and character lists; **must be accessed inside `AppStoreProvider`**.

`useActiveCharacter` is the key indirection: it reads the current tab (`edit` | `play` | `break`) and returns the active character plus a **unified `update(updater)`** that dispatches to the right store. All command/lens hooks go through it, so the same domain logic works identically in editing and combat.

### Hooks (`app/hooks/`)

Thin adapters, one per concern (`useSkillLens`, `useCharacteristicLens`, `useWeaponLens`, `useCharacterCommands`, `useCombatCommands`, …). Pattern: pull the relevant lens/command from the domain, read via `lens.get(character)`, write via `useActiveCharacter().update(...)`. Keep new logic out of hooks — add it to a lens or command and expose it here.

### UI (`app/components/`)

Thin, declarative, Tailwind-only (no CSS files), React 19, `'use client'` where needed. Components render domain projections and call hooks; they do not own or mutate derived state. Main tabs: `CharacterCreator`, `PlayPanel` (combat), `BreakMe` (stress test). Server actions in `app/actions.ts` are the only persistence boundary (Redis for campaign chars, filesystem JSON under `app/characters/<path>/<name>.json` for base chars).

## Conventions

- TypeScript strict; functional components with hooks; `const`/`let`, never `var`.
- Prefer server actions for mutations; client components only when necessary.
- **No component performs arithmetic on a domain number.** Components render values and call handlers. If a component needs `a + b` over game data, add the getter to the domain and expose it through a hook — never compute it in JSX. When the domain lacks the *shape* the UI needs (a table, a set of rows), add a **view getter**: a pure `(c: Character) => RenderableShape`, like `getStrikeTerms`, `getDamageTiers`, or `getWeaponAttackRows`. A component reading a raw characteristic (`STR`, `STA`, `TGH`) is almost always about to do arithmetic with it — that's the tell.
- Two ESLint rules in `eslint.config.mjs` enforce the layering mechanically, so a violation fails `pnpm lint`: `app/domain/**` may not import `app/stores/**`, React, or Zustand; `app/components/**` may not import `**/domain/*/lenses/**` or `**/domain/*/commands/**` (type-only imports are fine via `import type`; `types`/`tables`/`factories`/`utils`/`dice` stay allowed; `BreakMe.tsx` is exempt as an instrumentation harness).
- When adding a stat/skill/characteristic: add it to the Zod schema in `types.ts`, write its getter in the relevant `lenses/` file, and register it in `lenses/index.ts`. Many entries are commented out (magic schools, extra characteristics) — uncommenting is how features are staged in.
- New game mechanics: check `rule_graph.json` for name collisions and use the `urn:ttrpg:` namespace when extracting rules. `tools/` holds Python scripts (`extract_rule_graph.py`, `visualize_schema.py`) that generate `rule_graph.json` / `dangling_references.json`.
- On Windows, avoid chained `cmd /c dir && type`; use single commands to reduce process-spawn overhead.

## The rulebook (authoritative source for game rules)

The tabletop rules this app implements live in a **separate LaTeX repo**: `C:/Users/Administrator/code/RPG_Below_v7_en` (registered as an additional working directory in `.claude/settings.local.json`, and **read-only** — writes to it are denied; its own `CLAUDE.md` forbids AI editing of the `.tex` text).

**It is the source of truth for game rules; this repo is only an implementation of them.** When a task involves a rule, formula, table, or terminology — before writing a lens, command, or table entry — read the relevant `.tex` there rather than inferring the rule from existing code. If code and rulebook disagree, say so instead of silently picking one.

Read `RPG_Below_v7_en/CLAUDE.md` first for its full file map and design principles. Quick index:

- `play.tex` — **core skill test** (d10 + skill vs DL, degrees of success, exploding die, safe/risky) and the four game loops. Any question about test resolution starts here.
- `creating.tex` — character model: attributes (STR/AGI/STA), size, races/age, master skill list and **value formulas**, character creation. Maps to `domain/character/lenses/` and `types.ts`.
- `combat.tex` — combat and everything grid-based. Maps to `domain/combat/`.
- `gear.tex` — gear properties and gear sheets. Maps to weapons/armor lenses and `app/assets/`.
- `story.tex`, `survival.tex`, `abilities.tex`, `spells.tex`, `war.tex`, `monsters.tex` — social/knowledge, exploration, abilities, spells, mass combat, NPCs.
- `main.toc` — generated table of contents; the fastest way to locate a section before grepping.

Compressed cheat-sheets live in `RPG_Below_v7_en/.claude/skills/*/SKILL.md` (`skill-test-core`, `attack-resolution`, `advancement`, `size-table`, `game-loops`). They are not loaded as skills in this project, but reading those files is the cheapest way to get the shape of a mechanic; each names the `.tex` to confirm against. Prefer: skill file for orientation → `.tex` for exact wording.

Do not copy rules prose into this repo. Encode the rule in the domain layer and cite the source file (e.g. `// combat.tex "Strike"`) where a formula is non-obvious.


## Roadmap context

`nextSteps.md` (feature ideas) and `README.md` (architecture rationale, tradeoffs, and the "how to change things safely" workflow) hold design intent. `ui-design-patterns.md` contains the instructions for ui.
