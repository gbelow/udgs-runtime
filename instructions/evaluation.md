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

The thesis is actually implemented, not just documented. The claim "pure domain owns the rules, React only renders" survives contact with the code. My scan of app/components/*.tsx for arithmetic on domain numbers found essentially nothing outside the exempt BreakMe.tsx; the dice buttons in PlayPanel.tsx go through makeDieRoll, which wraps the domain's rollDie at components/utils.tsx with Math.random as the injected entropy seam. That is a remarkably clean record for a 5.4k-line app.

The boundary is mechanical. The two no-restricted-imports rules in eslint.config.mjs make the layering a build failure rather than a convention, and the comments name the actual regressions that motivated them ("which is how the armor tier table, the STA regen formula and the weapon STR-mod duplicate all got into JSX"). Rules justified by observed decay are worth more than rules justified by principle.

Two design ideas are genuinely strong, not just tidy:

- The terms pattern (skills.ts, terms.ts): every derived value is sumTerms(getXTerms(c)), so the tooltip breakdown and the number it explains are the same computation. Drift between a displayed explanation and a displayed value is structurally impossible, not merely tested.
- Lens inversion tested over the registry (lens-inversion.test.ts): it.each iterates Object.keys(skillLenses), so set→get round-tripping is proven for every lens and any new lens inherits the check automatically. That's a property over the architecture, not a mirror of the implementation.

Rule provenance is traceable. Inline citations (// combat.tex "Rest", // gear.tex "Heavy I/II/III") plus co-location of constant and getter (REST_AP_COST next to getSTARegen) mean the displayed number and the applied number can't diverge, and a reader can check either against the rulebook.

What pulls it down

1. readActiveCharacter is still the thinnest part of the thesis. useActiveCharacterDerived now gates a freshly-allocated shape on a digest of itself, which is the right structural answer and removes the hand-argued invariant from the term-breakdown path. But useinjuryLens and useKnowledgeLens still call readActiveCharacter bare on the render path, with correctness resting on a comment — "the injuries selector above already gates re-renders, so a non-reactive read stays fresh" — that holds only while no input can change the read value without changing the selected one. The project's whole pitch is eliminating silent state divergence; these two are the remaining places where that rests on an argument rather than on a mechanism.

2. Ingestion validates less than the domain claims to. The ingest schemas in factories.ts lean on z.any() for trainables, knowledges, injuries, resources and afflictions, and addBaseValues spreads ...parsedCharacter over the defaults. Lossy-by-design is a defensible choice, but "the domain is the authoritative interpreter" is weaker than stated when the interpreter doesn't type-check its own input at the nested level.

3. Testing is thickest where risk is thinnest. 521 fast tests over pure functions — excellent, and the suite still runs in ~640ms, which is itself the proof that the domain stayed pure. Zero over the hooks/store integration, where the non-reactive read above lives, and zero over actions.ts.

Cosmetics: useinjuryLens.tsx casing, .tsx on JSX-free hooks. I'm not counting the commented-out lens entries and staged-out formulas against the grade, since that inert structure is how you stage features in and out.

Bottom line

The domain layer is the work of someone who understood the problem before writing code — it would grade well in a senior review at most shops, and the terms/inversion pair is the kind of idea worth reusing elsewhere. The grade is held below an A by the fact that architectural rigor thins out past the domain's edge: the state layer carries two hand-argued freshness invariants, and the IO layer, though its bugs are now fixed, has none of the domain's structural discipline. The stated thesis is about the domain, so this is arguably scoped-as-intended — but a reviewer evaluating "the architecture" will read actions.ts too.
