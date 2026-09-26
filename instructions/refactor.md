Open refactor items (combat domain)

Needs a decision

- getEvasiveJumpPlacements (rules/move.ts) refuses any occupied cell. Every other placement goes through canRest, which lets two characters at least two sizes apart share a cell (creating.tex "Size and Space Occupation", as quoted beside canRest). Bug or intended?

Unused and small

- Orientation (geometry.ts) is a literal-union second definition of DirectionSchema (combat/types.ts). Unifying needs DirectionSchema to infer 0..5 rather than number.
- rollTest / RollMode (dice.ts) have no callers: safe and risky tests are not wired in. Inert structure drawn ahead, kept on purpose.

Places that break the project's own rules

- Screen text inside rules/: labels and reason strings in options.ts (findOption only reads .available), HOP_LABELS (damage.ts), getSpellOptions (cast.ts), getChargeOptions (explosion.ts), getDisarmOptions (grapple.ts) and getDragSides (drag.ts). They belong in projections.
- getDLTerms (rules/attack.ts) lists the kinds without a DL in an if chain over Action; its sibling getRootTestTerms is an exhaustive switch over RootAction. A new root kind falls silently into the defender branch.
- Misfiled: the plane geometry in rules/board.ts (toPlane, centroid, angleBetween, angularGap) is used by boardView and belongs with geometry. rules/activeCharacter.ts also holds findHeldItem and getFightName.
- commands/ holds non-button helpers (log.ts, reduce.ts, sequence.ts). Fine, but CLAUDE.md doesn't describe them.

Architecture

1. Adding an action kind still means editing per-kind code in several places (getDeclaredCost, isDeclarationComplete, getDLTerms, getTargetIds, getNextStep, triggers, options). Longer term: a record of handlers per kind checked with satisfies { [K in ActionKind]: … }.
2. Projections are computed twice per store write: each *Digest is JSON.stringify(getX(state)) and the hook calls getX again to render (useBoard, useCombatActions). getActionPanel is heavy. Caching each projection per state object (a WeakMap) would halve the work without touching the hooks' gating.
