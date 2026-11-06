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