# Survival: what is missing

What `survival.tex` asks for that the campaign layer does not do yet. The book's simplified rules are for the table and are not planned here.

## Events

- An event is in one stage at a time, and only the GM moves it to another (in the campaign's copy of the map). Nothing in play moves a stage.
- Searching an event found before is not easier yet (a known event is to be found at DL −5).
- Ambient events (rain, strong wind) that land on the whole node by chance or when the GM sets them off, changing its exposure.
- An event cannot hand anyone to a scene yet: an encounter's graze or miss is meant to force one, a crit or hit to offer it, and an event can be a forced scene.
- A camp cannot stand in a found shelter yet, and nobody can be found in theirs.
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

## The campaign

- The roster, the parties, their positions and the clock live in memory and are lost on reload.
- Parties on the same node stay apart until the table merges them.
