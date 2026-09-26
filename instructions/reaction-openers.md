# Reaction openers and one interruption rule

The follow-on to `instructions/action-stack.md`, whose stages 0–7 are done (last commit
`b53a909`). Read that file first. It holds the pipeline model and the table's rulings.
This file tracks the next refactor. Stages 1–3 and 5 are done.

## Where the combat sequencing stands

- Every action runs define → react → roll → post → effect (`ActionBase.step`). The roll
  and the effect are transitions, not places an action waits.
- `CombatState.stack` holds the actions being played out. The top is open.
  `CombatState.history` records the order actions landed in.
- `commands/sequence.ts` drives everything:
  - `advance` picks up from the top of the stack.
  - `openBefore` loops over the root's reactions and opens the first `before` in
    `REACTION_OPENERS` (`rules/openers.ts`) that opens something.
  - `land` settles the action, applies its effect and pushes `getFollowUps`, which
    collects every reaction's `after` plus the follow-ups no reaction opens.
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
- [x] **2. A table of what each reaction opens.** Make a record keyed by reaction kind,
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
- [x] **3. Take reactions out of the root switches.** Add an action type that excludes
  reactions, and make the five exhaustive switches take it. Reactions are never roots, so
  they stop listing them. Do this together with stage 2.
- [ ] **4. Share the strike a reaction carries.** The opportunity attack and the
  counterattack both declare a full strike on the reaction. They duplicate the builder
  (`getOpportunityStrike`, `getCounterStrike`), the option reasons ("no melee weapon in
  hand", "cannot afford a strike"), the completeness check, the cost, and the panel's
  strike picker (`getReactors`). Share these when a third reaction of this kind appears,
  not before.
- [x] **5. Small cleanups, only when already editing these files.** `findOpenRoot` still
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
- **Stages 2 and 3.**
  - `RootAction` (`types.ts`) is every action that is not a reaction, and `ReactionKind`
    and `ReactionAction` are the rest, both read off the catalog's `type`.
    `getOpenAction` and `getRootOf` narrow to `RootAction` (`isRootAction`), so the
    narrowing happens once, where the open action is read.
  - Three of the five switches only listed reactions to return nothing:
    `getKindTriggers`, `getRootTestTerms` and `getSettled`. They take `RootAction` and no
    longer name reactions. The other two genuinely switch on reactions, so they stay:
    `isDeclarationComplete` checks a block's row, a guard's shield, and an opportunity
    attack's or counterattack's strike, and the option switch in `options.ts` is over
    trigger kinds, which are reactions.
  - `REACTION_OPENERS` (`rules/openers.ts`) is typed `{ [K in ReactionKind]: Opener<K> }`,
    so a new reaction kind does not compile until it has an entry, even an empty one.
  - `before` returns `{ state, action }` rather than a bare action. An opportunity attack
    is fought with the root's movers placed one step short of its stretch
    (`getOpportunityState`), so opening one changes the board as well.
  - `after` returns the follow-ups. A voided root gets only those from an
    `evenIfVoided` entry: the counterattack, whose strike is its target's attack.
  - Order before the effect is explicit in `getReactionsInOrder`: the drawn opportunity
    attacks in path order, then the rest as declared. That keeps opportunity attacks
    ahead of a counterattack, as before. After the effect, a blast reads the reactions
    to its explosion (`getAnsweringReactions`).
  - `getMoveAfter`'s switch became `getFollowMove`, `getEvasionMove` and
    `getEscapeAfterBlast`, and `getMoveBeforeBlast` became `getEscapeBeforeBlast`. Each
    is called from its entry in the table. `goOff` now only makes the blast, pushed
    beneath the escapes. `getCounterattack` is gone, because the counterattack entry
    reads its own reaction.
  - The riposte stays outside the table. Filed under the defense kinds, its follow-up
    would sit beneath the escapes a stun opens instead of on top of them, which would
    change the order it is played in. Its gate is also the root's degree and the
    defender's ability, not the defense itself.
  - No new tests. Completeness is held by the mapped type, and the existing sequencing
    tests pin the behaviour, which is unchanged.
- **A riposte draws no flankers.** This is the table's ruling. `getTriggers` drops
  opportunity attacks from a riposte, as it does from what an opportunity attack opens,
  and the riposte's target still defends. A counterattack's strike is left as it is: it
  starts at `post`, so it draws nothing at all. A test in `sequence.test.ts` checks
  the fixture's flanker against the same punch made on the riposter's own initiative.
- **Stage 5.**
  - `findOpenRoot` reads the stack from the bottom up instead of scanning the log. The
    stack holds exactly the roots not yet done, in the order they were pushed.
  - `getOpenedBy` (`rules/log.ts`) is the one lookup for what a reaction opened. It is
    used by `getDrawnOpportunityAttacks`, `getCounterStrikeOf` and the opportunity
    attack's opener.
  - The reverse lookups, `getOpeningReaction`, `getOpeningCounter` and
    `getRiposteDefense`, stay separate. Each narrows to a different opener.
