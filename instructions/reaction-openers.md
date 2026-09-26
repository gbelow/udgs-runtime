# Reaction openers and one interruption rule

The follow-on to `instructions/action-stack.md`, whose stages 0–7 are done (last commit
`b53a909`). Read that file first. It holds the pipeline model and the table's rulings.
This file tracks the next refactor. Stage 1 is done.

## Where the combat sequencing stands

- Every action runs define → react → roll → post → effect (`ActionBase.step`). The roll
  and the effect are transitions, not places an action waits.
- `CombatState.stack` holds the actions being played out. The top is open.
  `CombatState.history` records the order actions landed in.
- `commands/sequence.ts` drives everything:
  - `advance` picks up from the top of the stack.
  - `openBefore` opens the actions that go before the effect: opportunity attacks, and a
    counterattack that rolled higher or tied.
  - `land` settles the action, applies its effect and pushes `getFollowUps`.
  - Every command ends in `advance`.
- An action writes only its own record. Giving up an action and being voided are
  derived from the log (`rules/opportunity.ts`), and being interrupted from the same
  log by one rule (`rules/interruption.ts`).
- Generated action kinds:
  - `displace`: the way a push is walked.
  - `blast`: an explosion going off.
  - the strike a counterattack opens (`rules/counter.ts`).
  - a riposte (`rules/riposte.ts`).

## Known costs of the current shape

- Five files list every action kind in an exhaustive switch, mostly to return nothing
  for reactions: `rules/action.ts`, `rules/attack.ts`, `rules/options.ts`,
  `rules/reactions.ts` and `rules/settle.ts`. Every new kind touches all five.
- The answer to "what does this reaction open, and when" is spread over five places:
  - `openBefore`: opportunity attacks, and a counterattack that rolled higher or tied.
  - `goOff`: the escapes before a blast.
  - `getFollowUps`: moves after the effect, a counterattack that rolled lower, the
    riposte, escapes from a stun, and a push's displacement.
  - `rules/reactionMoves.ts`: `getMoveBeforeBlast` and `getMoveAfter`.
  - `rules/counter.ts`: the order a counterattack takes by its roll.
- Order within a follow-up array matters: the last one pushed plays first. Only comments
  say so.

## Stages

- [x] **1. One interruption rule.** The table's ruling is that an interruption always
  breaks the interrupted action, except running and jumping. Derive it once: an action is
  broken when something descended from it landed an interruption on its actor before the
  action's own effect. What descends from it is its reactions, and whatever they opened,
  through `reactionTo` and `spawnedBy`. This replaces `isInterruptedByOpportunity`,
  `isInterruptedByPush` and `isInterruptedByCounter`.
  - A move is cut short where it was caught (`getMoveOverride`), and a push where its
    pusher was caught (`getPushStop`). Neither is voided. They read the same rule
    differently, so decide whether they consume it or keep their own.
  - A counterattack tie must not break the attack. The table's ruling is that both land
    and neither interrupts the other.
- [ ] **2. A table of what each reaction opens.** Make a record keyed by reaction kind,
  typed so that a new reaction kind fails to compile until it says what it opens. Each
  entry has an optional `before(state, root, reaction)` and `after(state, root, reaction)`,
  each returning the actions it opens. `openBefore` and `getFollowUps` become loops over
  it. This replaces the `opens: 'before' | 'after' | 'byRoll'` field that stage 7 of the
  first refactor dropped, because a field alone could not say *which* rule decides.
  - Follow-ups that no reaction opens stay outside the table: escapes from a stun, a
    push's displacement, the blast, the explosion a cast opens, the riposte (opened by a
    defense, gated on the root's degree). Decide whether the riposte belongs in the table
    under its defense kinds.
  - Consumers coming from the book, all reactions: Precise Evasion ("If the opponent
    grazes or misses, an opportunity attack is triggered"), Defender, Defensive Advance
    (`abilities.tex`).
- [ ] **3. Take reactions out of the root switches.** Add an action type that excludes
  reactions, and make the five exhaustive switches take it. Reactions are never roots, so
  they stop listing them. Do this together with stage 2.
- [ ] **4. Share the strike a reaction carries.** The opportunity attack and the
  counterattack both declare a full strike on the reaction. They duplicate the builder
  (`getOpportunityStrike`, `getCounterStrike`), the option reasons ("no melee weapon in
  hand", "cannot afford a strike"), the completeness check, the cost, and the panel's
  strike picker (`getReactors`). Share these when a third reaction of this kind appears,
  not before.
- [ ] **5. Small cleanups, only when already editing these files.** `findOpenRoot` still
  scans the log in five places and could read the stack. The "what did this reaction
  open" lookups could be one function in `rules/log.ts`.

Rejected: a unified helper for *listing* reactions. `getAvailableActions` is already the
one list, driven by `getTriggers`. Its per-kind switch shapes genuinely different options
(a block per weapon, evasion's staying-put variant).

## Working agreement

- Plan with the user before each stage, then implement, check, update this file, and
  commit when the user says so.
- Checks are `pnpm test:run`, `pnpm lint` and `pnpm exec tsc --noEmit -p .`. The one
  existing lint warning, `DamageButton` in `PlayPanel.tsx`, is known.
- Tests follow `instructions/testing.md`. The sequencing tests live in
  `commands/sequence.test.ts`. Its helpers (`playOut`, `everyoneAttacks`, `thrustAt`,
  scenarios) are driven through the commands, and each asserts an invariant with an
  author: the rulebook or a table ruling.
- Read the `.tex` before touching any rule. The user edits the rulebook actively.
- In this environment, heredocs with quotes break in the Bash tool. Write multi-edit
  Python scripts to the scratchpad with the Write tool, and run them from there.

## Log

- **Stage 1.** `rules/interruption.ts` holds the rule. `getInterruptionOf(landed, victim)`
  says what a landed strike, push or displacement did to someone (`'none'`,
  `'interrupted'`, `'stunned'`). `getInterruptions(state, action)` lists what the action's
  descendants landed on its actor before its own effect, ordered by `state.history`, and
  skips a counterattack's tied strike. `isBroken` is any of them, except for a move or a
  push. `isVoided` and `isCancelled` read `isBroken`, and the three `isInterruptedBy*`
  functions and `isInterruptingStrike` are gone.
  - Table rulings: the pusher goes along with the push, so a push joins running and
    jumping as an exception. Interrupting the pusher does not stop it; only a stun does
    (`getPushStop`). A counterattack's tied strike still lands its interruption or stun
    on the attacker, and only the breaking is suppressed. Whether a stun stops a run or
    jump beyond its first block was left as it was.
  - `getMoveOverride` keeps its own loop (jumps, trips, tramples, a run's first block)
    and reads `getInterruptionOf`. It still looks only at strikes. An opportunity push
    against a mover is unreachable, because a grappled character cannot move, and
    counting one would also need a move stop that keeps the mover where the push left
    them.
  - Tests: an interrupted pusher carries the push the full way, and a stunned one stops
    one step short. The tied counter strike still interrupts the attacker. `playOut`
    passes up the escape a stun opens. No test pins the history ordering (a
    counterattack that rolled lower cannot break the attack). The fixtures cannot
    arrange a hit that does not interrupt, and nothing observable reads a landed
    action's `isVoided` after its follow-ups today.
