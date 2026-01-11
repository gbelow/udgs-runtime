


## 0) Current Goal (edit this first)

**Goal:** Maintain and extend a FallowRPG character creation + play runner tool, while preserving the repo’s core architectural thesis:

> **React is an integration layer; authoritative rules live in a deterministic domain layer.**

**Right now I want help with:**

- [ ] (fill in) e.g. “Add affliction UI + ensure penalties propagate deterministically”
- [ ] (fill in) e.g. “Fix incorrect derived wound thresholds (RES/TGH/INS) when STR changes”

**Definition of done (examples):**
- Domain logic updated in `app/domain/**` (selectors/commands/factories) rather than scattered in components
- TypeScript strict passes; existing UI still works
- No direct mutation of derived values in UI


working on adding conviction identity to the game (add ferocity conviction, adaptation conviction... etc)