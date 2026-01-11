
# **FallowRPG**

### Deterministic Frontend Architecture for Complex Interactive Systems

**Live Demo:** https://fallow-fdxbyst5n-gbelows-projects.vercel.app/

**FallowRPG** is a web application built to explore how complex, highly interdependent rulesets can be modeled in a way that keeps the **frontend predictable, testable, and resilient** under heavy interaction.

While themed as a tabletop RPG assistance tool, the project’s primary focus is **frontend architecture**: extracting a deterministic domain layer that dramatically reduces UI complexity and state divergence in React applications.

---

## 🚨 Quick Links

* [Why This Project Exists](#why-this-project-exists)
* [Architecture Overview](#architecture-overview)
* [Domain–UI Relationship](#domainui-relationship)
* [Project Structure](#project-structure)
* [Minimal Feature Context](#minimal-feature-context)
* [Getting Started](#getting-started)
* [Design Decisions & Tradeoffs](#design-decisions--tradeoffs)
* [Tech Stack](#tech-stack)
* [License & Author](#license--author)

---

## Why This Project Exists

This project is intentionally **over-scoped in domain complexity** to stress-test frontend architecture decisions.

It explores:

* Deterministic modeling of cascading, interdependent rules
* Preventing state explosion **without global derived-state libraries**
* Type-driven enforcement of invariants in interactive systems
* Keeping React components **thin, declarative, and predictable**
* Making UI behavior stable even under frequent, non-linear updates

The goal is **not** to ship a complete game. 

The goal is to demonstrate how a complex system can remain **coherent, explainable, and maintainable** as interaction density increases — a common failure point in large frontend codebases. This project prioritizes **clarity under complexity**, not framework cleverness.

---

## How to Evaluate This Project

This project is best evaluated by examining how rule changes propagate through the system.
Most architectural decisions are visible in the domain layer and its relationship to the UI,
rather than in feature completeness or visual polish.

---

## Architecture Overview

At a high level, the system is structured as:

```
Domain (types, rules, selectors, updaters)
        ↓
React hooks & thin state layers
        ↓
UI components
```

### Key Principle

> **React is treated as an integration layer; authoritative game logic is not implemented inside components or hooks.**

All authoritative logic lives in a deterministic domain layer that can be:

* reasoned about in isolation
* recomputed safely at any time
* consumed by the UI without defensive synchronization logic

---

## Domain–UI Relationship

The most challenging and intentional part of this project was designing a **domain layer that is UI-agnostic, yet frontend-driven**.

### Domain Layer

* Pure, synchronous, deterministic logic
* No React dependencies
* No awareness of stores, components, or rendering
* Models characters, stats, equipment, injuries, and derived values
* Optimized for synchronous evaluation in response to user interaction

### UI Layer

* Consumes domain outputs
* Does not own or directly mutate derived values
* Renders projections of domain state
* Remains simple even as rules grow in complexity

This inversion dramatically reduces:

* prop drilling
* stale derived state
* synchronization bugs
* mental load when changing rules

---

## Project Structure

```text
app/
├── components/      # Thin UI & interaction panels
├── */.json          # JSON templates (domain inputs: characters, equipment, etc.)
├── domain/          # Deterministic rules, factories, selectors
├── hooks/           # UI-facing access to domain/state
├── stores/          # Localized Zustand slices (non-authoritative)
├── actions.ts       # Server actions (persistence boundaries)
└── page.tsx         # Application entry point
```

> ⚠️ **Note on Zustand**
> Zustand is used sparingly for localized coordination.
> It is **not** used as a global derived-state store.
> All authoritative game logic remains in the domain layer.

---

## Minimal Feature Context

Game mechanics exist to **anchor abstractions**, not to showcase feature breadth.

They were chosen specifically because they create **non-linear, cascading effects**, which are useful for testing deterministic modeling.

Examples include:

* Characters with multiple interdependent attributes
* Skills affected by size, injuries, and equipment
* Injuries and afflictions that apply category-based penalties
* Action and stamina economies with derived constraints
* Combat actions involving multiple characters

These mechanics ensure that small changes can have wide-reaching effects — exactly the kind of scenario that breaks naïve frontend state management.

---

## Getting Started

### Prerequisites

* Node.js **v20+**
* Upstash Redis account (for persistence)

### Setup

```bash
git clone https://github.com/gbelow/fallowrpg-character-manager.git
cd fallowrpg-character-manager
npm install
```

Create `.env`:

```env
UPSTASH_REDIS_URL=...
UPSTASH_REDIS_TOKEN=...
```

Run locally:

```bash
npm run dev
```

Open:

```
http://localhost:3000
```

---

## Design Decisions & Tradeoffs

This project prioritizes long-term coherence and change tolerance over short-term feature velocity. The central architectural decision was to model the game as a deterministic domain that fully owns rules, invariants, and data interpretation, with the UI acting purely as a consumer of domain outputs. This allows rule changes to be implemented by modifying the domain layer alone, without requiring coordinated updates across components, stores, or persistence logic.

State in the application is treated as derived by definition: the domain describes how the system behaves, not merely the shape of stored data. As a result, changing data or rules implies updating the domain logic rather than patching downstream consumers. This consolidation was intentional—it trades flexibility at the edges for clarity at the core, and prevents the UI from silently diverging from the rules it is meant to represent.

Global state libraries were deliberately avoided for derived logic. Redux was rejected due to its boilerplate cost and focus on action-based mutation rather than memoized computation. Zustand is used selectively as a coordination layer, primarily to manage memoization boundaries and prevent unnecessary re-renders under heavy interaction. It does not own rules or derived values; those remain in the domain.

For persistence, Redis was chosen over a relational database because the system operates on self-contained aggregates rather than relational queries. Characters and related entities are loaded and saved as whole objects, without joins. This simplifies iteration but introduces the responsibility of handling data evolution explicitly. The system assumes that data shape changes are intentional and versioned, with the domain acting as the authoritative interpreter of stored data rather than relying on implicit schema guarantees.

JSON files are used for domain inputs (characters, equipment, rules tables) both for transparency and for ease of bulk editing. This choice made experimentation and reshaping faster during development and reinforced the separation between data definition and rule evaluation. While not optimal for all production scenarios, it was valuable for exploring how rule changes propagate through the system.

This architecture required more upfront design and refactoring than a feature-first approach. However, the resulting system is significantly more scalable: boundaries are explicit, responsibilities are clear, and future expansion is expected to be faster and safer precisely because the difficult decisions have already been centralized.

These tradeoffs were intentional.

# Next steps:
* Formalize logic into a standalone rules manifest to make rules portable
* Creating a json-ld linking the rulebook to the rules
* Refactoring selector logic to lenses to better utilize the rules engine and tidy architecture
* Atomize consumption of the zustand store through hooks to improve performance
* formalizing the boundaries discovered during development and adding tests.
* Indexing redis database to allow transition from filesystem
* Implementing various rules from the game, leveraging the rules engine and AI

---

## Tech Stack

* **Framework:** Next.js (App Router, Server Actions)
* **UI:** React 19, TailwindCSS v4
* **Language:** TypeScript (strict)
* **Persistence:** Upstash Redis, Filesystem
* **Build Tooling:** Turbopack

---

## License & Author

**Private project**
Not licensed for commercial or public distribution.

**Made by Guilherme Below**
Full-Stack Engineer

---

