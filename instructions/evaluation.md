Grade: B+

Broken down: domain layer A−, integration/hooks B+, UI layer C+, combat sub-domain C.

This is meaningfully better than typical React app architecture, and it's better because of one specific decision, not general tidiness.

What earns the grade

The Term pattern is the standout. getStrikeTerms returns labelled contributions and getStrike is just sumTerms of them (app/domain/character/lenses/skills.ts:11-19). One definition drives both the computed value and the tooltip breakdown — the usual version of this feature is a formula plus a hand-written explanation string that drifts apart within a month. It doesn't exist here.

Zero useEffect in the entire codebase. That's not a style flourish; it means no derived state is being synced imperatively, which is where most React apps' invariants actually die. Everything derived is a pure getter over the character.

The re-render design is deliberate and correctly reasoned. useActiveCharacterSelector computes derived is a pure getter over the character.

The re-render design is deliberate and correctly reasoned. useActiveCharacterSelector computes the lens inside the Zustand selector so renders gate on the derived output, not the character reference (app/hooks/useActiveCharacterSelector.tsx:11-33). The comment about why useShallow fails for freshly-allocated term arrays is the kind of thing people usually learn by shipping a bug.

Ingestion is a real boundary. All parsing collapses into factories.ts; consumers get a fully-defaulted Character or nothing. tsc --noEmit clean, 121 tests in 604ms — the speed is itself a proof the domain is pure.

What holds it back

1. The dependency arrow is inverted in combat. domain/combat/commands/{nextRound,resetCombat,startTurn}.ts all import CombatStore from @/app/stores/useCombatStore. The domain is importing its shape from the state layer — precisely backwards, and the one rule the README says is non-negotiable. Type-only today, but it means combat state is defined by Zustand rather than the domain. The character domain is clean; combat never got the same treatment.

2. Rules have leaked into JSX in three places — and one is duplicated:
- components/ArmorPanel.tsx:44-59 — the armor tier table (TGH*2 + protection, *3, *4) is a rules table living in markup.
- components/CharacterCreator.tsx:114 — Math.floor(STA / 4) STA regen.
- components/WeaponPanel.tsx:19 — Math.floor(value + mod*STR), which is the same STR-mod damage formula already implemented at domain/character/commands/weaponAttack.ts:26. Two copies of one rule is the failure mode the architecture exists to prevent.

3. Test coverage is aimed at the wrong risk. The 121 tests concentrate on containers, ingestion, size tables, and lens round-trips. But skills.ts is 265 lines of ~19 rulebook formulas, and no test asserts any of them directly — getReflex's awareness + ranged - 3*hasHelm - SM is only exercised incidentally through inversion round-trips, which pass regardless of whether the formula matches the rulebook. Same for getAttacksList, which parses weapon properties by comma-splitting and string-matching literals like "heavy I-III" (weaponAttack.ts:20) — brittle, stringly-typed, zero tests. The best-tested code is the code least likely to be wrong.

4. A live bug the type system can't see. scaleArmor (lenses/helpers.ts:32-37) returns keys prot and cover, but Armor declares protection and deflection. Because it's a spread assigned through an inferred const, excess-property checking never fires. Net effect: equipArmor scales RES and INS but silently leaves protection and deflection at size-1 values.

5. The UI layer got the least care. app/components.tsx (345 lines) sitting next to app/components/ is unresolved refactoring debt, and four files exceed 300 lines. Domain is 2196 lines against 1620 in components — a healthy ratio in principle, but the component side is where the discipline stops.

The honest summary

The thesis — pure domain owns all rules, React only renders — is genuinely implemented, not aspirational, which puts it well ahead of most projects that claim it. It loses points where the thesis was applied unevenly: combat got the inversion backwards, the UI accumulated four rule leaks including one true duplicate, and the test suite validates the mechanical properties (purity, invertibility) while leaving rulebook fidelity — the thing that's actually hard and actually matters — unverified.

The three highest-value fixes, in order: pull the WeaponPanel damage duplicate back into the domain, define combat state in domain/combat/ and have the store import it, and write per-skill formula tests citing creating.tex.



Grade: A−, but uneven by layer

┌─────────────────────────────────┬────────┐
│              Layer              │ Grade  │
├─────────────────────────────────┼────────┤
│ Domain (app/domain/**)          │ A / A+ │
├─────────────────────────────────┼────────┤
│ Boundary enforcement            │ A      │
├─────────────────────────────────┼────────┤
│ State + hooks (stores/, hooks/) │ B      │
├─────────────────────────────────┼────────┤
│ Persistence / IO (actions.ts)   │ C+     │
└─────────────────────────────────┴────────┘

What earns the high marks

The thesis is actually implemented, not just documented. The claim "pure domain owns the rules, React only renders" survives contact with the code. My scan of app/components/*.tsx for arithmetic on domain numbers found essentially nothing outside the exempt BreakMe.tsx — the only leak is the raw d10/d6 buttons in PlayPanel.tsx:67,71, which inline Math.floor(Math.random()*10)+1 while the domain already owns rollFull with an injected entropy seam (domain/combat/dice.ts, wrapped at components/utils.tsx:5). That is a remarkably clean record for a 6.6k-line app.

The boundary is mechanical. The two no-restricted-imports rules in eslint.config.mjs make the layering a build failure rather than a convention, and the comments name the actual regressions that motivated them ("which is how the armor tier table, the STA regen formula and the weapon STR-mod duplicate all got into JSX"). Rules justified by observed decay are worth more than rules justified by principle.

Two design ideas are genuinely strong, not just tidy:

- The terms pattern (skills.ts, terms.ts): every derived value is sumTerms(getXTerms(c)), so the tooltip breakdown and the number it explains are the same computation. Drift between a displayed explanation and a displayed value is structurally impossible, not merely tested.
- Lens inversion tested over the registry (lens-inversion.test.ts): it.each iterates Object.keys(skillLenses), so set→get round-tripping is proven for every lens and any new lens inherits the check automatically. That's a property over the architecture, not a mirror of the implementation.

Rule provenance is traceable. Inline citations (// combat.tex "Rest", // gear.tex "Heavy I/II/III") plus co-location of constant and getter (REST_AP_COST next to getSTARegen) mean the displayed number and the applied number can't diverge, and a reader can check either against the rulebook.

What pulls it down

1. An unfinished migration left two APIs for one job. useActiveCharacter (whole-character subscription) and useActiveCharacterSelector/useActiveCharacterUpdate (fine-grained, re-render-gated) both exist and are both used. The second was clearly built to fix the first's re-render cost; the first is still exported and live. This is the classic shape that decays.

2. readActiveCharacter is the real crack in the thesis. useActiveCharacterSelector.tsx:38 reads useCharacterStore.getState() non-reactively, and useSkillLens calls it every render to build tooltip terms. Its correctness rests on a comment — "gating the component's re-render on value above keeps this fresh" — which holds only while no input can change a term without changing the sum. Term labels, sign flips, and offsetting modifiers all break that. The project's whole pitch is eliminating silent state divergence, and this is a hand-argued invariant with no test guarding it.

3. The store is slightly more authoritative than advertised. useCombatStore.loadCharacter embeds identity/keying logic inline, and getActiveCharacter lives inside state as a method — so useActiveCharacter's s => s.getActiveCharacter() selector produces a fresh call on every store change. Small, but it's rules-adjacent logic sitting in the layer that's supposed to hold none.

4. Persistence is the weak layer, and it has a live bug. CharacterCreator.tsx:64 calls deleteCharacter(character.name), but actions.ts:113 expects a Redis id — so that button toasts "Character deleted." and deletes nothing. CharacterSelector.tsx:115 passes the id correctly, so the two call sites disagree about the contract. Beyond that: upsertBaseCharacter builds a path from unsanitized character.name (a name containing ../ escapes the target directory), uses synchronous fs inside a server action, and maintains the Redis charList index by non-atomic read-modify-write. The ActionResult discriminated union is good discipline; everything underneath it is not at the standard of the domain.

5. Ingestion validates less than the domain claims to. The ingest schemas lean on z.any() for trainables, injuries, resources, and afflictions, and addBaseValues spreads ...parsedCharacter over the defaults. Lossy-by-design is a defensible choice, but "the domain is the authoritative interpreter" is weaker than stated when the interpreter doesn't type-check its own input at the nested level.

6. Testing is thickest where risk is thinnest. 230 fast tests over pure functions — excellent. Zero over the hooks/store integration (where the tearing concern above lives) and zero over actions.ts (where the actual bug lives).

Minor: getSM/getDM throw on out-of-range size, but getSize clamps to [1,7] first, so those throws are unreachable dead code sitting in a path that runs on every store change for every subscriber. Cosmetics: unused imports (size from zod in factories.ts:1, knowledgesLens), useinjuryLens.tsx casing, .tsx on JSX-free hooks. I'm not counting the commented-out lens entries and staged-out formulas against the grade, since that inert structure is how you stage features in and out.

Bottom line

The domain layer is the work of someone who understood the problem before writing code — it would grade well in a senior review at most shops, and the terms/inversion pair is the kind of idea worth reusing elsewhere. The grade is held below an A by the fact that architectural rigor stops at the domain's edge: the state layer carries an abandoned first attempt alongside its replacement, and the IO layer has no rigor at all. The stated thesis is about the domain, so this is arguably scoped-as-intended — but a reviewer evaluating "the architecture" will read actions.ts too.

Cheapest high-value fixes, in order: the deleteCharacter id/name mismatch, path sanitization on upsertBaseCharacter, then deleting useActiveCharacter in favor of the selector pair.