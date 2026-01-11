
## 2026-01-10

- Seeded `cline_docs/activeContext.md` (previously empty) with a high-signal “AI briefing” that:
  - Restates the repo’s architectural thesis from README (deterministic domain → thin UI).
  - Documents authoritative boundaries and where logic should live (`app/domain/**` vs stores/components vs server actions).
  - Captures key invariants observed in code (RES/TGH/INS formula and derived-value rules).
  - Adds a workflow and prompt template for future tasks.
  - Notes that `.clinerules` references `Rulebook.md` and `rule_graph.json`, but they don’t exist in the repo currently.

- Implemented + refined a rulebook → JSON-LD knowledge graph extractor at `tools/extract_rule_graph.py`:
  - Reads `..\RPG_Below_v7_en\main.tex` and included `.tex` files.
  - Extracts mechanics from `\abil{...}` / `\inna{...}` (tagged `ability`) and `\spell{...}` (tagged `spell`).
  - Extracts colon-style definitions (`\textbf{Term:}`) as Keyword/Attribute/DerivedValue/Mechanic via heuristic.
  - Bootstraps “core domain nodes” that are implemented in `app/domain/**` with `codeMapping` (e.g. SM/DM selectors, RES/TGH/INS invariant formula selectors, movement selectors, Action Surge + Rest commands).
  - Merges into `rule_graph.json` (by `@id`, unioning tags and preferring existing descriptive fields).

- Fixed major noise issues in inferred edges + dangling references:
  - Dependency inference is now conservative: word-boundary regex matching against a curated alias list (stats/resources + DL/DC/TN).
  - Dangling reference logging now filters stopwords and only keeps terms that look like game terms (ALLCAPS acronyms or recurring Title-Case phrases).
  - Stopped re-loading persisted `dependsOn`/`modifies` from disk to avoid old noisy edges “sticking”; edges are recomputed each run.

- Current outputs (repo root):
  - `rule_graph.json`: ~587 nodes; ~31 with `codeMapping`; ~251 tagged `@status: unimplemented` (primarily abilities/spells).
  - `dangling_references.json`: reduced from extremely noisy to ~50 entries (top terms: XP, PEN, SD, MM, IB, GP, RV, etc.).

- Upgraded visualization tooling at `tools/visualize_schema.py`:
  - Turned it into a CLI that can load the JSON-LD `@graph`, build a directed graph, and **save static PNG/SVG** output.
  - Added filtering options (`--include-types`, `--exclude-types`, `--drop-isolates`) to avoid unreadable “hairball” graphs.
  - Added focus mode (`--focus "..." --hops N`) to render an N-hop neighborhood around a rule/mechanic.
  - Styled edges differently: `dependsOn` (solid gray) vs `modifies` (dashed red).
  - Generates example outputs under `artifacts/`:
    - `artifacts/rule_graph_core.svg` (core types only)
    - `artifacts/action_surge_2hops.svg` (Action Surge neighborhood)
