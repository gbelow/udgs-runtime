# Debt checklist

Pattern breaches, repeated logic and technical debt found in the commits after
`17dbdbf` (body parts through Extend and Rest). Tick an item off when it is fixed;
delete the file once every box is ticked.

## Pattern breaches

- [ ] **Two payment paths.** `item/commands/hands.ts` `pay()` checks and debits
  `resources.AP` only; `character/commands/cost.ts` `payCost()` takes surge AP first
  through `spendAP`. They agree today only because `pay()` refuses whenever a surge
  binds. Armor pieces, the visor and draws go through `pay()`. Make one payer built on
  `canAfford` + `payCost`.
- [ ] **AP loss taken two ways.** `reduce.ts` `trampledBy` uses `payCost({ AP, STA: 0 })`;
  `deliver.ts` `takeOutcome` uses `spendAP`. Pick one.
- [ ] **Surge gate in six places, two meanings.** `getSurgeBar` (any surge left) in
  `pay()`, `useAbility` and the abilities lens; `getSurgeBarFor` (does this surge
  allow this kind) in `options.ts`; plus `getSurgeTurnBar` and `getFleeBarFor`. The
  `` `${surge} surge AP left` `` message is built in two files. Apply the gate once, and
  give abilities one `canUseAbility` rule read by both the command and the lens.
- [ ] **Spell-cast gates listed twice.** `canCastSpell` (`character/rules/spells.ts`)
  and `reasonAgainst` (`combat/rules/cast.ts`) walk the same gates. Keep the reason
  function and derive the boolean from it.
- [ ] **Hard-coded kind list in `advance`.** `sequence.ts` lands `drag | explosion |
  fleeFollowUp | spellTest` automatically. Move this to an `ACTIONS` flag so a new kind
  must declare it.
- [ ] **`getReactors` branches on the reaction kind.** `actionPanel.ts` fills one
  `strike` shape for opportunity attacks, counterattacks and joined shots with
  `declared.kind === …` checks and fake defaults (`mode: 'strike'`,
  `maneuver: 'immobilize'`). Make it a discriminated union or a per-kind builder.
- [ ] **Sustaining a spell lives in the reducer.** `reduce.ts` appends the held spell
  to `active` itself. Add a `holdSpell` command beside `linkTarget` /
  `unlinkTarget` / `loseConcentration`.
- [ ] **Four re-render gating idioms.** `useShallow` (`useTurnControls`), `perState`
  digest (`useSustainedPanel`), a hand-written digest (`useWoundLens`), and a digest
  built inside the hook (`useCombatSurgeOptions`, which also computes the options
  twice with no `perState`). Move the surge digest into its projection and settle on
  one idiom.
- [ ] **Option view types half migrated.** `ActionPanel.tsx` takes `ActionOptionView`,
  `HOPOptionView`, `SpellOptionView` from projections but `AttackOption`,
  `ImprovementOption`, `MovementOption` from `rules/`.

## Repeated logic to unify

- [ ] Clearing `surgeAP`: `endSurge`, `endTurn` (inline), `nextRound` → one helper.
- [ ] Next round's AP: `nextRound` and `canAffordRest` → `getNextRoundAP`.
- [ ] Extend DL `extend * EXTEND.DL`: `character/rules/spells.ts`, `combat/rules/attack.ts`,
  `projections/actionPanel.ts` → `getExtendDL`.
- [ ] Setting the turn fields (`inTurnCharacter`, `contenders`, `lastContest`,
  `turnStartedAt`): `startTurn`, `rollContest`, `endTurn`, `takeQueuedTurn`,
  `handOverToFleers` → one helper.
- [ ] "Read the active id, then dispatch" three times in `useCombatCommands.tsx`.
- [ ] Throwable items: `options.ts` and `actionPanel.ts` → `getThrowables`.
- [ ] Why a shot is unavailable (focus → ammo → weapon): twice in `options.ts`.
- [ ] "Can afford a strike or shot" via `canAfford(c, { AP: s.AP, STA: s.STA })` three
  times in `options.ts`; the `afford()` helper is used at only two of about eight
  "cannot afford" sites.
- [ ] Gate stacking in `getAvailableActions`: nested five deep for own actions, two
  for reactions; `closeIfImmobile` does not use `closeWith`. Make the gates a list.
- [ ] Building a container item: `getContainerItem` (`item/rules/containers.ts`) and
  `containerItems` (`item/rules/items.ts`).
- [ ] Where a slung quiver lives: `getSlungContainers` and the `sling` closure in
  `withContainer` (`item/commands/items.ts`).
- [ ] Gear predicate `isGear && (alt.not || fitsSpell)`: `hasSpellGear` and
  `getMissingGear`.
- [ ] Largest usable gear size + 1: `getAmplifyBounds` and `getCastSize`.
- [ ] Edits to a held spell in `active` (`e.kind === 'spell' && e.key === key`):
  `releaseSpell`, `linkTarget`, `unlinkTarget`, the reducer → `mapHeldSpell`.
- [ ] Parallel put-on views `WearView { wearable, why }` and
  `PutOnView { able, cost, why }`, rendered as near-identical buttons in `HandsPanel`
  and `ContainerPanel`.

## Technical debt

- [ ] `instructions/combat-map.md` points to `instructions/action-stack.md` and
  `instructions/reaction-openers.md`, which do not exist.
- [ ] `combat/commands/sequence.test.ts` restates table numbers as instances (the
  `{ AP: 3, STA: 1 }` and `{ AP: 2, STA: 1 }` costs, the riposte discounts, exact
  board cells). These fail the gate in `testing.md`; the ordering scenarios are fine.
- [ ] `command-purity.test.ts` fakes a base character with `as unknown as Character`;
  build one through `makeCharacter`.
- [ ] `hasRestMove` (`combat/rules/rest.ts`) finds the rest's move as any move spawned
  by the root; tag the move instead.
- [ ] `getCastSizeOf` (`combat/rules/cast.ts`) falls back to the raw `caster.size`
  field rather than `getSize`.
- [ ] Rest logic spread over `character/rules/rest.ts`, `combat/rules/rest.ts` and
  `canRestWhileCasting` / `getEffortlessCost` in `character/rules/spells.ts`.
- [ ] Surge code split across layers: options are a character lens and a combat
  projection; starting a surge is a combat command, ending one a character command
  outside the turn gate.
- [ ] `DamageButton` in `components/PlayPanel.tsx` is unused (the lint warning).
- [ ] `equipContainer` is still exported but only used inside its module.
- [ ] `spendAmmo` (`reduce.ts`) merges only `.containers` back from an updater's result.

## Suggested order

1. Unify payment and the surge gate.
2. Make gate reasons the single source, with booleans derived from them.
3. Add the auto-land catalog flag and a per-kind reactor builder.
4. Add the small helpers: `holdSpell`, a `surgeAP` clear, `getNextRoundAP`,
   `getExtendDL`, `getThrowables`.
