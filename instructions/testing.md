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
  a fixed point, a reviewed diff, or an observed failure — admit it under one of the five
  categories below.

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

### 2. Shape and contract

Assert what must be true of the *form* of a value crossing a boundary, never its content.
Because such a test names no game number, it cannot restate a rule. The properties worth
asserting at a boundary are that it is total (every input, including hostile ones, yields
something valid or nothing at all), that it is idempotent (applying it twice changes nothing
further), that it round-trips through the representations it is stored and transmitted in,
and that everything it claims to accept actually conforms to its declared schema.

These are the tests that catch structural mistakes the type system cannot see — mismatches
hidden behind inference, widening, or serialization.

### 3. Golden outputs

Where a deterministic transform turns a small input into a large derived output, snapshot the
output and check it in. This is admitted **not** as proof that the transform is correct, but
because the diff becomes the review artifact: a single change to an input or a rule shows its
entire blast radius in one reviewable place, which is the workflow this project is built to
support.

The discipline that keeps it honest: inputs are authored, snapshots are generated and never
hand-edited; a regenerated snapshot whose diff nobody can explain is a failing test; and the
set stays small and representative rather than exhaustive, since every entry is churn on every
intentional change.

### 4. Regression tests

A test written *from* a bug, after it is found. Its expected value is the observed correct
behaviour in that one scenario, so it is not a mirror test even when it looks like one. Its
job is to pin a case that empirically broke, not to describe a rule. Comment it with what
broke, not with what it checks, and keep it even when it looks redundant.

## Rejected

- **Mirror tests.** An assertion whose expected side is the implementation retyped. Rules are
  already transcribed from the rulebook once; a second copy means changing two places per
  rules change, and it passes on exactly the transcription errors it appears to guard against.
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
