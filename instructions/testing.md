# Testing culture

This file is a filter. Every test in this repo must pass the gate below; a test that
cannot be defended by one of the admitted categories does not get written, and an
existing one that fails the gate gets deleted rather than maintained.

## The gate

Ask of any proposed test: **where does the expected value come from?**

- If it comes from the code under test, reject it. It is a change-detector: it fails on
  every intentional edit and passes on every transcription error, so it costs edits and
  buys nothing.
- If it comes from an origin independent of the implementation — an invariant, a contract,
  a fixed point, or an observed failure — admit it under one of the three categories below.

There is no external numeric oracle for game rules in this project. The rulebook is
authoritative for *rules* (formulas, tables, terminology) but not for *worked output*: its
bestiary statblocks are stale, and this app is intended to generate them, so testing the
generator against them would pin the thing it is meant to replace. When rule fidelity is
the worry, the answer is representation, not tests — extract scattered literals into a
table in `domain/tables.ts` shaped like the book's table and cite the `.tex` beside it, so
the constants can be diffed against the book by eye.

## Admitted categories

### 1. Invariants, never instances

Test the property that holds across a whole family of values, not the members of the family
one at a time. An invariant is admissible because its expected value is the property itself
rather than any computed result: round-tripping, agreement between two paths to the same
answer, completeness of a mapping, or a relationship that must survive any input.

Express it as a loop over whatever declares the family, so that a member added later inherits
the check without anyone remembering to write a test. This is the highest-value category and
the one to reach for first: it is the only kind of test that covers code not yet written.

An invariant is admissible only if somebody authored it. Ask **who decided this had to be
true?** A legitimate answer names the rulebook, an architectural promise the project makes
elsewhere, or a stated convention. A property that was read off the implementation has no
author: nobody decided it, it is only what the code currently does, so its expected value
originates in the code under test and the gate rejects it however it is phrased. Naming it
after an algebraic law does not give it an author, and neither does looping it over a
registry — that restates the same code once per member.

### 2. Shape and contract

Assert what must be true of the *form* of a value crossing a boundary, never its content.
Because such a test names no game number, it cannot restate a rule. The properties worth
asserting at a boundary are that it is total (every input, including hostile ones, yields
something valid or nothing at all), that it is idempotent (applying it twice changes nothing
further), that it round-trips through the representations it is stored and transmitted in,
and that everything it claims to accept actually conforms to its declared schema.

These are the tests that catch structural mistakes the type system cannot see — mismatches
hidden behind inference, widening, or serialization.

The boundary is the whole justification for this category, not incidental phrasing. It
admits a test only where a value genuinely changes representation: parsed from an untyped
source, serialized to storage or the wire, or handed across a layer that cannot see the
type. Between two points inside a pure, statically typed layer nothing crosses, the compiler
already holds the form, and the same assertions become observations wearing a contract's
vocabulary. Wanting the property for a downstream consumer's benefit does not relocate the
boundary either — the claim belongs to the layer that actually depends on it.

### 3. Regression tests

A test written *from* a bug, after it is found. Its expected value is the observed correct
behaviour in that one scenario, so it is not a mirror test even when it looks like one. Its
job is to pin a case that empirically broke, not to describe a rule. Comment it with what
broke, not with what it checks, and keep it even when it looks redundant.

## Rejected

- **Mirror tests.** An assertion whose expected side is the implementation retyped. Rules are
  already transcribed from the rulebook once; a second copy means changing two places per
  rules change, and it passes on exactly the transcription errors it appears to guard against.
- **Golden outputs.** Snapshotting a derived output and checking it in looks like it guards
  rule fidelity, but the snapshot is regenerated from the code, so it fires when the code
  changes and stays silent when the rulebook changes — the direction that actually needs
  guarding. Edit a rule in the book and the suite stays green while the code contradicts it;
  fix the code afterwards and the snapshot finally fails, presenting a diff that only
  confirms a change just made on purpose. Where the derived output would genuinely be worth
  reading against the book, generate it as an artifact rather than asserting on it, and put
  the effort into a checker that parses the source of truth.
- **Properties read off the implementation.** An assertion that a function is idempotent, an
  involution, additive, monotonic or bounded, when that property follows from the arithmetic
  or the language semantics of the code as written. It is true, and it is a mirror test: it
  fires on every deliberate change and stays silent on every wrong one. The tell is that the
  property can be derived by reading the function and could not have been predicted without
  it.
- **Tests of what a type already guarantees.** Before writing a test that a registry is
  complete, a set of keys agrees with another, or a value has the declared shape, check
  whether an annotation already makes the failure impossible to compile. Where one does, the
  test is dead weight from the day it is written; where none does, prefer adding the
  annotation to adding the test.
- **Component tests and snapshots of rendered markup.** Components hold no rules; there is
  nothing there to verify that the domain tests do not already cover.
- **Anything that needs a mock.** If a test needs mocking, it is testing the wrong layer —
  move the logic into the domain and test it there. Zustand stores are real objects and do
  not count as mocks.
- **Tests over rulebook worked output** (bestiary statblocks, printed example characters).
- **Coverage-driven tests.** Coverage is not a goal; the categories above are.

## Integration

One seam has so far demanded an integration test: what a player does on the board, from the
click to what stands afterwards. It is admitted, under these terms.

- **What runs.** The real combat store, with the click resolved by the domain's own
  `resolveClick` and every panel button dispatched as the command its hook dispatches. Nothing
  is mocked, and no DOM is rendered: `onClick={...}` is the one line left unexercised, and it
  holds no decision. The harness lives in `app/stores/`, beside the store it drives, because
  the domain may not import stores.
- **Where the expected value comes from.** From what the clicks asked for, never from a rule's
  output: the character stands where the cell was clicked, a refused click changes nothing,
  painting touches only the clicked cell. A scenario that needs a game number (a cost, a
  degree, a damage) is a rules test and belongs in the domain.
- **Invariants over the view.** The view says what a click would mean, and the click must
  agree: loop over the cells or tokens the view offers and check that acting on each does what
  the view promised, and that acting on any other leaves the state alone. The author of that
  property is the architecture (the view is what the board is drawn from), not the code.
  It checks that two paths agree, not that either is right.
- **A fuzzer for breadth.** `board.fuzz.test.ts` presses everything there is to press, in
  seeded random order: every click, every panel command, terrain painted by brush, the
  board's light switched. After each
  press it asserts what the architecture promises of any session and nothing about a rule's
  output: nothing throws, the state is one the schema accepts and storage round-trips, the
  active and in-turn characters are in the fight, no two footprints share a cell, the board
  draws every placed character, every link an action in the log holds names an action in the
  log or the journal, and a click on a board the view calls locked changes nothing.
  Two more checks run over the panel's own promises: every option `getAvailableActions` shows open can be
  declared and does something, and every one it shows closed is refused with the state left as it was; and
  after an exchange has been played out, nothing is left committed and waiting, once an answer still being
  declared has been taken back.
  A failure names its seed, step and the plays before it; pin what it found as a scenario.
  Some plays answer the open declaration from the panel's own offers (a row, a shot's ammo,
  a spell, a potion, a target clicked, a landing clicked) so that an action gets as far as being rolled.
  Two more kinds of session play exchanges: a duel of two characters (brawlers, archers, archers across a pane of glass that breaks, a
  spearman, a trained warden with spear and shield, one with a body shield, a mage, a bomber with a potion, a netter, a brawler whose three cells bend behind its head) and a crowd of
  seven on ground with a pond and a cliff painted on it, once in the open and once with walls,
  glass, fog, dim and dark ground between them, a torch in one hand and the warden's
  shield a body shield, so that some begin out of the others' sight and stealth has someone to hide. In an exchange one declares something
  leaning to a grapple, a push, a shot, a throw or a spell, the others are answered with whatever
  defences are offered, and the roll runs on to its end, aiming what it opens. A walk, swim, climb
  or jump is its own play, and so is an ambush: someone prepares a reaction and someone else is sent
  walking at them, and a rescue: a shielded character prepares a defense of whoever is attacked and
  someone attacks. Where someone holds a body shield, a shelter is played too: they are shot at and
  guard taking cover behind it, so that the shots after have a covered character to meet.
  `FUZZ_SEEDS=n` runs n seeds of every session instead of the few that keep the suite quick.
  `FUZZ_REPORT=1` writes `reports/fuzz-coverage.md`, a table of every action in the catalogue and
  how far the sessions took it, as an artifact to read, never asserted on.
  What it reaches is bounded by the fixtures: a command no fixture character can declare is
  not exercised, so give the fixtures the gear and the abilities the commands need.
- **Terrain is painted by clicking.** Scenes are built with the same brushes a player holds,
  so painting is covered and no fixture invents a board the UI could not make.
- **The harness is the contract.** A new button or click goes into the harness as the command
  its hook dispatches. If a hook decides anything beyond which command to dispatch, move the
  decision into the domain first and have the harness call that.
- **Other seams stay undecided.** Panels, persistence and the VTT link are not covered by this
  rule; decide each against the first case that demands it.

## Conventions

- Tests are colocated with the code they exercise (`*.test.ts` beside the module).
- `pnpm test:run` stays under a couple of seconds. The speed is not a performance stat, it
  is the proof that the domain is pure — a suite that slows down means impurity got in.
- The default vitest project is `environment: 'node'` and `app/**/*.test.ts`. DOM tests are
  quarantined in a separate project so the exception stays visible and deliberate.
- Any test encoding a game rule cites its source in a comment (`// combat.tex "Afflictions"`).
  A rules assertion without a citation is indistinguishable from a mirror test six months on.
  Updating that test is part of the rules change, not a chore.
- Known violations are documented as skipped or `it.fails` cases with a one-line reason —
  see the `NON_INVERTIBLE_SKILLS` block in `lens-inversion.test.ts`. Never silently filter a
  broken case out of a registry loop.
- Prefer making a bug unrepresentable over testing for it. A branded id type or an explicit
  return annotation costs nothing to maintain; a test watching for the same mistake costs an
  edit forever. Reach for a test when the type system genuinely cannot see the failure.
- When a type is tightened so that an existing test can no longer fail, delete the test in
  the same change. Coverage that a compiler already provides is not kept for reassurance.
- Where a function accepts only part of a union, its signature is what says so. Drive a
  registry-wide check off the declared parameter type rather than a hand-maintained list of
  exceptions, so that misfiling a case fails to compile instead of silently skipping it.
- No test needs a comment arguing that it deserves to exist. If one is being written, that is
  evidence the test does not pass the gate — the honest move is to delete the test, not to
  improve the argument.
