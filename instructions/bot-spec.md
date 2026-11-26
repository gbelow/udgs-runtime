# General loop

## Decide take turn 
If any immediate action, try taking turn. 
If no immediate action, do I have a positional action? 
if yes, try to take turn. 
Am I ok to end round?
If nothing worth it, end round ok

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
Threat is how much harm a character could do to another one, undefended, with the AP it has left once it has walked there.

Threat(attacker, defender) = max over attacks of harm(undefended) / attack AP × AP left

AP left = max(AP + 4 − walk, AP − max(0, walk − movement surge AP)) if it hasn't surged this round
AP left = AP − walk if it has
AP left = AP − walk if the shot needs focus (focus is the surge). It's 0 if it already made another surge.

walk = the AP to get in reach for that attack, at a run where it can run, not rounded to blocks. For shots, 2 walking blocks to find a line of fire.

Immediate: AP = what it holds now. Potential: AP = 8, with the surge unused.

Threat on a character is the sum over everyone who can attack it.

## Cost and exposure
This is an estimation of how much harm an AP or STA are worth. Consider that threats are defended by evade or evasion.

STAharm = w.STA x STA + w.IL x STA x bleed

T = Σ threat, P = Σ prevented, D = Σ defense cost, n = allies within w.solitude, me included
num allies is the amount of party members within w.solitude m radius of the location, including self. 

exposure(cell, AP) = (T − P × min(1, n × AP / D)) / n
  my share of the harm I could take − what my AP can prevent of it

drain = exposure(character, AP after its action) − exposure(character, AP it holds) + STAharm of its action
  how much exposure increases with spending AP plus how much harm spending STA does

  any time drain is used more than once in the same calculation, consider everyones AP synchronously. One characters AP influences the exposure of the other.

danger(cell, AP) = max( immediate exposure(cell, AP), potential exposure(cell, 8 AP) )

# Immediate Actions

## Attacking

target threat = average threat this target does against best defense of everyone they can hit    
OA drawn = the harm from the highest harm available opportunity attack received undefended

Choose the target with the highest score, for the best attack/defense available choice.

Score = harm + drain(enemy) + w.aggressivity × target threat - drain(me) − OA drawn

An attack is treted as a block, including the move to do it and its execution. It is reevaluated if anything changes before the attack happens.

### Peek attack

A character considers a 2 walking blocks distance to perform ranged attacks. It prefers to move out and come back to safety.

## Defend

React to an attack using the rules in Defense.

Make the reaction surge only if the defense the rule picks needs it, and prevented harm > STAharm.
Consider a movement surge when using reflexes, since it gives a bonus.

Against projectiles - use reposition with the AP from the evasion.

### Avoid explosion

React to an explosion by choosing to move to a place where score is minimal:
Score = harm(explosion, reflex/block) + exposure(end, AP left) − exposure(here, AP held) + STAharm, try block, avoiding and nothing


### Escape

limit = w.courage × w.IL × (injury capacity − current IL) − w.IL × bleed

Considered only if potential exposure(here) > limit

harm(cell) = danger(cell, AP left) + STAharm + OA drawn
  what getting there and standing there could cost me

safe cells = cells with harm(cell) ≤ limit
Go to the safe cell with the highest potential threat on target vs evasion
  (with none in reach, the target is read nearer, as in Attack).
  On a tie, the least harm.
If there are none, don't escape.

Score = danger(here, AP held) − harm(cell), if above 0. The highest Score wins, against attacks too.

### Protect

Defend an ally if the following are true:

An ally is the target of a strike or shot, and nobody is defending it yet (itself included).
The ally's exposure is higher than mine, each with the AP it holds.
A block, intercept or guard is open to me, with or without a step first. Surges are not considered.
The Defense rule picks one of them, against the ally taking the hit undefended.

Protect only if prevented > Drain(me)
  prevented using best defense. 
  prevented only counts added bleed.

# Strategic Actions

## Reposition

### Tactical

Score(cell) = w.aggro × my potential threat on target there vs evasion

Pick the cell and movement with the highest
Score(there) − Score(here) − (danger(there, AP left) − danger(here, AP held)) − STAharm − OA drawn
if above 0.


### Search

Any enemy that is detected through a passive sense or remembered can be pursued with tactical movement.

If no foe is seen, the bot lists its seen and unseen spaces and moves up to w.search AP towards the nearest unseen space: to the nearest cell it can reach from which that space is seen, or if none, as far towards it as it can. Allies never end a move farther than w.solitude from the nearest ally, unless the move brings you closer.

When a move stops on noticing someone new, the bot stands where it noticed them and compares that cell with the move's end, now that they are known: Tactical Score − danger(cell, AP held there). It stops if here is worth as much or more, else goes on.


## Strategies
Pick one each round, the one with the highest score.

Aggro = the target where: If the plan is to attack and my potential threat on the target is 0 here, read the walk to it as shorter by the distance it is out of range now: steps(cell) − (steps(here) − radius).

If Aggro is incapacitated, choose again.

### Attack
Aggro: the foe my immediate threat is highest on; with none, the one I'd harm most against an evasion. If my potential threat on it is 0 from here, read the walk as shorter (as now).
Score(cell) = w.aggro × potential threat(Aggro, me there) − potential exposure(me, there)

### Support

Ally: the party member, not me, with the highest potential exposure, that nobody supports yet. Aggro: the foe with the highest melee threat on it; with none, no Support.
Score(cell) = w.aggro × potential threat(Aggro, me there) − potential exposure(me, there) + value × (potential exposure(ally, without me) − potential exposure(ally, me there))

### Cover

If threat on me is from ranged attacks, 

# End of round

## Resting

recovery = maxSTA/2 x (1 - currentSTA/fullSTA)
  STA is worth 2 AP when STA < 3, less when it is more. 

Score = Exposure(self, 8AP) - Exposure(self, AP after resting + recovery) + threat(me, AP after resting + AP from recovery) - threat(me, 8 AP) + maxSTA/4 x w.STA x (1 - currentSTA/fullSTA) - bleed x w.IL x maxSTA/4  

If my potential threat on the target is 0 from here: threat(me, AP) = far threat at the cell AP walks me to along the way to the target, the same Score as Tactical

If Score = 0, rest if maxSTA/4 x w.STA x (1 - currentSTA/fullSTA)

# Misc

## Surges
- at 0 STA, only focus or recovery surges. The board enforces it anyways.
- no focus surge unless the action it opens is allowed.
- When an action involves multiple steps, execute all of them as one block. 

## simulation
- always 1 worker per simulation, max 10 workers.
- look at vscode autosave for simulations made by the player


# Constants

w.STA = 4
w.caution = 5
w.aggressivity = 0.5
w.IL = 2
w.bleed = 8
w.search = 4
w.solitude = 5
w.courage = 0.75
w.aggro = 1

