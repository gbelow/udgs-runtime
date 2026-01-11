# Active Context — chargenfallow (FallowRPG character manager)

This file is a **high-signal, low-noise “what matters right now” briefing** for the AI.
It should keep the assistant aligned with the repo’s architecture and constraints.


## 1) What this repo is (why it exists)

This project is intentionally **over-scoped in rules complexity** to stress-test frontend architecture.
The main deliverable is **coherent deterministic modeling** under heavy interaction.

Key principles pulled from README:
- Domain is pure/synchronous/deterministic; no React dependencies
- UI consumes projections of domain state and stays thin
- Zustand is used sparingly as coordination, not as global derived-state

## 2) Architecture map (authoritative boundaries)

**Flow:**

`JSON templates (app/**/*.json)` → `Zod schemas (app/domain/types.ts)` → `Factories (app/domain/factories.ts)` →
`Selectors (app/domain/selectors/**)` + `Commands (app/domain/commands/**)` → `Stores/hooks` → `Components`

### Domain layer (authoritative)

**Source of truth for rules & invariants:** `app/domain/**`

- Types + Zod schemas: `app/domain/types.ts`
  - Note: Zod `.strip()` is used and `.partial().transform(parse)` patterns exist.
  - Characters are parsed best-effort via ingest schemas and merged with defaults.

- Parsing & normalization:
  - `makeCharacter(raw)` in `app/domain/factories.ts` uses `CharacterIngestSchema.safeParse` and deep-merges nested objects.
  - This is the canonical “lossy/best-effort” importer.

- Selectors compute derived values:
  - e.g. wound thresholds **must** follow:
    `floor((0.5 * STR + base) * DM)`
    where base is stored in `c.characteristics.RES/TGH/INS` and DM comes from helpers.
    (See `app/domain/selectors/characteristics.ts`.)
  - Skills incorporate gear penalties, affliction penalties, size modifiers, etc.

- Commands are pure transformations:
  - e.g. `equipArmor`, `equipWeapon`, `putGauntlets`, `putHelm`.
  - Commands should validate inputs and return a **new** character object.

### UI/state layer (non-authoritative)

- Zustand stores (coordination): `app/stores/**`
  - `useCharacterStore` holds the current `character` aggregate and applies pure updaters.
  - Store should not own derived logic; it should call domain factories/selectors/commands.

- Components: `app/components/**`
  - Prefer thin, declarative components.
  - Use `use client` only when needed.

- Server actions/persistence boundary: `app/actions.ts`
  - File writes for base characters (`app/characters/**`) + Redis persistence.
  - Treat persistence as I/O, not rule evaluation.

## 3) Non-negotiable constraints (do not violate)

### DDD / invariants
- **Character data must flow through the Character aggregate** (`Character` / `CampaignCharacter`).
- **Never add a “setter” that bypasses**: `floor((0.5 * STR + base) * DM)`.
  - If UI wants to show RES/TGH/INS, it should display selectors, and only edit the *base additive term* if that’s intended.

### Determinism
- Domain functions must be:
  - synchronous
  - pure (no I/O, no time, no randomness) *except where explicitly modeled*
  - stable under recomputation

### TS / React conventions
- TypeScript strict mode.
- Prefer functional components + hooks.
- Prefer server actions for mutations that cross the persistence boundary.

## 4) How to change things safely (workflow)

When implementing a feature or fix:

1. **Identify which layer owns it** (domain vs UI vs persistence).
2. **Add/modify a domain selector/command** first.
3. Update any factories/ingest schemas if new data fields are required.
4. Only then wire it into the store/hook/component.
5. Use searches to find existing patterns before inventing new ones.

Heuristics:
- If it’s a rule/derived value: put it in `app/domain/selectors/**`.
- If it’s a user-triggered state change: model it as a pure `command` returning a new aggregate.
- If it’s reading/writing: server actions (`app/actions.ts`) or `redis.ts`.
