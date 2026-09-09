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

## Undecided

The project has no integration tests and no rule admitting them. Seams whose correctness rests
on an argument in a comment rather than on types or purity are a real risk, but the tradeoff
has not been felt here yet, so nothing is pre-authorized: decide it against the first seam that
actually demands it, and write the rule from that case.

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
