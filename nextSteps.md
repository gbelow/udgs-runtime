# IDEAS TO DO

## character creation calculator

## add convictions 
- selection within the options -- DONE
- auto add abilities
- conviction requirements not firing
- convictions must be one worldview and one temperament

## XP tracking
- spells - intuitive requires XP track
- add half learned abilities - XP track
- trainable as wrapper - abilities and spells
- interface, learning mode
- add training formulas - talent for proficiencies, skills, attributes, spells, abilities

## add senses
- list senses and bonus
- decide interface

## weapons/armor
- add customization options to weapons
- add customization options to armors

## hands
- auto track spending charges
- localized damage

# terrain
- items on the ground, containers in terrain
- 

## add abilities 
- add tex generator from catalogue

## spells
- add tex generator from catalogue

## cunning
- starting combat
- require start turn to act
- feint

# movement
- climbing
- falling
- balance tests
- swimming tests
- jumping over things
- trample, drag and drop

# morale test
-add it

## simulation
- build ai strategies


## compiling to book
- add insertable variables to descriptions
- compile abilities/spells/items into tex

## exploration
- exploration turn apply wear
- rest value calculated automatically
- exploration actions - rest, sleep, search, travel

## out of combat in map
- how track time
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
- 

## explore integration with VTTs

## improve interface - make it pretty
- in ui-design-patterns.md
- must show effects
- slim down right panel
- left panel colapsible

# technical
- separate actions in combat rules - organize by skills

## issues
flee isnt implemented
flamethrower - sustain doesn t work. spray must leave effect. start of next turn auto recast. environmental effects
amplify is doing nothing, nor any other enhancements
arrows are not spent nor can be selected right now. quiver must be defined.
flamethrower needs charges - transform into weapon
wound and wound healing is undefined - possession healing neither
select items to charge + do not stack items in quick slots
blast scaling - scale to scale of the item. 1 amplify is allowed over item size.

clean up redundant clicks in actions, like spray and movement.
option to strike must not exist when no strikes are available.

trip test - new test 
hook attack - force condition to trip
pushing while prone 
surge AP usage - 
soft grapple weapons - whip is not grapple, nor is net
visual effect marking grapple/tangle
running must start in movement surge
movement afflictions definitions - prone, lame
stand up while grappled - opportunity attack/ push - no specific rule required
disarm during grapple - only crits, no hit effect. trigger at intercept
allow throwing items with standard action
drop 3 AP constraint for opportunity attack vs standard actions
set off charged items on the floor