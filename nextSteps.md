# IDEAS TO DO

## character creation calculator

## weapons/armor
- add customization options to weapons
- add customization options to armors

# terrain
- items on the ground, containers in terrain

## add abilities 
- finish melee combat abilities
- finish ranged combat abilities

## spells
- add tex generator from catalogue

## cunning
- analyse - wait until multiplayer. allow seeing character without controlling

# movement
- jumping over things - 
- layering in UI for height.

## healing
- sleep
- medicine abilities
- magic
- potions

## simulation
- build ai strategies

## morale
- feign death
- call help

## GM TOOLS
- GM generated explosions
- GM made tests for players on the fly
- GM activated triggers
- GM mode to edit characters freely/ players can only do it through actions
- GM selected morale pressure

## compiling to book
- add insertable variables to descriptions
- compile abilities/spells/items into tex

## out of combat in map
- when triggers/poison apply

## chase
- action decision/AP budget
- chase roll - group roll
- party splitting
- tracking distances
- stealth and detection - 
- time tracking - poison, environmental spells

## saving assets to redis
- getting chars per user
- save encounter
- items, spells, abilities

## multiplayer
- connection
- character ownership split
- sync gameplay
- permissions gm/player

## explore integration with VTTs

## improve interface - make it pretty
- in ui-design-patterns.md
- must show effects
- slim down right panel
- left panel colapsible
- actions becomes main game interface

## issues
defending net with weapon binds weapon.
retweak morale based spells

explosions with multiple instances
corrosion left commented out for further design.

show morale test inside the actions panel. 
check if morale is forcing surge usage.

combat surprise - team sides - combat start button
characters sharing same space
characters as cover
cover on prepared guards
breaking cells


# left for combat
- environmental effects - storm, avalanche
- abilities and spells
- analyse to find items
- riding
- combat snapshots, do/undo action, list of last actions

# no map combat 
- explosions/ tests for all
- mobility tests
- senses/stealth
- 


Where I went beyond or changed the plan
- Not built:
  - the Crossbow and Shield ability, because combat has no reload action yet;
  - cover on prepared guards;
  - characters as cover


- Does turning a flexible body cost anything, or can it bend freely along any path?
- Can a snake end its move coiled into a blob, or must the cells stay in walk order?
- When a body is split, does the piece without the chest just drop as an item, or can it be a creature of its own (a hydra head, worm halves)?
- Should a link be cuttable on its own (its own wound), or only through a lost part?