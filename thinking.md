# scene axes (plan, not built)
A scene is one action sequence varied along two axes, both set on the scene state. Build each piece when the mode that needs it is built, not ahead of it.



- Does turning a flexible body cost anything, or can it bend freely along any path?
- Can a snake end its move coiled into a blob, or must the cells stay in walk order?
- When a body is split, does the piece without the chest just drop as an item, or can it be a creature of its own (a hydra head, worm halves)?
- Should a link be cuttable on its own (its own wound), or only through a lost part?



Your five parts map to that pitch well:

┌─────────────────┬───────────────────────────────────────────────────────────────────────────────┐
│      Part       │                       What it shows, in plain language                        │
├─────────────────┼───────────────────────────────────────────────────────────────────────────────┤
│ Pure domain     │ Logic you can trust and check, kept separate from the interface. This is also │
│                 │  why an AI can work on it safely.                                             │
├─────────────────┼───────────────────────────────────────────────────────────────────────────────┤
│ Lenses          │ Edit a final value and the app works out which stored input to change. It's   │
│                 │ an unusual, original idea, so lead with it for technical listeners.           │
├─────────────────┼───────────────────────────────────────────────────────────────────────────────┤
│ Action sequence │ Every event is recorded and the state is rebuilt from that record. Same       │
│  and log        │ principle as audit trails in banking or logistics.                            │
├─────────────────┼───────────────────────────────────────────────────────────────────────────────┤
│ Character       │ State changes only through defined steps, so nothing changes by accident.     │
│ reducer         │                                                                               │
├─────────────────┼───────────────────────────────────────────────────────────────────────────────┤
│                 │ New content needs no new code. Rules are stored as data and one engine        │
│ Spells as data  │ interprets them, like a business rules engine in insurance or the public      │
│                 │ sector.                                                                       │
└─────────────────┴───────────────────────────────────────────────────────────────────────────────┘
Multiplayer - view per character, log stamped per character, 

The last two lines matter most for a career counsellor. They link a game to real industries. "I built a game tool" sounds like a hobby. "I turned a 300-page rulebook into a system where the rules are data and every action is logged" sounds like a job.

The bot weighs a turn in three places, and each new tool should feed one of them:

- **Candidates** (`candidates.ts`) decide which options get looked at.
- **The value function** (`value.ts`) scores the state an option leaves behind.
- **The rollout policy** (`greedy.ts`) plays the fight on after each option.




The damage estimator (`estimate.ts`, with `evaluation.ts`, `afterAttack.ts` and `grapplePosture.ts` on top of it) isn't connected to any of the three yet. Only those four files use it. `chooseTurnAction` still scores options by rolling them out with the greedy bot. Greedy takes the first attack on the most wounded foe, and `value.ts` has its own rougher threat check.

The existing readers all work the same way: change one thing on a copy of the state, then read the estimator again. `afterAttack` takes the AP and STA off and re-reads; `grapplePosture` plays the hit with and without the hold and re-reads. Most of the tools below are that same move with a different change, so they're new uses of the estimator rather than new machinery.

## Ideas, most valuable first

**1. Greedy picks by the estimator (rollout policy).** Before adding any tool: make greedy choose `rankAttacks(...)[0]` instead of the first candidate. Every option's score is only as good as the fight played on after it, so a smarter greedy improves every choice at once. It's cheap if the evaluation cache holds up.

**2. Threat map (value function and movement).** For each cell the character could reach: move it there on a copy, then read every foe's best attack on it, plus the opportunity attacks the walk itself draws. That gives "how much I take if I end here" in the estimator's unit. It can replace `strongestStrike` in `value.ts`, and the estimator's version already accounts for defenses and the overflow (HOP) spend. It's also what makes cover, staying out of reach and fighting from behind a spear wall mean something to the bot.

**3. Reach map (candidates).** The other side of the threat map: for each reachable cell, my best attack from there with the AP left after the walk. Today the bot only proposes "the cell nearest a foe". With the two maps together it can propose "walk and strike from the cell with the best payoff for the least danger". That covers flanking, archers keeping their distance, and avoiding opportunity attacks in one tool.

**4. Value of reserve AP (turn budget).** What keeping N AP back is worth: the IL my best affordable defense saves against each foe's best attack. `Prospects.saved` already computes this for one pairing. With it, "attack again or keep 3 AP to parry" becomes a direct comparison in the same unit, instead of the flat `tuning.ap` weight.

**5. Time to kill and target priority.** For each foe: the expected AP (or rounds) the party needs to bring it down, from the best attack sequence and `pDead`/`pStun`. Set that against the IL per round the foe deals. Threat removed per AP spent is the classic focus-fire heuristic. It would replace "most wounded first" in `byWounds`, which ignores how dangerous the foe is.

**6. Out of answers (exchange).** For each foe: the AP it has left against the price of its cheapest defense, and which cheap attack would use that defense up. `exchange.ts` and the `defensive` tuning already reach for this, but a reader would make it explicit: "feint or jab now, swing hard after".

**7. Hazard and control reader.** Cells next to a foe that are a cliff, water, fire or a wall, and the odds that a push or drag puts it there. These are values the damage estimator can't see.

**8. Break-point reader.** How close each foe is to its morale break or limit stress (`morale.ts`), and the same for my own side. It answers when hitting the shaken foe ends a threat cheaply, and when to flee or surrender. This one needs your rulings on what the bot may know about a foe's morale.

**9. Area estimator.** `estimate.ts` only covers strike and shoot. An explosion or spray needs the expected IL summed over everyone in the area, foes counted for and allies against, before bombers and mages can choose sensibly.

**Separate from these: a tuning arena.** A tool that plays bot against bot over many seeds and reports the win rate for each tuning. It doesn't make a decision, but without it nobody can tell whether tools 2 to 9 actually help.

My recommendation is to start with 1, then 2 and 3 as one piece, then 4. Together they change the bot from "hits whatever is nearest" to "chooses where to stand and how much to spend". 5 is cheap once 4 exists.

Which ones do you want to work through? Some of them need rulings from you first. For example, may the bot read a foe's exact AP, morale, or prepared reactions, or only what a player at the table could see?