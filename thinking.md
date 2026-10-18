# scene axes (plan, not built)
A scene is one action sequence varied along two axes, both set on the scene state. Build each piece when the mode that needs it is built, not ahead of it.

- time
  - rounds: each round kind is an entry in a table (AP budget, length, what happens at round end), not a hardcoded union. combat and chase are entries; a dungeon round could be another.
  - free: no rounds, no AP, no clock (a real-time clock optional). like exploring in a crpg. what is round-scoped (turns, surges, morale and stress at round start, held tests, prepared reactions lapsing, social pressure of the round before, sustained upkeep) is off or moves to another trigger.
- space
  - board: what exists today.
  - boardless: targets picked from a list; reactions set off by their own triggers instead of paths and reach.
  - chase: boardless plus distances between the sides, which feed distance penalties and stealth, with a few caveats of its own (catching, outrunning, group speed).
- combinations: combat on the map, boardless combat, chase (rounds with the chase budget + chase space), free scene with or without the board.
- the seam: today "boardless" is the absence of a placement — rules that read `state.board?.placements` skip their restriction when there is none, per character. when boardless or chase rules are written, those fallbacks become a call to one space seam (distance, who may be targeted, what triggers a reaction), and the round checks a call to one time seam. the board-only rules are already apart under `scene/rules/board/`.
- ending a scene: adds the ETs the table says it took (done for fights); a free scene ends the same way.
- dungeon mode (the alexandrian): either a mod of the point crawl (rooms as nodes, the dungeon turn in place of the ET, so exploration should read its step's length from data) or a free map with limited AP where each dungeon round changes the scene (a round kind with its own round-end). undecided.
- leftover renames: the store and hooks still say combat (`useCombatStore`, `updateCombatState`, `useCombatState`, `useCombatActions`, `useCombatCommands`).





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