Grade: A−, and the unevenness has moved

┌─────────────────────────────────┬──────────┬──────────┐
│              Layer              │  Before  │   Now    │
├─────────────────────────────────┼──────────┼──────────┤
│ Domain (app/domain/**)          │  A / A+  │  A / A+  │
├─────────────────────────────────┼──────────┼──────────┤
│ Boundary enforcement            │    A     │    A+    │
├─────────────────────────────────┼──────────┼──────────┤
│ State + hooks (stores/, hooks/) │    B     │    A−    │
├─────────────────────────────────┼──────────┼──────────┤
│ Persistence / IO (actions.ts)   │    C+    │    B−    │
└─────────────────────────────────┴──────────┴──────────┘

6.8k lines across app/, of which 2.8k is domain and 1.6k components. 521 tests plus 4
documented `it.fails`, in 689ms. `pnpm lint` and `tsc --noEmit` are clean.

What earns the high marks

The thesis is still implemented, not just documented. A scan of app/components/*.tsx for
arithmetic on domain numbers returns nothing outside the exempt BreakMe.tsx, across 1.6k
lines of JSX. The dice buttons still go through makeDieRoll in components/utils.tsx, which
wraps the domain's rollDie with Math.random as the injected entropy seam.

The boundary is mechanical, and it has grown a third rule. Beyond "domain may not import
stores/React/actions" and "components may not import lenses or commands", components are now
also barred from app/stores and from domain/tables.ts, with the inert name lists split out
into domain/lists.ts. That split is the interesting part: the rule is that a constant which
gains a number moves from lists.ts to tables.ts and thereby becomes unreachable from JSX, so
the boundary tightens by itself as the data grows rather than needing to be re-argued per
feature. Each rule's message names the regression that motivated it.

Three design ideas are genuinely strong:

- The terms pattern (skills.ts, terms.ts): every derived value is sumTerms(getXTerms(c)), so
  the tooltip breakdown and the number it explains are the same computation. The registries
  skillTermGetters / characteristicTermGetters mean a new skill inherits the breakdown by
  being registered, not by being remembered.
- Lens inversion over the registry (lens-inversion.test.ts): it.each over
  Object.keys(skillLenses), so set→get round-tripping is proven for every lens and any new
  lens inherits the check. A property over the architecture, not a mirror of the
  implementation.
- command-purity.test.ts, new since the last review, is the best test in the repo. It
  deep-freezes a fully-populated subject, runs every exported command against it, and then
  runs a completeness check keyed by export name: a command added to any of the three command
  modules fails the suite until it is given a subject. Nothing about it restates a rule, and
  it covers code that has not been written yet.

Rule provenance is traceable and now has a ledger. Inline citations (// combat.tex "Rest",
// gear.tex "Containers and burden") sit beside the constants they justify, and
instructions/migrationNotes.md records every gear.tex row that could *not* be represented and
every interpretation made while importing. That is the right response to "report the
divergence, don't silently pick one" — the disagreements are written down instead of resolved
in secret.

What has been fixed since the last review

1. The hand-argued freshness invariants are gone. useInjuryLens and useKnowledgeLens now read
   through useActiveCharacterSelector, so the value that schedules a render is the value that
   gets displayed. readActiveCharacter survives in exactly three shapes, all sound: inside
   useActiveCharacterDerived, where a digest of the computed output gates the render; in event
   handlers (useGameCommands, useCombatCommands, useWeaponLens.attack), where a click
   legitimately wants state as of the click; and as the same digest-then-read pair written out
   by hand in useCombatRoster. Its doc comment now states the constraint under which a bare
   call is sound rather than asserting a conclusion.
2. Ingestion is tighter where it was loosest. weapons and containers ingest through
   WeaponSchema / ContainerSchema instead of z.any(), and mergeTrainables merges per field with
   `type` re-authored by the schema group, so an ingested trainable supplies a value and not an
   identity — a partial entry no longer drops the fields it doesn't mention.
3. actions.ts is no longer the weak point. Every action returns ActionResult<T>, a
   discriminated union the callers surface as toasts, so failures reach the user instead of the
   console. resolveBaseCharacterFile rejects a traversing name rather than rewriting it, keeping
   the name in the file and the name on disk the same string. The character index is a Redis
   hash written with single atomic field ops, so concurrent saves can't clobber each other, and
   the legacy array key folds in on first read and retires itself.

What still pulls it down

1. Ingest field-set drift, and it is already real. CharacterIngestValues in factories.ts is a
   hand-maintained parallel copy of CharacterValues in types.ts, with nothing tying the two
   together, and it has fallen behind: `senses`, `abilities` and (on the campaign side)
   `activeEffects` exist on Character but are absent from the ingest schemas, so they are
   silently dropped on every load. Verified — makeCharacter({ abilities: ['Archer'] }).abilities
   is []; the same holds for makeCampaignCharacter, for senses, and for activeEffects.
   Containers survive; abilities do not. senses is the sharper case, because senseLenses is
   fully registered in lenses/index.ts: the domain models the field, the UI can edit it, and the
   save throws it away.
2. The persistence read is a type assertion. getCharacter annotates `redis.get(id)` as Character
   with nothing checking it. Nothing downstream is actually unsafe — both stores re-ingest
   through makeCharacter / makeCampaignCharacter, so the real parse boundary is held — but the
   action's declared type is a claim the action does not make good on, and it is the one place
   in the codebase where a shape is asserted rather than parsed.
3. Testing still stops at the domain's edge. 521 tests in 689ms remains the proof that the
   domain stayed pure, and the two registry-driven suites are excellent. There is still nothing
   over hooks/stores and nothing over actions.ts, and testing.md's "Undecided" section still
   holds no rule admitting integration tests. Worth noting, though, that the drift in (1) is not
   an integration-test-shaped hole: a character round-tripping through the representation it is
   stored in — object → JSON → makeCharacter → object — is a serialization boundary, which
   category 2 already admits, and it names no game number.
4. Surface consistency — naming, file extensions, quote and semicolon style. None of it affects the
   grade, but it is what outside readers notice first; collected in the "On tidiness" section below.

The commented-out lens entries, the staged-out getRES/getINS formulas and the currently inert
effects.ts are not counted against the grade — that structure is how features are staged in and
out.

═══════════════════════════════════════════════════════════════════════════════

Readiness for the next imports

┌─────────────────────────────────────────┬─────────────────────────────────────┐
│ Items and containers (gear.tex 7.5–7.7) │ Ready — gaps are additive           │
├─────────────────────────────────────────┼─────────────────────────────────────┤
│ Abilities (abilities.tex)               │ Sketch stage — four decisions and   │
│                                         │ one mechanism stand before import   │
├─────────────────────────────────────────┼─────────────────────────────────────┤
│ Spells (spells.tex)                     │ Not started — no shape drawn yet    │
└─────────────────────────────────────────┴─────────────────────────────────────┘

Items and containers

In place: ItemSchema / ContainerSchema / ContainerKindSchema in types.ts; a whole
app/domain/item/ subtree with the slot ladder (5^(slotBulk − itemBulk)), getUsedSlots,
canFitItem, getContainerPenalty with its liftThreshold exception, getBurdenPenalty and
getBurdenLevel; containers.json already carrying all six rows of gear.tex's Containers table.
The burden rule already reaches the rest of the domain — getBurdenPenalty feeds gear.ts, and an
"over" burden adds `lame` in afflictions.ts. Containers survive ingestion, and all five item
commands are covered by the purity registry.

Missing, in the order it will be felt:

a. No items catalog. weapons.json, armors.json and containers.json exist; items.json does not,
   and getItemWeapon / getItemArmor resolve refId against weapons and armors only. The Utility
   and Survival list (Bedroll, Rope, Canteen, Pot) has nothing to resolve into, so those rows
   would import as name + description with no stats behind them.
b. ItemSchema has no `charges`. The .tex bullets are full of them — "10 charges" on bandages,
   "5 charges" on poultices, "20 charges" on an Electrite. `amount` is the stack count, which is
   a different quantity: a roll of bandages is one item with ten uses, not ten items, and the
   two behave differently in the slot ladder.
c. Most of 7.6 and 7.7 is an effect, not a stat: "reduces cold exposure by 2", "+2 stealth
   against hearing", "+3 to Stealth vs vision outside combat, −3 in plain sight". BuffSchema
   fits these — but nothing consumes a Buff yet (see below). Importing the stat-only rows lands
   cleanly today; importing the effect-bearing rows leaves them as inert text until the buff
   pipeline exists.
d. addItemToContainer throws on a full container or a missing key. Every other updater in the
   domain returns the subject unchanged on a no-op — removeItemFromContainer and
   unequipContainer both do. A throwing updater inside a Zustand set() takes the render down, so
   either the hook catches it or the command returns the character and a lens reports "won't
   fit" to the UI. This is a design decision, not a typo, and it is cheaper to settle before a
   panel calls it.
e. No hook, no component. Items and containers are entirely domain-side right now.
   getWeaponPanels / getWeaponPanelsDigest in gear.ts, consumed through useActiveCharacterDerived,
   is the pattern to copy exactly.
f. Bulk is a bare number 0–3 with the ladder in a comment; the book names the tiers small /
   medium / large / cargo. Those labels are inert, so lists.ts is their home.

Verdict: go. The rule layer is done and correct, ingestion already carries containers, and every
gap is additive — a catalog file, one field, one hook, one panel. Only (d) needs a decision
rather than typing.

Abilities

Abilities are at the sketch stage: the shape of the data is drawn, nothing is wired up yet.
AbilitySchema, EffectSchema (a discriminated union of cost / buff / suppression / flash),
CostSchema, BuffSchema, SuppressionSchema, TriggerSchema, ActivationSchema and TalentSchema all
exist in types.ts; `abilities: string[]` sits on every character and `activeEffects: Effect[]` on
campaign characters; effects.ts drafts collectBuffs / groupBuffsByTarget / getBuffsForTarget
against them. None of it has a consumer, which is the expected state for a shape drawn before its
implementation — it is not a defect list.

What the sketch has not decided yet, in the order the import will force each one:

1. Where a buff enters a calculation. Every term getter in skills.ts and characteristics.ts is a
   hardcoded array with no ability term in it, so there is currently no junction between a Buff
   and a derived value. This is the one piece of machinery the feature rests on, and it is the
   piece that is genuinely absent rather than merely undecided. The terms pattern makes the shape
   obvious — a buff term appended inside each getXTerms, so the tooltip explains an ability the
   same way it explains an affliction — but it touches every getter, and it collides with (2).
2. `operation: '*' | 'set'` does not survive the Term model. A Term is a label and an additive
   value, and sumTerms adds. More seriously, makeInvertingSetter computes
   `modifiers = getter(c) − readBase(c)` and writes back `value − modifiers`, which inverts
   correctly only while the base term sits at a +1 coefficient — the same invariant CLAUDE.md
   states for getTGH. A multiplicative or overriding buff on a skill breaks that inversion. The
   good news is that lens-inversion.test.ts would catch it the moment it happens; the consequence
   is that the operation set has to be decided before the catalog is extracted, not after.
3. No catalog, and no ingest path. There is no abilities.json, and `abilities` is dropped by
   CharacterIngestValues — so a learned ability does not survive a save/load, and neither does an
   activeEffect. This is finding (1) from the section above, and abilities is where it bites
   hardest: the feature is unusable until the ingest schema covers the field.
4. The .tex shape does not fit AbilitySchema yet. The macro is
   \abil{Name}{activation}{XP, talent requirement}{prerequisites}{description} — five fields.
   AbilitySchema has no prerequisites field ("Archer, Riding I" has nowhere to go), and the
   I/II/III level mechanic that runs through the entire chapter has no representation at all:
   "Sprinter I/II" is one entry with two tiers, "increases running speed by 1/2m" is one effect
   with two values, "CON 3/5" is one requirement with two thresholds, and `abilities: string[]`
   carries a name with no rank. TalentSchema's `level` is the requirement's level, not the
   ability's own tier. Whether "Sprinter II" is a distinct catalog entry or a rank on one entry
   changes the shape of every row in the chapter, so it is the first decision to make.
5. `Buff.target` is an unchecked string while the lens registries are keyed by `keyof Skills` and
   `keyof Characteristics`. A typo in a catalog entry silently buffs nothing. Per the testing
   conventions, prefer making the bug unrepresentable: typing the target against the registry keys
   costs nothing to maintain and removes the class.

Verdict: the shape is fine as far as it goes; four of these are decisions (ability levels,
prerequisites, buff operations, target typing) and only the buff→term junction is code that has to
be written. Items first is the right order regardless — it exercises the catalog → ingest → hook →
panel path end to end without touching the terms pipeline or lens inversion, so the abilities work
starts from a path that has already been walked once.

Spells

Furthest out, and nothing is drawn yet. spells.tex is a per-school list with casting costs and
modifications, and no part of that has a shape in types.ts. The read side is partly there —
magic.ts computes alchemy/animancy/biomancy/divine/miracle as sorcery plus a knowledge, and
magicGetters is registered — but the school entries are commented out of the lens registry, and
the sorcery/conviction proficiencies, while present in ProficienciesSchema, are not staged in.
Spells also inherit every decision on the abilities list, since a spell's effects are the same
Effect union. Sequence it after abilities, not in parallel.

═══════════════════════════════════════════════════════════════════════════════

On tidiness

Reviewers reach for "untidy" about this codebase, and it is worth separating what they are
actually seeing from what the architecture does. None of the following touches the layering, the
purity of the domain, or the correctness of a rule — they are surface-consistency findings, which
are simply the cheapest thing for a scanner to detect. Listed roughly by how much they cost:

1. FIXED. useCharacterCommands.tsx imported `updateIL as heal` and `updateSTA as bleed` while the
   domain also exported real `heal` and `bleed` doing different things (`heal(amount)` applies a
   delta, `updateIL(newIL)` sets an absolute), then renamed once more on the way out to `cureIL`.
   One function carried three names and two names each denoted two functions depending on the
   file, so grep could not answer "where is heal used". The aliases now use the file's existing
   `do` prefix (`doUpdateIL` / `doUpdateSTA`), which shadows nothing and still contains the real
   name, and the hook exports `updateIL` — one name per function from command to component.
2. Hook filenames don't describe their contents. useCharacterData.tsx holds name/notes/fightName,
   surges, STA regen and surge options — four concerns in a file called "data", against CLAUDE.md's
   "one per concern". Its export is useActiveCharacterData, so filename and export disagree on the
   prefix, and useCharacterDataLens.tsx / useActiveCharacterDataLens repeats the mismatch.
3. All twenty files in app/hooks are .tsx and none of them contains JSX. useinjuryLens.tsx is
   additionally lowercase while exporting useInjuryLens.
4. Typos. CampainCharacterIngestSchema is FIXED — renamed to CampaignCharacterIngestSchema across
   its three sites. Still open: `Providencialism` in lists.ts and "actie"/"actionSUrge" in info.ts,
   both of which reach the screen.
5. tables.ts carries five naming conventions in one file: SkillPenaltyTable, SMArr, dmgArr,
   injuryMap, AFFLICTIONS/SURGES, magic_types.
6. Semicolons and quote style split along layer lines — the domain mostly omits semicolons and
   prefers single quotes, hooks/stores/components use semicolons and double quotes — and two files
   mix both inside their own import block. grouping.ts is the only module using JSDoc blocks.
7. Duplicate basenames doing unrelated jobs: two factories.ts (lens factories vs character
   ingestion), two types.ts, two knowledge.ts. Plus misc.ts and helpers.ts side by side in lenses/
   with no rule saying which catch-all catches what.

What a scanner will also flag, wrongly: the commented-out lens entries, the staged-out getRES/getINS
formulas, and effects.ts sitting with no consumer. Those are the staging mechanism, not clutter.

Bottom line

The architecture has closed the two specific holes the last review named: the state layer's
freshness now rests on the useActiveCharacterDerived digest rather than on comments, and the IO
layer has real error propagation, a real path guard and atomic index writes. What is left below
the A line is one structural weakness — the ingest schema being a hand-maintained copy of the
character schema, with three fields already lost to the drift — and the fact that neither the hook
layer nor actions.ts is tested at all.

That drift is also the single thing most worth fixing before the next import. Items can proceed
around it; abilities cannot, because `abilities` is one of the fields it drops.
