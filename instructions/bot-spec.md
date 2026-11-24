# General loop

## Decide take turn 
If any immediate action, try taking turn. 
If no immediate action, do I have a positional action? 
if yes, try to take turn. 
Am I ok to end round?
If no end round actions are worth it, remove AP cost from positional ones. If nothing worth it, end round ok

## Immediate actions

- attack - strike, shoot, throw
- Escape
- Defend
- Opportunity attack - same as attack
- 

## Strategic actions

- Reposition
- Switch weapon

## Round end
- Social actions and rest
- limit stress action


# Facts

## Probabilities
normal: p(face) = 0.1
risky: calculate
safe: calculate

## Skill at a distance (`threat.ts` `getSkillAt`)

skill(gap) = skill − distancePenalty(rate, min(gap, reach))  

## Face. What a seat knows (`belief.ts` `getBelief`)

own members:         full sheet

everyone else seen:  the face, with attributes and skills = floor(real / 3) · 3 talents, proficiencies = empty
  abilities = only those seen used this fight, with what they require, and Archer, which every face is taken to have (the user's ruling)
  AP, STA   = fillThird(third shown)
  a quiver of 20 for every held weapon that shoots

  Remember face when doesnt detect anymore. Refresh when seen again. Remember position. Fade position per round, maximum 2 rounds.

# Scoring

## harm
- harm = w.IL · IL + w.bleed · bleed

###  Spending a hit's overflow (`predict.ts` `getBestSpend`)

Assassinate always bought when available

Try all in smash
Try Bust + rest in slice
Any remainder goes into smash
Highest Tier or damage wins. On a draw, prefer smash.

## Expected harm (`odds.ts` `getExpectedHarm`)
The average harm caused by an attack against a defense

harm(attack, defense) = Σ_face p(face) · { hits[min(over − 5, last)] if over ≥ 5,  graze if 0 ≤ over < 5 and the attack grazes, miss otherwise }

over(face) = face + skill − DL
`hits[h]` is the harm at HOP `h`, with the overflow spent optimally.
ranged attacks use 20m when distance is not specified.

## Defense

prevented harm = (harm(undefended) - harm(defended))

Given an attack,
For every defense, find defenses where harm(attack, defense) < 10.
if none are found, use defense that lets lowest harm pass
if any are found, defend if prevented harm (undefended - defended)/AP cost > w.caution, choose the cheapest defense that qualifies

## Threat
Threat is the maximum harm of all attacks that can be done against a character.

Immediate: consider everyone's current AP. 
Potential: consider everyone has 8 AP + movement surge AP. Consider focus surge instead if necessary.
Do not apply restrictions to the surge AP. 

Every character has a list of [AP to reach, attack combinations available] for every location. (make a list of attack combinations per AP left, then apply to each location, using attack with shorter reach. We dont care about repeated combinations for the same location)

When a character steps into a location, Threat(attackers, defender) = sum (for every character(max(harm over attacks on location)))  

Threat is cached per character, and changes based on their position and AP.

## Cost
This is an estimation of how much harm an AP or STA are worth. Consider that threats are defended by evade or evasion.

STAharm = w.STA x STA + w.IL x STA x bleed

<!-- Cost(action) = action(AP) x average(prevented harm/defense cost)x min(1, num foes/num allies) + STAharm(action(STA)) -->

Cost = AP × Σ prevented / max(Σ defense cost, num allies × AP held) + STAharm

num allies is the amount of party members within 10m radius, including self. 

## Danger

allies = Number of party members within 10m of the departure location.
danger(cell) = Σ (threat − prevented) / num allies there


# Immediate Actions

## Attacking

target threat = average threat this target does against best defense of everyone they can hit    
OA drawn = the harm from the highest harm available opportunity attack received undefended

Choose the target with the highest score.

Score = harm(attack, defense) + Cost(defense) + w.aggressivity × target threat + danger(here) − danger(end) − Cost(AP, STA) − OA drawn

Read this as The harm I am expected to cause - how much that costs me to defend myself later - what expected harm it does to me + how much more vulnerable that makes my opponent + how dangerous is this foe

An attack is treted as a block, including the move to do it and its execution. It is reevaluated if anything changes before the attack happens.

### Peek attack

A character considers a 2 walking blocks distance to perform ranged attacks. It prefers to move out and come back to safety.

## Defend

React to an attack using the rules in Defense.

Make the reaction surge only if the defense the rule picks needs it, and prevented harm > STAharm.

Against projectiles - use reposition with the AP from the evasion.

## Escape

Considered only if danger(here) > w.courage × w.IL × (injury capacity − current IL).
Score = danger(here) − danger(end) − Cost − OA drawn. The highest Score wins, against attacks too.


# Strategic Actions

## Strategies
Pick one each round, the one with the highest score.

### Attack
If there is immediate threat against any target, pick the one with the highest. Otherwise, pick the target who is detected and takes the highest harm(evasion) from the characters attack, considering evasion. 
If teh plan is to attack and my potential threat on the target is 0 here, read the walk to it as shorter by the distance it is out of range now: steps(cell) − (steps(here) − radius).

Score = Potential threat(target) or harm(evasion) if threat is 0

If target is incapacitated, choose strategy again.

### Defend

Find the ally who has the most Immediate threat on them. Find the biggest threat on them, and mark that as the target.

Score = Potential Threat(ally)


## Reposition

### Tactical

Move to place where
Score(cell) = w.aggro × my potential threat on my best target there − Σ enemies' potential threat on me there / num allies there
Pick the cell and movement with the highest Score(there) − Score(here) − Cost − OA drawn, if above 0. Only cells where danger, read with potential threat, is under Escape's trigger.


### Search

Any enemy that is detected through a passive sense or remembered can be pursued with tactical movement.

If no foe is seen, the bot lists its seen and unseen spaces and moves up to w.search AP towards the nearest unseen spaces. Allies never end a move farther than w.solitude from the nearest ally, unless the move brings you closer.

### Defend

Move towards an ally

# Misc

## Surges
- at 0 STA, only focus or recovery surges. The board enforces it anyways.
- no focus surge unless the action it opens is allowed.
- When an action involves multiple steps, execute all of them as one block. 

## simulation
- always 1 worker per simulation, max 10 workers.
- look at vscode autosave for simulations made by the player


# Constants

w.STA = 2
w.caution = 5
w.aggressivity = 0.5
w.IL = 2
w.bleed = 8
w.search = 4
w.solitude = 10
w.courage = 0.75
w.aggro = 1






