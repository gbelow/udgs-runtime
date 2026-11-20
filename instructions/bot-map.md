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

Two questions (the user's ruling): **now** (`planNow`: what to do now) and **later**
(`planLater`: how to better the position), asked only once nothing is to be done now.

```
threatBox (boxes/threat.ts)
│
├─ for each wait the table has on the seat
│   ├─ answer ──► answer()         attacked?      §7  defend / let it come
│   │                              ally attacked? §8  protect
│   │                              drew an OA?    §9  opportunity attack
│   ├─ turn ────► takeTurn()       asked again after every action (chains)
│   │              ├─ limit stress owed?           §11 violent / coward
│   │              ├─ now: planNow()               (no foe noticed: nothing now)
│   │              │    best of attack             §3  if score > 0
│   │              │         run from danger       §4.3 if danger > flee, score > margin
│   │              └─ later: planLater()
│   │                   ├─ planSwitch()            §6  change arms, if gain > margin
│   │                   ├─ no foe in sight/noticed §5  search
│   │                   └─ else best walk          §4  if score > stay + margin
│   ├─ rest ────► getRestChoice()                  §10 rest / rally / intimidate
│   └─ action / morale / concentration ──► settleWait (boxes/nearest.ts), HOP spend §12
│
├─ someone else's turn, still contestable: toggleContest for the member whose
│   planNow, on the fight as winning would leave it, scores most (anyone's turn)
├─ startTurn for the member whose planNow on the begun turn scores most; on the
│   'any' pass only, failing every member's, the one whose planLater scores most
└─ else, on the 'any' pass: carryOn: agree to end, roll held, pay, resolve, fill the first open choice
```

The seats are asked in passes (`seat.ts` `getMoves`): while a turn just taken is
contestable, every other seat first, for 'immediate' (then the table rolls the contest);
the seats the table waits on; the table; the other seats for 'immediate', and only then
for 'any'. On an 'immediate' pass only a `startTurn` or a `toggleContest` is taken; any
other decision counts as waiting.

Every threat and danger a decision reads is immediate or potential (§2 "Threat").

The tools under it, bottom up:

```
odds.ts ──► pairs.ts ──► threat.ts ──► approach.ts ──► boxes/threat.ts
(dice)      (harm table)  (threat, prices,  (opportunity     (scores, choices)
                          danger)           attacks drawn)
threatOldReading.ts: threat as the old box (boxes/threatOld.ts) reads it
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

### Defences against one attack (`threat.ts` `getAnswers`)

The defensive reactions the target may answer one attack with (taking it, a dodge, a block,
a parry…, as the attack's row in the pair table lists them), each with the harm it saves.
It chooses none of them: which one the target is believed to pick is §2 "Defended harm".

```
undefended = harm(attack, taking it, gap)                   the harm taking it does
for each defence d:  value(d) = undefended − harm(attack, d, gap)   the harm d saves
                     affordable(d) = d.AP ≤ budget.AP and d.STA ≤ budget.STA
                                     the defender can pay for it
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

### Threat: immediate and potential (`threat.ts` `getPairThreat`, `makeThreat`, `threatValue`)

Every threat and danger a decision reads is one of two (the user's ruling):

- **Immediate**: what a foe can do to me before this round ends, with the AP and STA it has
  left (its reach counting the movement surge, AGI's, while it has made none), against the AP
  I have left to defend. It answers "what now": attack, run, react, and what spending leaves
  me in.
- **Potential**: what a foe could do to me in a fresh round (its whole AP, a surge open),
  against a fresh round's guard. It answers "where to be next round": stand where my
  potential threat on foes is largest and theirs on me least, and judge an advance.

The pair threat (`getPairThreat`), read once for a pair of sheets and kept while neither
changes in anything but what it has left (the user's ruling: only harm and cost, and
every attack, to be read in many ways):

```
for every attack of a's on d:
    answers    = every defence d could answer with, the harm each leaves (§1)
    worth      = DefendedHarm(attack, 10 m, a fresh round's guard)   the defence d is
                 believed to pick; a shot read from 10 m (one penalty level, inside the
                 10 to 30 m most shots are fired from); the test a has set, safe or risky
    perAP      = worth / attack AP
```

On top of it, where the two stand and what they have left (`makeThreat`):

```
attack      = getStrongestPerAP: the highest perAP among those a can declare on its turn
              (not one only a reaction makes) that do d some harm undefended
threat      = that attack, moveAP, strikes
threatValue = strikes · worth                                   with no guard given
            = k · worth + (n − k) · undefended                  with `guard`: n strikes,
              k = min(n, guard.AP / defence AP, guard.STA / defence STA), the guard
              spent across them
```

|                    | potential                              | immediate                                  |
| ------------------ | -------------------------------------- | ------------------------------------------ |
| attacker's means   | `ROUND_AP`, surge open, its STA        | what it has, or is believed to have        |
| target's guard     | none (every strike answered)           | what it has, or is believed to have        |
| strikes            | see below                              | see below; not counted below 1             |

```
strikes (potential) = the attacks a fresh round's AP and STA pay for once the walk in is
                     paid, the movement surge paying for the walk first unless the row
                     needs focus; not counted (no threat) below 1, so a foe further off
                     than a round's walk and one attack is under no potential threat
                     (the user's ruling: §4's pull goes after it)   (getPotentialStrikes)
strikes (immediate) = the most strikes of the attack's AP and STA its means pay for this round
                     after the walk in (the user's ruling: a threat counts the attacker's AP,
                     ours as a foe's), whichever way pays for most   (getImmediateStrikes):
           AP − moveAP                                                     no surge
           AP − max(0, moveAP − movement surge AP), STA less the surge's   movement surge
           AP + combat surge AP − moveAP, STA less the surge's             combat surge
                     no surge alongside the focus surge a row needs

moveAP   = ceil(steps / pace.metres) · pace.AP
pace     = the open movement with the best metres per AP
steps    = cells walked to stand within reach (step map, a fresh round deep, no jumps
           or climbs; shots also need a line of fire from the cell, strikes a melee
           gap within reach as the table measures it: around walls, and the metres
           up or down between the two counted as cells)
```

What walking in on `d` draws from it is not in the threat: a walk or an attack of the
character's own prices the opportunity attacks it draws where it is weighed (§3, §4.1).

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
Danger(me, kind, at, guard) = pile_foe threatValue(threat foe → me at `at`, guard) / share(foe)
                              guard: immediate, what I have left (or `guard`); potential, none
HarmDanger(me, at, guard)   = pile_foe (k · harm + (n − k) · undefended) / share(foe)
                              the harm alone, nothing of what the answer costs
pile_foe x                  = max_foe x + w.pile · (Σ_foe x − max_foe x)   (pileUp)
                              w.pile 1: every foe's whole (the user's ruling: each foe pays
                              for its strikes with AP of its own; my threat on foes stays the
                              best one, my AP being one pool); `guard` answers each foe's
                              strikes whole
share(foe)                  = (1 + the others of my side foe threatens where they stand)^w.share
                              (shareOf): a foe with several in reach strikes each less
Threatened(foe)             = Σ_team threatValue(potential member → foe)
Threatening(foe)            = max_team threatValue(potential foe → member)
```

In `HarmDanger` the attack is the foe's immediate threat on me at `at` and `d` the answer I
would choose with `guard`; the foe makes it `n` times and I answer `k` of them
(`getHarmDanger`):

```
n = the immediate threat's strikes (§2)
k = min(n, guard.AP / d.AP, guard.STA / d.STA)   rounded down; n for a free answer
```

Which each decision reads:

| decision                          | immediate                                   | potential                          |
| --------------------------------- | ------------------------------------------- | ---------------------------------- |
| attack (§3)                       | its gain; danger left after (AP's price)    | target worth (Threatened, Threatening) |
| run from danger (§4.3)            | danger now, danger at the cell              |                                    |
| walk (§4)                         | AP's price, danger on arrival, allies kept  | standing (offence, peril), pull    |
| search (§5)                       |                                             |                                    |
| change of arms (§6)               |                                             | offence, peril                     |
| defend, protect, OA (§7, §8, §9)  | the attack met; danger left after (AP's price) |                                 |
| rest (§10), coward's getaway (§11) |                                            | danger                             |

---

## 3. Attack on the turn, a question of now (`boxes/threat.ts` `planAttack`, `getAttackMeasures`)

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
offence lost    = w.offence · max(0, mine now − mine after − worth)  to self
                  mine = max_foe threatValue(immediate me → foe): now where it stands with
                  all it holds, after at the cell with what is held (the budget's surge made)
allies' lost    = kept − keeping(cell, AP held of its own)         to allies
STA             = STAPrice(STAspent + surgeSTA, my STA, my bleed)

score = gain − defence lost − offence lost − allies' lost − STA
      − w.opportunity · OAs the walk draws (§4.1)
      − w.opportunity · OAs a shot draws from where it is fired   (shots)

make it if score > 0   (or always, if compelled: violent)
```

Candidate cells (`getAttackCells`): where it stands if it reaches; of the walk's cells that
reach, the 2 cheapest and the 2 with the least `Danger(immediate, cell)`; shots keep only
cells with a line of fire, strikes only cells whose melee gap the table measures within
reach (`getStrikeCells`: walls, and height between the two).

Walks weighed (`getWalks`), here and in §4 and §5: one at each of walk and run that is open,
and one at the fastest movement open (so one who can only swim, climb or crawl still has
one); every candidate cell is tried at each, with that walk's AP and STA, and the move is
declared at its movement. The coward's getaway (§11) walks at the fastest movement only.

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

## 4. Walk when nothing is to be done now (`boxes/threat.ts` `planWalk`)

```
standing(cell) = w.offence · max_foe threatValue(potential me → foe, me at cell)
               − w.peril   · Danger(me, potential, cell)
               − w.company · max(0, metres to nearest ally − 1)

pull(cell)     = w.aggression · max over foes under no potential threat from here
                 of (cells from here to the foe − cells from the cell to the foe)

walk(cell)     = standing(cell) + pull(cell)
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

### 4.3 Run from danger (`boxes/threat.ts` `planFlee`), a question of now

```
now       = Danger(me, immediate, here, all it holds)
only when now > w.flee
after     = Danger(me, immediate, cell, AP/STA left after the walk)
run(cell) = now − after − SpendPrice(walk AP, walk STA + surgeSTA, after) − w.opportunity · OAs drawn

run if best run(cell) > w.margin; against the best attack, the higher score is made
```

Candidate cells: `getDirectedCells` with no foe or ally to close on, so the `AWAY` cells
furthest from the foe whose immediate threat on it is worst.

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

declare the first move of the best switch if gain > w.margin, among the switches whose
every move the table takes, each asked from the sheet the moves before it leave (a surge's
AP may not pay for every gear move)
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
violent                      → planViolent (attack whatever its score, else walk)
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
    abilities = only those seen used this fight, with what they require, and Archer,
                which every face is taken to have (the user's ruling)
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
| `AP`          | 3         | APPrice (not in §3: an attack's AP is its defensive potential) |
| `danger`      | 0.1       | APPrice: per point of danger left             |
| `STA`         | 3         | STAPrice                                      |
| `STAScale`    | 10        | STAPrice                                      |
| `forcing`     | 0.25      | DefendedHarm: per point the defence takes off |
| `opportunity` | 1         | §3, §4, §6 OAs drawn                          |
| `end`         | `'middle'`| fromThird: which end of a face's third, or its middle |
| `pile`        | 1         | Danger, HarmDanger: share of every foe's threat but the worst |
| `share`       | 0         | Danger, HarmDanger: a foe's threat divided among those it threatens |

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
| `offence`     | 1       | §3 offence lost, §4 standing, §6                        |
| `peril`       | 1       | §4 standing, §6                                         |
| `aggression`  | 4       | §4 pull per cell nearer a foe out of reach, §5 per cell nearer the middle |
| `arrival`     | 1       | §4 immediate danger at the cell walked to               |
| `search`      | 1       | §5 per cell newly seen                                  |
| `margin`      | 1       | §4, §4.3, §5, §6 must beat by                           |
| `flee`        | 10      | §4.3 immediate danger it must be in to run now          |
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
| `MAP_ROUNDS`                    | 1       | threat.ts step map depth          |
| `BALLPARK`                      | 3       | belief.ts                         |
| `QUIVER`                        | 20      | belief.ts (gear.tex "Quiver")     |

---

## The other box

`nearestBox` (`boxes/nearest.ts`) is the baseline: walk to the nearest foe, attack it with
the first row the table takes, focus if only a focused shot is left, pass every answer,
spend overflow as §12. No formula beyond distance.

The old box (`boxes/threatOld.ts`, `--box old` in `pnpm arena`) is the threat box as it
was before §0's two questions: a change of arms weighed first, then an attack, then a walk,
and the first member with anything to do starting the turn, reading threat as it was
read before the pair threat (`threatOldReading.ts`: the best attack read for every cell and
guard, the walk in's opportunity attacks counted, the worst foe's danger alone). It is kept
only to play the threat box against; its formulas are not mapped here. Its rest step
(§10) reads `rest.ts`, shared with the threat box.






This is the attack formula as the code computes it (boxes/threat.ts:574, with the scoring parts in getAttackMeasures at :446).

What it tries. Every combination of:

budget (no surge, combat surge, movement surge);
walk (walk, run, or the fastest movement open);
foe it notices;
attack it can declare on its turn;
cell to attack from: where it stands if in reach; otherwise, of the cells in reach, the 2 cheapest to walk to and the 2 with the least immediate danger.
It keeps the combination with the highest score, and attacks only if that score is above 0:


score = gain − defence lost − offence lost − allies' lost − STA − drawn
gain, what the hit is worth:


gain   = w.harm · worth · (1 + target / 100)            100 = a life
worth  = the harm left by the defence the target is believed to pick
       + what that defence costs the target (its AP and STA, priced)
       + w.forcing · the harm that defence takes off
target = w.threatened · Σ my side's potential threat on the target
       + w.threatening · the target's worst potential threat on anyone of my side
defence lost, how much worse defended I am after spending:


defence lost = w.reserve · (HarmDanger at the cell with what I'm left
                            − HarmDanger here with everything I hold) / max(1, AP left)
HarmDanger   = Σ over foes: of their n strikes, I answer k with what I hold,
               k at the harm my defence leaves, n − k undefended
offence lost, what I'm giving up of later attacks:


offence lost = w.offence · max(0, my threat now − my threat at the cell with what I'm left − worth)
my threat    = max over foes of my immediate threat value (strikes · worth)
allies' lost, cover I can no longer give:


allies' lost = the protection I could give allies standing here with all my AP
             − the protection I can give from the cell with the AP I keep     (§4.2)
STA, the stamina spent:


STA = (walk + attack + surge STA) · (w.STA · 10 / max(1, STA left) + 2 · bleed)
drawn, opportunity attacks I walk into:


drawn = w.opportunity · (opportunity attacks the walk draws, answered out of my AP)
      + for a shot: opportunity attacks from foes whose reach covers the cell I fire from
Weights now: harm 1, threatened 0.6, threatening 0.2, forcing 0.25, reserve 10, offence 1, guardian 1, STA 3, opportunity 1.

Things to notice if you want to change it:

AP has no price of its own. Spending AP costs only through defence lost and offence lost. If neither changes, for example when no foe can reach me, AP is free.
Defence lost is divided by the AP I keep. The fewer AP I keep, the more each point of danger counts. That's what stops the bot from spending its last AP, but the scale is odd: keeping 1 AP gives ten times the penalty of keeping 10.
Offence lost subtracts the attack's own worth. Attacking now only "loses" offence beyond what the attack itself delivers. So an attack whose worth covers the threat it gives up costs nothing on this count.
The target's value is in potential terms. A foe who threatens us a lot next round is worth more to hit now.
It plans one attack at a time. After each attack the turn is re-planned, so "attack twice" is never valued as a pair.