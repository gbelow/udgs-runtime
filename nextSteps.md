# CURRENT PRIORITY

Adding all game modes:
- Scene - DONE
- Boardless scene
- Chase scene - DONE
- Exploration - DONE
- Downtime - DONE

# TO DO Priority

- Current focus:
Next Priority: general UI/ what are the screens


# TO DO

## Scene

### terrain
- items on the ground, containers in terrain

### movement
- jumping over things - 
- layering in UI for height. is it doable?

### combat abilities/spells
- finish melee combat abilities
- finish ranged combat abilities
- morale spells -- must test
- healing spells -- done
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

## GM TOOLS
- GM generated explosions
- GM made tests for players on the fly
- GM activated triggers
- add charge to item
- cause effect on character
- settings
- GM mode to edit characters freely/ players can only do it through actions


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
- connection
- character ownership split
- assets ownership
- sync gameplay


## issues
- spell learning formula potentially wrong
- cauterization burning damage using attack.ts
- infection DL is in the survival chapter. it s based on current IL level and the  place s infection exposure.


abilities that teach other abilities - magic theory, ferocity lv 4, 

breakage is a game option, must be in a game options place
party control is bad
reduce deflection of lighter armors

HOP calculation - lower deflections or make it based off of attack score, not score minus defense.


After that, in my recommended order:

1. Encounter templates. Today an encounter is a party you build by hand. A template would be a saved group: which characters, how many of each, and which party each goes in. Dropping one in would create a party with no timeline yet, ready to send to a scene. This builds directly on what we have: collections pick the characters, parties hold them, and scenes take them by party. It's also the piece behind "dropping a saved party into combat", which is only half done.
2. Campaign export and import as JSON. It's cheap, because the save format is already validated and copes with old or partial saves. It gives you a backup before campaigns get valuable.
3. Homebrew entries. Your own catalog entries, stored in Redis and merged with the built-in ones whenever a catalog is read. This is the biggest of the four, because every catalog read has to merge both sources.
4. Downtime-scale locations. Blocked until the rules for contacts and renown are settled.

