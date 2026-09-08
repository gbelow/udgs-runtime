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