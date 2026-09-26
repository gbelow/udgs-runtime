Open refactor items (combat domain)

Unused and small

- rollTest / RollMode (dice.ts) have no callers: safe and risky tests are not wired in. Inert structure drawn ahead, kept on purpose.

Places that break the project's own rules

- Screen text inside rules/: labels and reason strings in options.ts (findOption only reads .available), HOP_LABELS (damage.ts), getSpellOptions (cast.ts), getChargeOptions (explosion.ts), getDisarmOptions (grapple.ts) and getDragSides (drag.ts). They belong in projections.
