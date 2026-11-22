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

## Positional

- Reposition
- Switch weapon

## Round end
- Social actions and rest
- limit stress action

## Guard
 never pick an option believed to leave you collapsed or dead this round.


# Primitives

## harm
- harm = w.IL · IL + w.bleed · bleed

## Expected harm (`odds.ts` `getExpectedHarm`)

E[harm] = Σ_face p(face) · { hits[min(over − 5, last)] if over ≥ 5,  graze if 0 ≤ over < 5 and the attack grazes, miss otherwise }

over(face) = face + skill − DL
`hits[h]` is the harm at HOP `h`, with the overflow spent as §11 spends it.
ranged attacks use 20m when distance is not specified.

## Skill at a distance (`threat.ts` `getSkillAt`)

skill(gap) = skill − distancePenalty(rate, min(gap, reach))  

## Harm against a defence (`threat.ts` `getHarmAgainst`)

harm(attack, defence, gap) = E[harm](skill(gap), defence.DL, grazes, mode, harm table vs defence)
mode 'now'  = how the attacker throws now
mode 'best' = max over the modes it may throw

## Defences against one attack (`threat.ts` `getAnswers`)

undefended = harm(attack, taking it, gap)                   the harm taking it does

Defense value = undefended − harm(attack, d, gap)   the harm d saves
affordable(d) = d.AP ≤ budget.AP and d.STA ≤ budget.STA - only if the defender can pay for it

## Threat
How much danger a character is in at its current position.

- Immediate threat: how much damage a character can receive now if staying here: sum of { E[harm]/10 x (current AP - distance to reach/movement speed(rounded up)) } for everyone that can attack you.
- Potential threat: how much damage a character can take on a fresh round if staying here: sum of { E[harm]/10 x (10 AP - distance to reach/movement speed(rounded up)) } for everyone that can attack you

Create a threat map. Each character has their share cached separately. 
Calculate distance as the character would run, if they can run. Otherwise consider walk.

## Cost

STAharm = w.STA x STA + w.IL x STA x bleed

Offensive Cost = w.caution x(w.AP x ( w.baseAPcost + delta immediate threat of opponents(after - before)) + STAharm )
Defensive Cost = w.caution x(w.AP x (delta immediate threat of opponent(after - before)) + STAharm)


## Face. What a seat knows (`belief.ts` `getBelief`)

own members:         full sheet

everyone else seen:  the face, with attributes and skills = floor(real / 3) · 3 talents, proficiencies = empty
  abilities = only those seen used this fight, with what they require, and Archer, which every face is taken to have (the user's ruling)
  AP, STA   = fillThird(third shown)
  a quiver of 20 for every held weapon that shoots

  Remember face when doesnt detect anymore. Refresh when seen again. Remember position. Fade position per round, maximum 2 rounds.

# Attacking

Choose the target with the highest score.

Score= Expected harm(assume the defense the target would take) + delta immediate threat on opponent(after - before) - Offensive Cost - OA drawn

##  Spending a hit's overflow (`predict.ts` `getBestSpend`)

Assassinate always bought when available

Try all in smash
Try Bust + rest in slice
Any remainder goes into smash
Highest Tier or damage wins. On a draw, prefer smash.

# Defend

Pick largest of: Score = Defense value - Defensive cost. Taking the hit is an option. 

# Escape

allies = Number of party members within 5m at the departure location.

Score = (threat on me here − threat on me there) / w.courage − allies × w.teamwork - STAharm - OA drawn
  
  if score beats alternatives, move towards place with the lowest immediate threat.
  threat on me there counts after AP expense.


# Reposition

Prefers aggro to aggro if w.aggro = 1, and the opposite if it is 0. 

## Tactical

Move to place where Score = max(ally potential threat - enemy potential threat)

Decide to reposition if score difference - Offensive cost > 0.

## Aggro

Pick the target who is detected and has the highest E[harm]. If E[harm] > w.retarget x E[harm] of every enemy against whom there is potential threat, move towards the new target. 

Pick the movement type where Defensive Cost is minimal, escape is not triggered and the character is closer to the target.

## Search

Any enemy that is detected through a passive sense or remembered can be pursued with aggro.

If no foe is seen, the bot lists its seen and unseen spaces and moves up to w.search AP towards the nearest unseen spaces. Allies never end a move farther than w.solitude from the nearest ally, unless the move brings you closer.

# Misc

## Surges
- at 0 STA, only focus or recovery surges. The board enforces it anyways.
- no focus surge unless the action it opens is allowed.


# Constants

w.STA = 2
w.AP = 2
w.caution = 1
w.IL = 2
w.bleed = 5
w.search = 4
w.solitude = 10
w.retarget = 2
w.courage = 1
w.teamwork = 1
w.baseAPcost = 1
w.aggro = 0






