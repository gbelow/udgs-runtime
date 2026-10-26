# CURRENT PRIORITY

Complete combat features

# TO DO Priority

Map features
Test stealth combat
Implements abilities that are not pure text
Improve Chase UI/ playability
Multiplayer


# TO DO

## Scene

### terrain
- items on the ground, containers in terrain

### movement
- jumping over things - 
- layering in UI for height. is it doable?

### combat abilities/spells
- morale spells -- must test
- terrain altering spells

### Content primitives for combat
- explosions with multiple instances
- corrosion damage
- riding
- analyse to find items 
- environmental effects - storm, avalanche

### sequence
- corrosive damage
- curse at beginning of round

### knowledge actions


### misc
- analyse - wait until multiplayer. allow seeing character without controlling
- feign death
- call help
- turning large creatures
- snake creatures, coiling, and moving
- cover on prepared guards
- characters as cover
- defending net with weapon binds weapon.
- combat surprise - team sides - combat start button
- characters sharing same space
- breaking cells
- leave dead bodies on the fight


-----------------------
## Exploration

to scene/to exploration/to downtime buttons. 

### events
all events

### knowledge actions
- repair gear

### UI
- create map - visual nodes, click to edit. connect visually to make the map
- show the map in actual exploration.

### exploration items
- tents, clothes, etc

-------------------
## Downtime

Celebration - waiting for contacts and leverages. later work

Specific knowledge - GM decides what exists, players consume from the list

Cleric spells are free.

-----------------
## Chase
- stealth and detection - 
- scouting
- obstacles 
- hiding.

### misc
poison


---------------------
## Content authoring

### gear
- add customization options to weapons
- add customization options to armors
- gauntlet and closed helmet
- potions


### tex generators
- spells
- items
- abilities
- characters
- add variables to descriptions

--------------


## simulation
- build ai strategies



## multiplayer
- reconnecting
- exploration and downtime



## issues
- spell learning formula potentially wrong
- cauterization burning damage using attack.ts


abilities that teach other abilities - magic theory, ferocity lv 4, 

REBALANCE WEAPONS/ARMOR - bypassing armor is almost useless. non penetrating weapons are near useless. everything is extremelly deadly without metal.
current test: cutting is only halved when does not cut. 


After that, in my recommended order:

1. Encounter templates. Today an encounter is a party you build by hand. A template would be a saved group: which characters, how many of each, and which party each goes in. Dropping one in would create a party with no timeline yet, ready to send to a scene. This builds directly on what we have: collections pick the characters, parties hold them, and scenes take them by party. It's also the piece behind "dropping a saved party into combat", which is only half done.
2. Campaign export and import as JSON. It's cheap, because the save format is already validated and copes with old or partial saves. It gives you a backup before campaigns get valuable.
3. Homebrew entries. Your own catalog entries, stored in Redis and merged with the built-in ones whenever a catalog is read. This is the biggest of the four, because every catalog read has to merge both sources.
4. Downtime-scale locations. Blocked until the rules for contacts and renown are settled.

intercepting with bare hands - damage or not?
review body - injuries are not dropdowns, but text
