# Bot decision map

Every formula a bot decides with, one screen per question, with the weights it reads and
the file and function that hold it. It describes the code as it stands: when this map and
the code disagree, the code wins, so fix the map in the same change that moves a formula
or a weight.

Notation: `w.x` is a weight (table at the end), `foe`, `ally`, `me` are characters,
`Σ` sums and `max` takes the largest over what follows. A "price" is what spending costs
the spender; a "worth" is what something costs or gains, in harm points.

---

## 0. Where a decision comes from

```
threatBox (boxes/threat.ts)
│
├─ for each wait the table has on the seat
│   ├─ answer ──► answer()         attacked?      §7  defend / let it come
│   │                              ally attacked? §8  protect
│   │                              drew an OA?    §9  opportunity attack
│   ├─ turn ────► takeTurn()
│   │              ├─ limit stress owed?           §11 violent / coward
│   │              ├─ planSwitch()                 §6  change arms, if gain > margin
│   │              └─ planTurn()
│   │                   ├─ no foe in sight/noticed §5  search
│   │                   ├─ best attack             §3  if score > 0
│   │                   └─ else best walk          §4  if score > stay + margin
│   ├─ rest ────► getRestChoice()                  §10 rest / rally / intimidate
│   └─ action / morale / concentration ──► settleWait (boxes/nearest.ts), HOP spend §12
│
├─ startTurn pressed only if planTurn or planSwitch would do something on the begun turn
└─ else carryOn: agree to end, roll held, pay, resolve, fill the first open choice
```

The tools under it, bottom up:

```
odds.ts ──► pairs.ts ──► threat.ts ──► approach.ts ──► boxes/threat.ts
(dice)      (harm table)  (threat, prices,  (opportunity     (scores, choices)
                          danger)           attacks drawn)
belief.ts: what the seat may know of everyone else (feeds the `view` all of it reads)
```

---

## 1. Primitives

### Harm of an outcome (`pairs.ts` `getHarm`)

```
harm = 2 · IL + 5 · bleed
```

### Face odds (`odds.ts` `getFaceOdds`)

```
normal: p(face) = 0.1 for 0..9
safe:   two d10, keep the one closest to 5
risky:  two d10, keep the one farthest from 5
        (two different faces equally far from 5 are thrown again)
```

### Expected harm of one test (`odds.ts` `getExpectedHarm`)

```
over(face) = face + skill − DL

E[harm] = Σ_face p(face) · { hits[min(over − 5, last)]   if over ≥ 5
                             graze                        if 0 ≤ over < 5 and the attack grazes
                             miss                         otherwise }
```

`hits[h]` is the harm at HOP `h`, with the overflow spent as §12 spends it.

### Skill at a distance (`threat.ts` `getSkillAt`)

```
skill(gap) = skill − distancePenalty(rate, min(gap, reach))      shots only
```

### Harm against a defence (`threat.ts` `getHarmAgainst`)

```
harm(attack, defence, gap) = E[harm](skill(gap), defence.DL, grazes, mode, harm table vs defence)
mode 'now'  = how the attacker throws now
mode 'best' = max over the modes it may throw
```

### Answers (`threat.ts` `getAnswers`)

```
undefended = harm(attack, none, gap)
for each defence d:  value(d) = undefended − harm(attack, d, gap)
                     affordable(d) = d.AP ≤ budget.AP and d.STA ≤ budget.STA
```

---

## 2. Prices and the worth of an attack

### Spending (`threat.ts`)

```
APPrice(AP, danger)        = AP · (w.AP + w.danger · danger)
STAPrice(spent, held, bl)  = spent · (w.STA · w.STAScale / max(1, held − spent) + 2 · bleed)
SpendPrice(cost, …)        = APPrice + STAPrice
```

With the defaults: an AP costs `3 + 0.1 · danger`; an STA costs `30 / (STA left after)`,
plus 2 per point of bleed. A gained STA is worth the same price read for the pool it ends in.

### Defended harm: what an attack is worth (`threat.ts` `getDefendedHarm`)

The target is believed to choose, among affordable answers (none included), the one that
leaves it the least harm and price together:

```
cost(d)   = harm(attack, d) + SpendPrice(d.cost, target STA, target bleed, dangerAfter(d))
chosen    = argmin cost(d) over affordable d
worth     = cost(chosen) + w.forcing · value(chosen)
```

`dangerAfter(d)` is the target's own immediate danger (§2.4) once it has paid for `d`;
inside threat reading itself it is left at 0.

### Threat value (`threat.ts` `threatValue`, `bestAttack`)

```
threatValue = max(0, worth − w.opportunity · approach) · w.ring2 ^ max(0, rounds − 1)
```

Best attack of `a` on `d` = the attack with the highest `threatValue`, among those that open
as an action and have `undefended > 0`.

|                  | potential                         | immediate                                |
| ---------------- | --------------------------------- | ---------------------------------------- |
| attacker's means | `ROUND_AP`, surge open, its STA   | what it has, or is believed to have      |
| target's guard   | `ROUND_AP`, its STA               | what it has, or is believed to have      |
| mode             | best                              | now                                      |
| rounds           | see below                         | 1 if payable now, else not counted       |

```
rounds (potential) = max(1, (moveAP + attack.AP) / (ROUND_AP + movement surge AP))
                     the surge AP left out if the row needs focus
payable now        = with its own AP, or after the movement surge (its AP for the walk, what
                     is left of it given up for the attack) or the combat surge

moveAP   = ceil(steps / pace.metres) · pace.AP
pace     = the open movement with the best metres per AP
steps    = cells walked to stand within reach (step map, 4 fresh rounds deep, no jumps
           or climbs; shots also need a line of fire from the cell, strikes a melee
           gap within reach as the table measures it: around walls, and the metres
           up or down between the two counted as cells)
approach = OA worth the walk in draws from d   (when a can pay this round and gap > reach)
         + OA worth of shooting within d's reach (shots)
         capped at d's own uncapped potential threat on a
```

A pair is skipped when `a` cannot reach `d` in the step map and has someone else it can.

What a seat believes of a face (`threat.ts` `fromThird`, `w.end = 'middle'`):
```
least  = 0                          if the third shown is 0
         floor(most · third / 3) + 1 otherwise
most   = floor(most · (third + 1) / 3)
middle = round((least + most) / 2)
```

### Danger and target worth (`threat.ts`)

```
Danger(me, kind, at, guard) = max_foe threatValue(threat foe → me at `at`)
HarmDanger(me, at, guard)   = max_foe (k · harm(attack, d) + (n − k) · undefended − w.opportunity · approach)
                              the harm alone, nothing of what the answer costs
Threatened(foe)             = Σ_team threatValue(potential member → foe)
Threatening(foe)            = max_team threatValue(potential foe → member)
```

In `HarmDanger` the attack is the foe's immediate threat on me at `at` and `d` the answer I
would choose with `guard`; the foe makes it `n` times and I answer `k` of them
(`getStrikes`, `getHarmDanger`):

```
n = max(1, most strikes of the attack's AP and STA the foe is believed to pay for this round:
           AP − moveAP                           no surge
           AP − max(0, moveAP − movement surge AP), STA less the surge's   movement surge
           AP + combat surge AP − moveAP, STA less the surge's             combat surge)
k = min(n, guard.AP / d.AP, guard.STA / d.STA)   rounded down; n for a free answer
```

---

## 3. Attack on the turn (`boxes/threat.ts` `planTurn`, `getAttackMeasures`)

With no foe noticed, the turn searches instead (§5). Otherwise tried for every budget (no
surge, combat surge, movement surge), every foe noticed, every attack that opens as an
action, from every candidate cell.

```
spent, STAspent = walk + attack
held            = what the budget leaves after the walk, the attack and the OAs answered
worth           = DefendedHarm(attack, gap, foe's guard, dangerAfter = foe's own danger)
target          = w.threatened · Threatened(foe) + w.threatening · Threatening(foe)
after           = HarmDanger(me, cell, held)                        (§2: every strike the foe affords)
now             = HarmDanger(me, here, all it holds)
kept            = keeping(here, all its AP)                        (§4.2)

gain            = w.harm · worth · (1 + target / 100)            100 = a life (2 per IL, death at 50)
defence lost    = (after − now) · w.reserve / max(1, held.AP)       to self
allies' lost    = kept − keeping(cell, AP held of its own)         to allies
STA             = STAPrice(STAspent + surgeSTA, my STA, my bleed)

score = gain − defence lost − allies' lost − STA
      − w.opportunity · OAs the walk draws (§4.1)
      − w.opportunity · OAs a shot draws from where it is fired   (shots)

make it if score > 0   (or always, if compelled: violent)
```

Candidate cells (`getAttackCells`): where it stands if it reaches; of the walk's cells that
reach, the 2 cheapest and the 2 with the least `Danger(immediate, cell)`; shots keep only
cells with a line of fire, strikes only cells whose melee gap the table measures within
reach (`getStrikeCells`: walls, and height between the two).

Budgets (`getBudgets`, `canPay`):
```
surgeSTA = STA the surge takes + STA the recovery surge would have given back
heldAP   = max(0, min(AP − spent, AP − surgeAP))      surge AP is lost at turn end
canPay   = walk + attack ≤ AP held, surge's included
```

Whether the attack opens is the table's to say (`opensAfter`), read where the walk leaves the
character (`arrivedAt`: at the cell, the walk's AP and STA spent, the surge's first):
```
open      the table takes it as it stands (a surge's AP may pay for it: Charge)
givingUp  the table takes it only once the surge's AP left is given up ("end surge");
          made only if its own AP left pays for it, and the turn presses "end surge" first
neither   not made
```

---

## 4. Walk when no attack is worth it (`boxes/threat.ts` `planTurn`)

```
standing(cell) = w.offence · max_foe threatValue(potential me → foe, me at cell)
               − w.peril   · Danger(me, potential, cell)
               − w.company · max(0, metres to nearest ally − 1)

pursuit(cell)  = max_foe perAP(foe) · max(0, moveAP(here → foe) − moveAP(cell → foe))
perAP(foe)     = w.aggression + w.chase · Threatening(foe) / ROUND_AP

walk(cell)     = standing(cell) + pursuit(cell)
               − SpendPrice(walk AP, walk STA + surgeSTA, Danger(me, immediate, cell, AP/STA − walk))
               − w.opportunity · OAs drawn on the way
               − w.arrival · Danger(me, immediate, cell, AP/STA left after the walk)
               + keeping(cell, AP held of its own)

stay           = standing(here) + kept

walk if best walk(cell) > stay + w.margin
```

Candidate cells (`getDirectedCells`): per foe, the 3 cells that close most on it and the
closest cell of each AP block (so a walk may stop short); the 3 cells farthest from the
foe with the worst potential threat; per ally, the 3 cells that close most on it.

### 4.1 Opportunity attacks drawn (`approach.ts`)

```
walk:  Σ_holder best strike it can pay for that opens on a step (or on a run/jump if running),
       met at the step getApproachStep says it draws,
       worth = DefendedHarm(strike, distance at that step, my guard)
       distances along the walked path, or straight a metre a step when no path is known
shot / priced gear move:  Σ_holder best strike opening on a step with reach ≥ gap
```

The AP and STA the walker spends answering them come off what it has left (§3 `held`).

### 4.2 Keeping AP for allies (`getProtections`, `getKeeping`)

For every ally under a foe's immediate strike threat:
```
toMe  = DefendedHarm(same strike on me, at its reach)
skip unless threat.worth − toMe > w.cover
bare  = harm(same strike on me, none)
for each block / intercept d:
    left = threat.undefended · harm(strike on me, d) / bare
    gain = threat.worth − left − SpendPrice(d.cost, my STA, my bleed, 0)

keeping(cell, AP) = w.guardian · max gain over protections with d.AP ≤ AP
                    and cell on the protect line
```

---

## 5. Search when no foe is seen or noticed (`boxes/threat.ts` `planSearch`)

Also when every foe in the view is one the character does not notice (the user's ruling).

```
score(cell) = w.search · cells it would see that nobody of the side sees
            + w.aggression · (dist(here, board middle) − dist(cell, board middle))
            − SpendPrice(walk AP, walk STA + surgeSTA, danger 0)

walk if best score > w.margin
```
12 cells of the walk spread from the furthest; dark board sampled to at most 240 cells.

---

## 6. Change of arms (`boxes/threat.ts` `planSwitch`, `arms.ts`)

```
offence = max_foe threatValue(potential me → foe)
peril   = Danger(me, potential, here)

gain = w.offence · (offence_after − offence_now)
     − w.peril   · (peril_after − peril_now)
     − SpendPrice(switch AP, switch STA, danger)
     − (priced moves in the switch) · w.opportunity · OAs standing here draws

declare the first move of the best switch if gain > w.margin
```

---

## 7. Answering an attack on me (`boxes/threat.ts` `answer`)

A shot at me from within my reach: the opportunity attack first (§9), if worth making.

```
none:      score = harm(attack, none at DL)
defence d: score = harm(attack, d at DL)
                 + SpendPrice(d.cost, my STA, my bleed, Danger(me, immediate, here, after paying))
                 + (someone else already guards me ? w.redundant : 0)

DL = the attack's DL with every declared defence counted (when someone else guards),
     else the pair table's DL for d
answer with the lowest score
```

An attack whose arrows or variant the seat does not know is read as the worst row of its
kind (`getKnownAttack`).

---

## 8. Protecting an ally (`boxes/threat.ts` `protect`)

Only when nobody guards the ally yet and the ally has not reacted.

```
toAlly = DefendedHarm(attack on ally, ally's means)
toMe   = DefendedHarm(same attack on me, my means)
skip unless toAlly.worth − toMe > w.cover

for each block / intercept / guard offered:
    score = harm left on the ally at the DL the table gives with it declared
          + SpendPrice(cost, my STA, my bleed, Danger(me, immediate, here, after paying))

make the lowest if score < toAlly.worth
```

---

## 9. Opportunity attack I draw (`boxes/threat.ts` `opportunity`)

```
for each row the draw opens, each heavy degree:
    score = AttackScore.total (§3, with no walk, no OA drawn, no keeping)
make the best if score > 0
```

---

## 10. Round's rest step (`rest.ts` `getRestChoice`)

```
back      = STA the rest gives back
STAworth  = STAPrice(back, STA + back, 0)
danger    = Danger(me, potential)
overdraw  = SpendPrice({ AP: ROUND_AP − min(ROUND_AP, AP − cost) }, STA, bleed, danger)

rest:   worth = STAworth − overdraw
social: worth = STAworth + w.restSay · socialValue − overdraw
        rally first if w.rallyFirst > 0 or an ally is at MORALE_TRIGGER pressing factors,
        else intimidate first; skipped if the team said it as strongly this round

take the best if worth > 0
```

---

## 11. Limit stress turn (`boxes/threat.ts` `takeStressTurn`)

```
social stress action owed    → default to coward
a surge owed                 → rest first if needed, then make it
violent                      → planTurn compelled (attack whatever its score)
coward (surge AP left)       → getAway: walk to the cell of least Danger(potential)
otherwise                    → end turn
```

---

## 12. Spending a hit's overflow (`predict.ts` `getBestSpend`)

Tried: all in smash; if it carries a cut, n slices + rest in smash for every n; bust + the
same; each again with the braced or hook bonus bought.

```
best = lexicographic max of (highest injury tier, sum of tiers, damage − armor)
```

The pair table (§1 `hits`) and the landing both spend this way.

---

## 13. What a seat knows (`belief.ts` `getBelief`)

```
own members:         full sheet
everyone else seen:  the face, with
    attributes and skills = floor(real / 3) · 3
    talents, proficiencies = empty
    abilities = only those seen used this fight, with what they require
    AP, STA   = fillThird(third shown)
    a quiver of 20 for every held weapon that shoots
```

Threat reading of a face uses `fromThird` with `w.end` (§2) for what it has left.

---

## Weights

A box is made with its weights (`threatBox(w)`), and every function that reads one takes them
as a required argument, never a default, so a call that forgets them does not compile. The
tables the weights do not touch (pairs, harms, step maps) are shared by every bot; those
they do are kept per weights.

`THREAT_TUNING` (`threat.ts`), shared by every box:

| weight        | default   | read in                                       |
| ------------- | --------- | --------------------------------------------- |
| `ring2`       | 0.5       | threatValue: per round beyond the first       |
| `AP`          | 3         | APPrice (not in §3: an attack's AP is its defensive potential) |
| `danger`      | 0.1       | APPrice: per point of danger left             |
| `STA`         | 3         | STAPrice                                      |
| `STAScale`    | 10        | STAPrice                                      |
| `forcing`     | 0.25      | DefendedHarm: per point the defence takes off |
| `opportunity` | 1         | threatValue approach; §3, §4, §6 OAs drawn    |
| `end`         | `'middle'`| fromThird: which end of a face's third, or its middle |

`REST_TUNING` (`rest.ts`) adds:

| weight       | default | read in                        |
| ------------ | ------- | ------------------------------ |
| `restSay`    | 2       | §10, per point of social value |
| `rallyFirst` | 0       | §10, > 0 puts rallies first    |

`THREAT_WEIGHTS` (`boxes/threat.ts`) adds:

| weight        | default | read in                                                 |
| ------------- | ------- | ------------------------------------------------------- |
| `harm`        | 1       | §3 worth multiplier                                     |
| `threatened`  | 0.6     | §3 target: team's threat on the foe                     |
| `threatening` | 0.2     | §3 target: foe's threat on the team                     |
| `offence`     | 1       | §4 standing, §6                                         |
| `peril`       | 1       | §4 standing, §6                                         |
| `aggression`  | 4       | §4 pursuit per AP saved, §5 per cell nearer the middle  |
| `chase`       | 1       | §4 pursuit, per point of foe's Threatening per round AP |
| `arrival`     | 1       | §4 immediate danger at the cell walked to               |
| `search`      | 1       | §5 per cell newly seen                                  |
| `margin`      | 1       | §4, §5, §6 must beat by                                 |
| `cover`       | 0       | §4.2, §8 ally's threat over mine                        |
| `redundant`   | 5       | §7 own defence when someone guards                      |
| `company`     | 1       | §4 per metre from nearest ally beyond the next cell     |
| `guardian`    | 1       | §4.2 AP kept for allies                                 |
| `reserve`     | 10      | §3 defence lost, over the AP held                       |

Fixed counts (not weights):

| constant                        | value   | file                              |
| ------------------------------- | ------- | --------------------------------- |
| `TOWARDS`, `AWAY`               | 3, 3    | boxes/threat.ts walk candidates   |
| `ATTACK_CELLS`                  | 2       | boxes/threat.ts attack candidates |
| `SEARCH_CELLS`, `SEARCH_SPREAD` | 12, 240 | boxes/threat.ts search            |
| `MAP_ROUNDS`                    | 4       | threat.ts step map depth          |
| `BALLPARK`                      | 3       | belief.ts                         |
| `QUIVER`                        | 20      | belief.ts (gear.tex "Quiver")     |

---

## The other box

`nearestBox` (`boxes/nearest.ts`) is the baseline: walk to the nearest foe, attack it with
the first row the table takes, focus if only a focused shot is left, pass every answer,
spend overflow as §12. No formula beyond distance.
