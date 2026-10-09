# Survival: what is missing

What `survival.tex` asks for that the campaign layer does not do yet. The book's simplified rules are for the table and are not planned here.

## Events

- Events are text the table reads. None of them changes anything yet: no wear, food, water, shelter, knowledge or position comes out of them.
- Extra wear from an exploration action comes from wear events ("Wear: an event that increases wear for the EA"), not from the terrain. Terrain wear is paid every ET by everyone on the node.
- An event can be what a path needs done to be finished (a climb, a swim). Today nothing can stop a group from arriving: travel ends where the roll and the draw say, and the event's outcome is only read.
- Search: "a crit over the event DL allows interacting with it and going for another event for which there was a hit or crit" is left to each event's own resolution.
- Random encounter while making camp (optional): one per day of long camping, drawn from wear and encounter events only.
- Connection events that the test was "high enough" to avoid are read by degree, never skipped.

## Shelter

- A shelter is a node of its own, with its own terrain and wear, reached from the node it is in.
- Finding a shelter in a node can take no ET. Paths all take 1 ET today; nothing reaches a node in 0.
- Items that lower exposure (tent, bedroll, measures against cold, heat or insects) do not exist. Only a built shelter and the campfire lower it.

## Tracking

- "Being tracked" is rolled with the tracker's exploration skill and ends in a detection check when they approach.
- Trackers on the same node as their quarry do not find it for being there.
- A track can point to another node.
- The terrain's tracking DL and visibility are not stored.

## Terrain

- The `rain` tag (a chance of rain raising exposure without shelter), the `heat` and `cold` measures, and `threats` (someone standing guard) have no effect. Only `wood` (firewood can be looked for) and `cold`/`insects` (the campfire lowers exposure) do.
- Location knowledge is read from the characters' knowledge of the terrain. Maps, landmarks and time spent somewhere do not raise it.

## Travel

- Paths have no distance: every path takes 1 ET. Longer paths will follow the long travel rules.
- Carrying a forced rester costs no burden (bulk size + 2).

## Food and water

- Food and water are not items. Eating takes a nutrition value typed in; drinking needs no water carried or found.
- "A character can recover 5 thirst in a single ET": drinking is unlimited.
- Portions are measured for size 3; other sizes need more or less food at the rate the VM defines.
- Water can be salt or infected and then does not recover thirst.
- Cooking is a roll with no effect: "all food is utilized" on a crit, 75% on a hit, 50% on a graze, 25% on a miss needs food items, a fire and a pot.

## Camp and healing

- Firewood: "On a crit, they do not spend the exploration action". The ET is spent either way.
- Lighting the fire: "Crits perform it in minutes". The ET is spent either way.
- Long camping: several days of rest at once — shelter and fire last, "every day, characters heal 3+3*(health-exposure)/2", healing abilities used once a day per healer, exhaustion at zero by the second day.
- Healing abilities and spells used during an ET, and the exhaustion that casting and concentrating cost outside combat.

## Infection

- Optional in the book: "Make a health test every ET. The DL is equal to the |Injury penalty| + infection exposure, where infection exposure depends on the terrain. The character takes 3/1/0/0 IL damage depending on the test result."
- Terrains have no infection exposure.

## The campaign

- The roster, the parties, their positions and the clock live in memory and are lost on reload.
- Parties on the same node stay apart until the table merges them.
