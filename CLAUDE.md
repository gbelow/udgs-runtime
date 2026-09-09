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

Pure, synchronous, deterministic, zero React dependencies. **Lenses** (`domain/character/lenses/`, `domain/combat/`) are the read side: every derived stat is computed fresh from the character by a getter, and `set` inverts through the modifiers so the stored *base* value changes, never the derived value. Registries are aggregated in `lenses/index.ts` (`skillLenses`, `characteristicLenses`, `movementLenses`), keyed by the corresponding type. **Commands** (`domain/character/commands/`, `domain/combat/commands/`) are the write side: pure updaters `(character) => character`, often curried.

Rule invariant: derived wound/stat values scale STR by the size damage-multiplier and add the stored base term unscaled — `floor(0.5 * STR * DM + base)` (see `getTGH`). This form keeps the base at a `+1` coefficient so the generic lens setter inverts at every size. Never add a setter that bypasses this — change the base, not the derived output. (The commented-out `getRES`/`getINS` still use the older `floor((0.5 * STR + base) * DM)`; reconcile them to the current form if you revive them.)

### Types & data ingestion (`domain/types.ts`, `domain/factories.ts`)

- **All types are Zod schemas.** `Character` is a discriminated union of `BaseCharacter` (`type: 'base'`, has `path`, stored as JSON files) and `CampaignCharacter` (`type: 'campaign'`, adds `injuries`/`afflictions`/`resources`, stored in Redis). Narrow with `isBaseCharacter` / `isCampaignCharacter` (`domain/utils.ts`).
- **Ingestion is intentionally lossy/best-effort.** `makeCharacter` / `makeCampaignCharacter` parse arbitrary raw JSON through permissive `*IngestSchema`s, then deep-merge onto a fully-defaulted empty character; only fields matching type+name survive. This is deliberate — data shape is versioned and the domain is the authoritative interpreter, so don't add defensive parsing in consumers.
- Game rule tables (afflictions, damage arrays, etc.) live in `domain/tables.ts`.

### State, hooks, UI

Zustand (`app/stores/`) only coordinates and bounds memoization/re-renders; it holds no rules. `useAppStore` is created via a per-request provider and **must be accessed inside `AppStoreProvider`**. `useActiveCharacterSelector` is the key indirection: it reads the current tab (`edit` | `play` | `break`) and runs the caller's selector against the active character *inside* the owning store's selector, so re-renders gate on the derived value rather than the character reference. Its companion `useActiveCharacterUpdate` returns a unified `update(updater)` that dispatches to the right store, so the same domain logic works identically in editing and combat.

Hooks (`app/hooks/`) are thin adapters, one per concern — keep new logic out of them; add it to a lens or command and expose it here. Components (`app/components/`) are declarative and Tailwind-only (no CSS files); they render domain projections and call hooks, and never own or mutate derived state. Server actions in `app/actions.ts` are the only persistence boundary (Redis for campaign characters, filesystem JSON under `app/characters/<path>/<name>.json` for base characters).

## Conventions

- TypeScript strict; functional components with hooks; `const`/`let`, never `var`.
- Prefer server actions for mutations; client components only when necessary.
- **No component performs arithmetic on a domain number.** Components render values and call handlers. If a component needs `a + b` over game data, add the getter to the domain and expose it through a hook — never compute it in JSX. When the domain lacks the *shape* the UI needs (a table, a set of rows), add a **view getter**: a pure `(c: Character) => RenderableShape`, like `getStrikeTerms`, `getDamageTiers`, or `getWeaponAttackRows`. A component reading a raw characteristic (`STR`, `STA`, `TGH`) is almost always about to do arithmetic with it — that's the tell.
- Two ESLint rules in `eslint.config.mjs` enforce the layering mechanically, so a violation fails `pnpm lint`: the domain may not import stores, React, or Zustand, and components may not import lenses or commands (`import type` is fine; `BreakMe.tsx` is exempt).
- When adding a stat/skill/characteristic: add it to the Zod schema in `types.ts`, write its getter in the relevant `lenses/` file, and register it in `lenses/index.ts`. Many entries are commented out (magic schools, extra characteristics) — uncommenting is how features are staged in.
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
- `creating.tex` — character model: attributes (STR/AGI/STA), size, races/age, master skill list and **value formulas**, character creation. Maps to `domain/character/lenses/` and `types.ts`.
- `combat.tex` — combat and everything grid-based. Maps to `domain/combat/`.
- `gear.tex` — gear properties and gear sheets. Maps to weapons/armor lenses and `app/assets/`.
- `story.tex`, `survival.tex`, `abilities.tex`, `spells.tex`, `war.tex`, `monsters.tex` — social/knowledge, exploration, abilities, spells, mass combat, NPCs.
- `main.toc` — generated table of contents; the fastest way to locate a section before grepping.

Cheat-sheets in `RPG_Below_v7_en/.claude/skills/*/SKILL.md` (`skill-test-core`, `attack-resolution`, `advancement`, `size-table`, `game-loops`) are the cheapest way to get the shape of a mechanic; each names the `.tex` to confirm against. Prefer: skill file for orientation → `.tex` for exact wording.

## Roadmap context

`nextSteps.md` (feature ideas) and `README.md` (architecture rationale, tradeoffs, and the "how to change things safely" workflow) hold design intent. `ui-design-patterns.md` contains the instructions for ui.
