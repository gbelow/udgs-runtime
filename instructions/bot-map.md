# Bot decision map

Every formula a bot decides with, one screen per question, with the weights it reads and
the file and function that hold it. It describes the code as it stands: when this map and
the code disagree, the code wins, so fix the map in the same change that moves a formula
or a weight.

Notation: `w.x` is a weight (table at the end), `foe`, `ally`, `me` are characters,
`Σ` sums and `max` takes the largest over what follows. A "price" is what spending costs
the spender; a "worth" is what something costs or gains, in harm points.

Start with "Reading a decision" below: what each question adds and takes off, in words, with
the numbers of one real decision. Sections 0 to 12 after it are the reference, formula by
formula. `bot-map-short.md` is the same as a page of equations, for reading, not for
reference.

---

## Reading a decision

Everything is in **harm**: 2 a point of IL, 5 a point of bleed (§1), so a character at its
injury capacity of 50 IL has taken about 100. Every score is a gain over doing nothing, so
anything above 0 (above `margin`, 1, for a walk or a run) is worth doing. A bot log line
quotes the score and its parts.

The example numbers below come from one saved fight (2026-11-22): a Human Noble (warhammer,
8 AP, 10 STA, no bleed) 11 m from a Human Ranger on open ground. They show the size of each
term, not a rule.

### What a character is worth to a foe: threat (§2)

| part | reads | example |
| --- | --- | --- |
| worth of one attack | the harm it leaves against the defence the target is believed to pick, plus what that defence costs the target | hammer, heavy II (5 AP, 1 STA): 65.7 |
| strikes | how often the strongest attack per AP fits in the round once the walk in is paid (the movement surge pays for the walk first) | 1 from 11 m away, 1 beside |
| fillers | the AP and STA left after the strikes, spent on the attacks worth most that still fit, of the same kind and reach | none from 11 m (5 AP left, the hammer took them); a spear point beside (3 AP left) |
| threat | strikes and fillers added up | 65.7 from 11 m, 105.0 beside |

**Potential** threat is for a fresh round (8 AP, a surge open) and answers "where to be";
**immediate** threat is for what is left this round and answers "what now". **Danger** is
the foes' threat on me, added up.

### Walking (§4): is it worth moving?

```
gain(cell) = standing(cell) − arrival(cell) + pull − price − OAs drawn + keeping
           − (standing(here) − danger here + kept here)
standing   = my threat on the foe I threaten most − company
```

| term | reads | weight | noble, from standing still to a run beside the Ranger (movement surge) |
| --- | --- | --- | --- |
| offence | my potential threat from the cell | `offence` 1 | 65.7 → 105.0 |
| company | metres from the nearest ally, beyond the next cell | `company` 1 | 7 → 1 |
| pull | cells closer to a foe I could not reach in a fresh round | `aggression` 4 | 0 (the Ranger is in reach) |
| price | 2 an AP of my own walked, STA at its price; a surge's AP is not priced, its STA is | `THREAT_TUNING` | 21.9 |
| OAs drawn | the opportunity attacks the walk sets off | `opportunity` 1 | 0 |
| arrival | the foes' immediate threat on me at the cell, with what the walk leaves me to defend with; staying is charged it too, with everything it holds; the only exposure a walk counts (the user's ruling 2026-11-22) | `arrival` 1 | 0 → 13.0 |
| keeping | what the AP I keep is worth to allies I could defend | `guardian` 1 | 0 |

Here: staying scores 58.7, the run beside the Ranger +10.4, and a run to (−9,−1) (3 m short of
it, the same threat, 2 AP of its own) +15.4, which is taken. A 7 AP walk scores +8.3: the price
of its own AP is what puts a walk below the surge's run, and a run without the surge
(−11.7 beside the Ranger) pays its STA.

### Attacking (§3): is this attack worth making?

```
score = gain − defence lost − STA − AP + walk in − OAs drawn
gain  = harm it leaves × how much the target matters + what its defence costs it × how threatening it is
```

| term | reads | weight |
| --- | --- | --- |
| harm | `getDefendedHarm`: the harm left against the believed defence | `harm` 1 |
| target | how threatened the foe is by my team, and how threatening it is to it, relative to the other foes | `threatened` 0.6, `threatening` 0.2 |
| drain | what the believed defence costs the target | `drain` 1 |
| defence lost | what an AP of defence is worth at the cell the attack is made from (what a round's AP saves answering the foes' strikes there, over the round's AP), for every AP of my own the attack spends; the first AP costs as much as the last | `reserve` 1 |
| STA | `STAPrice` of the attack's STA, the surge's, and what answering the OAs drawn spends: 3 an STA with the pool full, up to 4.5 with it empty, and 2 a point of bleed for every STA | `STA` 3, `depletion` 0.5 |
| AP | `APPrice` of every AP of my own the attack itself spends; a surge's AP not | `AP` 2 |
| walk in | where the attack is made after a walk: the walk's score over standing still, as §4 scores it (its offence, pull, price and arrival); none from where I stand (the user's ruling 2026-11-22) | as §4 |
| OAs drawn | the opportunity attacks the walk sets off, and a shot fired beside a foe | `opportunity` 1 |

Why per AP, evenly: an arena squire 2 m from a foe, with two foes 11 m off who could run in,
is believed to take 0.4 this round holding 8 AP or 6, 21.9 holding 4, 63.7 holding 2 and
113.1 holding none. Read best first, its first 4 AP attack lost 0.2 and its second 21.6, and
it was killed with no AP left; read evenly (14.1 an AP), each loses about 56.

### Running from danger (§4.3)

Asked only when the harm I am believed to take this round where I stand is above `flee`
(10). The run is worth how much better the round comes out at the cell than here, less its
STA and the OAs it draws; made above `margin`. Not asked where a walk of its own brought it
this round or the last, while the harm is no more than that walk expected there (by
`margin`): one who walked in knowing the danger does not run from it (the user's ruling
2026-11-22).

### When nothing is worth doing: the objective (§4.4)

Of the options that bring me fewer rounds from attacking the foe I threaten most, and that
do not leave me believed collapsed, the best scored, as long as it loses less than standing
still costs this round (the danger here and the bleed to come).

---

## 0. Where a decision comes from

Two questions (the user's ruling): **now** (`planNow`: what to do now) and **later**
(`planLater`: how to better the position), asked only once nothing is to be done now.

```
threatBox (boxes/threat.ts)
│
├─ for each wait the table has on the seat
│   ├─ answer ──► answer()         attacked?      §6  defend / let it come
│   │                              ally attacked? §7  protect
│   │                              drew an OA?    §8  opportunity attack
│   ├─ turn ────► takeTurn()       asked again after every action (chains)
│   │              ├─ limit stress owed?           §10 violent / coward
│   │              ├─ collapsed?                   §10.1 stop its bleed, else nothing
│   │              ├─ now: planNow()               (no foe noticed: nothing now)
│   │              │    best of attack             §3  if score > 0
│   │              │         run from danger       §4.3 if harm taken > flee, score > margin
│   │              └─ later: planLater()
│   │                   ├─ no foe in sight/noticed §5  search
│   │                   ├─ else best walk          §4  if gain over stay > margin
│   │                   └─ else the objective      §4.4 the best scored of what brings it
│   │                                                   nearer attacking its foe, however low
│   ├─ rest ────► getRestChoice()                  §9 rest / rally / intimidate
│   └─ action / morale / concentration ──► settleWait (boxes/nearest.ts), HOP spend §11
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

`hits[h]` is the harm at HOP `h`, with the overflow spent as §11 spends it.

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

A building block every decision calls (the user's ruling, 2026-11-22): it reads only what is
spent and the spender's pool and bleed, never the danger the spender is in or what the AP
would do elsewhere. The AP price is there so that nothing is done for a marginal gain; STA
grows dearer as the pool runs down, not by a huge margin.

```
APPrice(AP)                    = w.AP · AP
STAPrice(spent, held, pool, bl) = spent · (w.STA · (1 + w.depletion · used) + 2 · bleed)
    used = 1 − (held − spent / 2) / pool, between 0 and 1   (the pool read halfway through)
SpendPrice(c, cost, held)      = APPrice(cost.AP) + STAPrice(cost.STA, held, STA(c), c's bleed)
```

With the defaults: an AP costs 2; an STA costs 3 with the pool full and 4.5 with it empty,
plus 2 per point of bleed. A gained STA is worth the same price read for the pool it ends in.
Every action pays STA at `STAPrice`. AP: an attack (§3), a walk (§4), a search (§5) and a rest
(§9) pay `APPrice`; a defence, whoever makes it (the target's below, mine in §6, an ally's in §7 and §4.2, the
OAs a walk draws in §4.1), pays
its AP at the round value instead (the user's ruling: whether a defence is worth making is
whether its AP would do more answering another attack, or attacking). A surge's AP is not
priced (§3 `ownAP`); its STA and what the recovery surge it gives up would give back are.

Round value (`getRoundValue`, used only to weigh a defence and how a round comes out):

```
slots     defending: every foe's strikes still to come on me (as in HarmTaken), each worth
                     the harm its believed defence saves, costing that defence's AP and STA;
                     less one of the foe whose strike is being answered
          attacking: my strongest per AP (pair threat) on one foe, after the walk in, each
                     worth the harm it leaves, as often as AP and STA pay
V(AP, STA) = the most the slots are worth, filled best per AP first (fractions kept),
             with no attack or with the attack on whichever foe gives most
```

STA only bounds what V fills; V charges nothing for it, so a defence adds `STAPrice` of its STA.

### Defended harm: what an attack is worth (`threat.ts` `getDefendedHarm`)

The target is believed to choose, among affordable answers (none included), the one that
leaves it the least harm and spending together:

```
cost(d)   = harm(attack, d) + spend(d.cost)
spend     = V_target(guard) − V_target(guard − d.cost)
            live (getTargetSpend: its round value, my strike the one answered; its STA not
            priced); in the pair threat, read once for the fight, the same pick with
            d.AP · APvalue_pair(target) + STAPrice(d.STA)   (the user's ruling: one pick,
            the same numbers everywhere)
APvalue_pair(c on foe) = the most harm per AP of c's attacks on foe, read with the
            defence foe picks at SpendPrice (getPairAPValue, so the reading does not go round)
chosen    = argmin cost(d) over affordable d
worth     = cost(chosen) + w.forcing · value(chosen)
```

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
                 believed to pick (spend as above, APvalue_pair); a shot read from 10 m (one penalty level, inside the
                 10 to 30 m most shots are fired from); the test a has set, safe or risky
    perAP      = worth / attack AP
```

A surge that buffs whoever makes it for the round (the movement surge: +3 to reflexes,
combat.tex "Reflex"; Tactical Movement's +3 to the SD against shots) is read off the table too:
each defence also keeps its DL with the surge made (`PairDefence.surged`), and the pair for a
defender who has made it gives that DL (`getPair`'s `surge`, the defender's own by default).
Every immediate reading takes the surge made this round; a potential one, a fresh round, none
(`makeThreat`, `getIncoming` fresh).

On top of it, where the two stand and what they have left (`makeThreat`):

```
attack      = getStrongestPerAP: the highest perAP among those a can declare on its turn
              (not one only a reaction makes) that do d some harm undefended
threat      = that attack, moveAP, strikes, fillers
fillers     = with the AP and STA the strikes leave, the attack worth most that still fits,
              again while one fits; only those declared on the turn, doing harm undefended,
              of the attack's kind and reaching as far (getFillers; the user's ruling
              2026-11-22: a round is filled with attacks)
threatValue = Σ worth over the strikes, then the fillers         with no guard given
            = the same, in that order, each answered while the guard  with `guard`
              still pays for its defence (worth), the rest at undefended
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
Danger(me, kind, at, guard) = pile_foe presence(foe) · threatValue(threat foe → me at `at`, guard) / share(foe)
                              guard: immediate, what I have left (or `guard`); potential, none
HarmTaken(me, at, guard)    = Σ_foe harm I take, below (`getHarmTaken`)
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

`HarmTaken`, the harm I'm believed to take this round standing at `at` with `guard` to answer
(`getHarmTaken`; the user's ruling: by every foe's AP left, not every foe's round on me alone):

```
t_f      = getStrongestPerAP(pair threat f → me)          the attack, its harm against the
                                                          defence I'd pick, undefended, d = that defence
walk_f   = f's walk into reach of at (its step map: walls and all)
n_f      = the most of, fractions kept (the user's ruling: a foe's reach counts its surge):
             no surge          (AP_f − walk_f) / t_f.AP
             movement surge    (AP_f − max(0, walk_f − surge AP)) / t_f.AP, its STA less the surge's
             combat surge      (AP_f + surge AP − walk_f) / t_f.AP, its STA less the surge's
           each also capped by STA / t_f.STA; a fresh round: the round's AP, movement surge only;
           then / (1 + others of my side f reaches where they stand)
answers  = guard spent on the strikes saving the most per AP first (saved = undefended − harm),
           k_f = min(n_f, AP left / d.AP, STA left / d.STA)
HarmTaken = Σ_f  n_f · undefended_f − k_f · saved_f
```

Which each decision reads:

| decision                          | immediate                                   | potential                          |
| --------------------------------- | ------------------------------------------- | ---------------------------------- |
| attack (§3)                       | its gain; defence per AP at the cell; the walk in's arrival | target worth (Threatened, Threatening); the walk in's standing, pull |
| run from danger (§4.3)            | danger now, danger at the cell              |                                    |
| walk (§4)                         | danger on arrival (and staying), allies kept | standing (offence), pull          |
| search (§5)                       |                                             |                                    |
| defend, protect, OA (§6, §7, §8)  | the attack met; danger left after (AP's price) |                                 |
| rest (§9), coward's getaway (§10) |                                            | danger                             |

---

## 3. Attack on the turn, a question of now (`boxes/threat.ts` `planAttack`, `getAttackMeasures`)

With no foe noticed, the turn searches instead (§5). Otherwise tried for every budget (no
surge, combat surge, movement surge), every foe noticed, every attack that opens as an
action, from every candidate cell.

```
spent, STAspent = walk + attack
held            = what the budget leaves after the walk, the attack and the OAs answered
met             = DefendedHarm(attack, gap, foe's guard, spend = the foe's round value)
T(foe)          = w.threatened · Threatened(foe) + w.threatening · Threatening(foe)
attackAP        = ownAP(spent) − ownAP(walk AP)    the AP of its own the attack itself spends
DefencePerAP(cell) = fill(max(ROUND_AP, AP held), STA held) / max(ROUND_AP, AP held)
                  (getDefencePerAP, §2 slots: what a round's AP saves answering the foes'
                  strikes at the cell, over that AP; the user's ruling 2026-11-22: every
                  AP spent on something else loses that share, the first as much as the
                  last)

gain            = w.harm · met.harm · T(foe) / mean T over the foes
                + w.drain · spend(met's defence) · Threatening(foe) / mean Threatening
                  (the user's rulings: gain and cost alike in harm, 100 a life; the target
                  factor relative to the other foes; AP burned worth more on a foe more
                  threatening, however vulnerable)
defence lost    = w.reserve · DefencePerAP(cell) · attackAP          (0 when attackAP is 0)
STA             = STAPrice(attack STA + surgeSTA + STA answering the OAs drawn)   (§2);
                  surgeSTA the focus surge's too, for a shot that needs it: its STA and
                  the recovery it gives up
AP              = APPrice(attackAP)   (the user's ruling of 2026-11-22: every AP of its
                  own costs, even where the defence it loses costs nothing; flat, no
                  danger; an opportunity attack pays it for its own AP)
walk in         = place(cell) − place(here) of §4 (getPlace: standing, pull, the walk's
                  price and arrival at the cell), with no surge STA in it (the attack's
                  STA holds it), no keeping and no OAs (counted below); 0 from where it
                  stands
                  (the user's ruling 2026-11-22: an attack with a walk in is the walk's
                  score and the attack's)
ownAP(spent)    = spent less what a surge's AP pays: a movement surge's the walk only, any
                  other's all of it (a surge's AP is lost at the turn's end, so the surge
                  costs only its STA; the user's ruling 2026-11-22)

score = gain − defence lost − STA − AP + walk in
      − w.opportunity · OAs the walk draws (§4.1)
      − w.opportunity · OAs a shot draws from where it is fired   (shots)

make it if score > 0   (or always, if compelled: violent)
with the combat surge only if gain > STAPrice(surgeSTA)
```

Candidate cells (`getAttackCells`; the user's ruling: of the walk, only the cheapest route
towards the target matters, the OAs it draws the caveat): where it stands if it reaches;
otherwise the cheapest cell of the walk that reaches, and where walking there draws OAs, also
the one of the next `ATTACK_SCAN` (8) cheapest that draws the least; shots keep only
cells with a line of fire, strikes only cells whose melee gap the table measures within
reach (`getStrikeCells`: walls, and height between the two).

Walks weighed (`getTurnWalks`), here and in §4: one at each of walk and run that is open,
and one at the fastest movement open (so one who can only swim, climb or crawl still has
one); every candidate cell is tried at each, with that walk's AP and STA, and the move is
declared at its movement. The coward's getaway (§10) and the search (§5) walk as the table
walks (`walkAt`); the rest read one search a turn (the user's ruling 2026-11-22: a place to
go is picked, then walked to):
```
routes    = every cell walked to from here at a walk, as far as the furthest any budget
            carries a walk or a run, the fewest cells there and the way, on every floor the
            walk reaches by stairs (getRoutes, getTurnRoutes)
cost(b,m) = getMovePrice of the route's cells at movement m (on land a walk costs its cells,
            whichever way they go); a cell is in walk (b,m) when b pays for it
taken     = the table is asked only of the move picked, best first, and takes it only at no
            more than the price weighed (takesWalk; a run turns no sharper than it may, so the
            table's run may be longer)
```
An attack's candidates are weighed in full and settled into a plan from the best down: the
first the table takes is made.

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
               − w.company · max(0, metres to nearest ally − 1)

pull(cell)     = w.aggression · max over foes under no potential threat from here
                 of (AttackSteps(here → foe) − AttackSteps(cell → foe)), foes and cells
                 with no route left out, at least 0

place(cell)    = standing(cell) + pull(cell)
               − SpendPrice(ownAP(walk AP), walk STA + surgeSTA)  (§2, §3 ownAP)
               − w.arrival · Danger(me, immediate, cell, AP/STA left after the walk)
place(here)    = standing(here) − w.arrival · Danger(me, immediate, here, all it holds)
                 (getPlace, read once a turn; §3's walk in is place(cell) − place(here))

walk(cell)     = place(cell)
               − w.opportunity · OAs drawn on the way
               + keeping(cell, AP held of its own)

stay           = place(here) + kept
                 (exposure counted once, as arrival, on both sides; the user's ruling
                 2026-11-22)

gain(cell)     = walk(cell) − stay       (the plan's score: harm gained over doing
                                          nothing, as an attack's score is)

walk if best gain(cell) > w.margin
```

Candidate cells (`getPlaces`, the user's ruling 2026-11-22: only the routes towards the foes
and the best cell): per foe, of the cells of the walk on its route to attacking the foe
(`getAttackRoute`), the `TOWARDS` (3) that close most on it and the closest of each AP block
(so a walk may stop short); and the `BEST_CELLS` (3) cells of the walk where the character
threatens most and is threatened least:
```
best(cell) = w.offence · max over foes threatValue(PotentialThreat(me → foe, from cell))
           − w.arrival · Danger(immediate, cell, what the walk leaves it)
```
only cells walked to clear. The steps still to walk from a cell on the route are read off the
route (the rest of a fewest cells' way is the fewest from that cell).

The actual distance to attack (`threat.ts` `getAttackRoute`, the user's ruling 2026-11-22):
```
AttackSteps(cell → foe) = the fewest cells walked from cell to a cell where my
                          furthest-reaching attack meets the foe (a shot: within its
                          reach with a line of fire; a strike: the melee gap the table
                          measures within reach), walked as the table walks (around walls
                          and bodies, up and down only what can be walked), as far as the
                          board goes; none where no walk gets there
```
Walked `ROUTE_STEPS` cells out first, then twice as far each time nothing meets the foe, up to
the whole board: the table cuts a walk by the cells walked alone, so the nearest cell found
within a shorter walk is the nearest of all, with the same way there.

### 4.1 Opportunity attacks drawn (`approach.ts`)

```
walk:  Σ_holder best strike it can pay for that opens on a step (or on a run/jump if running),
       met at the step getApproachStep says it draws,
       met = DefendedHarm(strike, distance at that step, my guard,
                          spend = V(guard) − V(guard − cost) + STAPrice(STA))
             answered as I answer an attack on my turn (§6)
       drawn = met.harm   (the harm alone; what answering spends comes off what I hold)
       distances along the walked path, or straight a metre a step when no path is known
shot / priced gear move:  Σ_holder best strike opening on a step with reach ≥ gap, its harm
```

The AP and STA the walker spends answering them come off what it has left (§3 `held`), and
the STA is counted in the attack's STA. The old box reads the same OAs' `worth` at SpendPrice.

### 4.2 Keeping AP for allies (`getProtections`, `getKeeping`)

For every ally under a foe's immediate strike threat:
```
toMe  = DefendedHarm(same strike on me, at its reach)
skip unless threat.worth − toMe > w.cover
bare  = harm(same strike on me, none)
for each block / intercept d:
    left = threat.undefended · harm(strike on me, d) / bare
    gain = threat.worth − left − (V(my means) − V(my means − d.cost) + STAPrice(d.STA))
           (V my round value where I stand, §2: a defence's AP at what it would do otherwise)

keeping(cell, AP) = w.guardian · max gain over protections with d.AP ≤ AP
                    and cell on the protect line
```

### 4.3 Run from danger (`boxes/threat.ts` `planFlee`), a question of now

```
only when HarmTaken(me, here, all it holds) > w.flee   (the same harm an attack weighs)
and not where a walk of its own (§3, §4, §4.4) brought it this round or the last, while
HarmTaken(me, here) ≤ expected + w.margin, expected = HarmTaken(me, cell, a fresh round's
AP and the STA the walk left, fresh) read when the walk was chosen (isExpected)
Outcome(cell, AP, STA) = harm the foes' strikes there do me undefended − V(cell, AP, STA)
                         (getOutcome; the user's ruling: a place is worth what my AP and STA
                         can do there, answering strikes or striking whoever I reach, §2)
now       = Outcome(here, all it holds)
after     = Outcome(cell, AP/STA left after the walk)
run(cell) = now − after − STAPrice(walk STA + surgeSTA) − w.opportunity · OAs drawn

run if best run(cell) > w.margin; against the best attack, the higher score is made
```

Candidate cells: `getPlaces` with no foe to close on, so the `BEST_CELLS` best cells (§4);
the best the table takes at its price is run.

### 4.4 The objective, when nothing is worth doing (`objective.ts`, `boxes/threat.ts` `planObjective`)

Asked on `planLater` once no walk clears `w.margin` (and no attack or run cleared its
bar on `planNow`). The user's ruling (2026-11-22): the meters alone make doing nothing
look free, so the objective tips the scale; doing nothing is no progress.

```
objective foe   = the noticed, placed foe with the most perAP of my strongest attack
                  per AP on it (pair threat, fresh round; getObjective): the foe I
                  threaten most, wherever anyone stands
Rounds(cell)    = max(1, ⌈(⌈AttackSteps(cell → foe) / metres⌉ · AP a block
                          + that attack's AP) / ROUND_AP⌉)
                  at my fastest movement costing no STA, counted from the next round
                  (getRoundsToAttack); none where no route, or the attack > ROUND_AP
ruinous(option) = IL + spent STA · bleed + HarmTaken(at, what it leaves) / 2
                  ≥ injury capacity     (isRuinous; harm read as IL at 2 a point)

staying cost    = Danger(me, immediate, here, all it holds) + harm(IL = bleed)
                  (getStayingCost: what waiting costs this round, the bleed at the next
                  round's start)
allowed         = the attack on the objective foe scored as §3 with no bar (an attack
                  this turn, 0 rounds), and every §4 walk with Rounds(cell) < Rounds(here)
                  (any walk where Rounds(here) is none), none of them ruinous, each
                  with score > −staying cost
take the best scored of the allowed; with none, carryOn (agree to end)
```

---

## 5. Search when no foe is seen or noticed (`boxes/threat.ts` `planSearch`)

Also when every foe in the view is one the character does not notice (the user's ruling).

Where the side knows a foe stands (an ally sees it, or the seat remembers where it was last
noticed, heard among others), the search is for that place (the user's ruling):
```
score(cell) = w.recall · Σ presence(f) over known foes f whose cell it would see (§12)
            + w.offence · (offence(cell) − offence(here))
            + w.aggression · (nearest(here) − nearest(cell)), 0 if either has no route
nearest(c)  = min AttackSteps(c → f) over known foes f (§4)
offence(c)  = max threatValue(potential me → f, me at c) over known foes f seen from c
              (as §4's standing; the user's ruling: a cell an archer sees a foe from is one it
              can shoot from)
            − the same price and peril as below
```
Where it knows of none:
```
score(cell) = w.search · cells it would see that nobody of the side sees
            + w.aggression · (dist(here, board middle) − dist(cell, board middle))
            − SpendPrice(ownAP(walk AP), walk STA + surgeSTA)
            − w.peril · (Danger(me, potential, cell) − Danger(me, potential, here))
                                                    remembered foes included
A search is weighed for the round to come only: no immediate danger in the score (the user's
ruling: a foe stumbled on unseen is detection's matter).

walk if best score > w.margin
```
12 cells of the walk spread from the furthest; dark board sampled to at most 240 cells.

---

## 6. Answering an attack on me (`boxes/threat.ts` `answer`)

A shot at me from within my reach: the opportunity attack first (§8), if worth making.

```
none:      score = harm(attack, none at DL) − V(kept(0), my STA)
defence d: score = harm(attack, d at DL) − V(kept(d.AP), my STA − d.STA)
                 + STAPrice(d.STA)
                 + (someone else already guards me ? w.redundant : 0)
V = my round value (§2), the attacker's strike left out of those to come
kept(spent) = max(0, min(AP − spent, AP − surge AP left))   surge AP left counted only when it
              is lost at the stack's end (`keepsSurgeAP`: not in turn, not fleeing, no turn
              waiting); else AP − spent
d among the answers the panel offers with no surge: one only a surge opens is reached by
making the surge (below)

DL = the attack's DL with every declared defence counted (when someone else guards),
     else the pair table's DL for d
answer with the lowest score

each surge the panel offers (reaction, movement), where STA > 0 (the user's ruling: when the
harm it would take is more than what the STA is worth; an opportunity attack or a riposte on
me answered the same way), the attack and the answers read again on the fight with it made
(the movement surge's reflexes in the pair's DL, its AP not kept):
    gain     = lowest score − lowest score after the surge − STAPrice(the surge's STA
               + what the recovery surge would have given back)
    made     the surge with the most gain, if gain > 0
```

An attack whose arrows or variant the seat does not know is read as the worst row of its
kind (`getKnownAttack`).

---

## 7. Protecting an ally (`boxes/threat.ts` `protect`)

Only when nobody guards the ally yet and the ally has not reacted.

```
toAlly = DefendedHarm(attack on ally, ally's means)
toMe   = DefendedHarm(same attack on me, my means)
skip unless toAlly.worth − toMe > w.cover

for each block / intercept / guard offered (none a surge with a press of its own opens;
a learned one, the protection surge, is made with its defence):
    score = harm left on the ally at the DL the table gives with it declared
          + V(my means) − V(my means − own AP, my STA − STA) + STAPrice(STA)
    own AP = its AP less what the surge's AP pays; STA = its STA, and with the surge the
             surge's and what the recovery surge it gives up would give back
             (V my round value where I stand, §2, as §6 weighs a defence)

make the lowest if score < toAlly.worth
```

---

## 8. Opportunity attack I draw (`boxes/threat.ts` `opportunity`)

```
for each row the draw opens, each heavy degree:
    score = AttackScore.total (§3, with no walk, no OA drawn, no keeping)
make the best if score > 0
```

---

## 9. Round's rest step (`rest.ts` `getRestChoice`)

```
back      = STA the rest gives back
STAworth  = STAPrice(back, STA + back, my pool, no bleed)
danger    = Danger(me, potential)
short     = ROUND_AP − min(ROUND_AP, AP − cost)        the AP taken from the round to come
overdraw  = APPrice(short) + w.overdrawDanger · danger · short
            (the user's ruling, 2026-11-15: dearer the more threatened; a decision term of the
            rest's own, kept out of the price)

rest:   worth = STAworth − overdraw
social: worth = STAworth + w.restSay · socialValue − overdraw
        rally first if w.rallyFirst > 0 or an ally is at MORALE_TRIGGER pressing factors,
        else intimidate first; skipped if the team said it as strongly this round

take the best if worth > 0
```

---

## 10. Limit stress turn (`boxes/threat.ts` `takeStressTurn`)

```
social stress action owed    → default to coward
a surge owed                 → rest first if needed, then make it
violent                      → planViolent (attack whatever its score, else walk)
coward (surge AP left)       → getAway: walk to the cell of least Danger(potential)
otherwise                    → end turn
```

### 10.1 Collapsed (`boxes/threat.ts` `planCollapsed`)

A collapsed character (combat.tex "Collapsed") does one thing with a turn (the user's ruling):

```
bleed = 0                    → nothing: no turn asked for, the round agreed to end
else                         → First Aid on itself if learned, else Tend Wounds,
                               after the focus surge both need
                               score = harm(bleed) (§1), the turn asked for on it
neither open                 → nothing
```

Asked in `planNow`; `planLater` gives nothing, so it never walks or searches.

---

## 11. Spending a hit's overflow (`predict.ts` `getBestSpend`)

Assassinate is bought first whenever it is offered (the user's ruling), and the rest is spent
with the 5 HOP it gives. Tried: all in smash; if it carries a cut, n slices + rest in smash
for every n; bust + the same; each again with the braced or hook bonus bought.

An assassination only works against SD, so the pair table reads a hit's harm again against
each real defence wherever one is offered undefended, as it does for a hook attack.

```
best = lexicographic max of (highest injury tier, sum of tiers, damage − armor)
```

The pair table (§1 `hits`) and the landing both spend this way.

---

## 12. What a seat knows (`belief.ts` `getBelief`)

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

Memory (`memory.ts`, the user's ruling 2026-11-21), for a box that `remembers` (the threat box):
the seat notes every foe any member notices, its face, where it stood and the round
(`remember`, kept per seat by whoever runs the seats: `run`, `useBots`, through `noteSeats`).
A foe the seat no longer notices stands in its view where it was last noticed, as it was then,
unnoticed by every member, so never aimed at (`withRemembered`).

```
forgotten when   noticed again (noted afresh)
                 round − round noticed > FORGET_AFTER (2, the user's ruling)
                 a member sees its cell and it is not there, or someone noticed stands there
                 it has left the fight
presence(foe)  = 1 for a foe noticed; w.fade ^ (rounds since noticed) for one remembered
                 read in Danger, the round value's slots (its strikes on me, mine on it), §5
```

---

## Weights

A box is made with its weights (`threatBox(w)`), and every function that reads one takes them
as a required argument, never a default, so a call that forgets them does not compile. The
tables the weights do not touch (pairs, harms, step maps) are shared by every bot; those
they do are kept per weights. The table's walks a bot reads (step maps, routes, the walks a
turn weighs) are kept by what a walk reads (`walks.ts` `getKeptWalk`), not by the state they
were asked in, so the many states a box makes walk once.

`THREAT_TUNING` (`threat.ts`), shared by every box:

| weight        | default   | read in                                       |
| ------------- | --------- | --------------------------------------------- |
| `AP`          | 2         | APPrice, per AP                               |
| `STA`         | 3         | STAPrice, per STA with the pool full          |
| `depletion`   | 0.5       | STAPrice: how much dearer with the pool empty |
| `forcing`     | 0.25      | DefendedHarm: per point the defence takes off |
| `opportunity` | 1         | §3, §4 OAs drawn                          |
| `end`         | `'middle'`| fromThird: which end of a face's third, or its middle |
| `pile`        | 1         | Danger: share of every foe's threat but the worst |
| `share`       | 0         | Danger: a foe's threat divided among those it threatens |
| `fade`        | 0.5       | presence of a remembered foe, per round since noticed (§12) |

`REST_TUNING` (`rest.ts`) adds:

| weight       | default | read in                        |
| ------------ | ------- | ------------------------------ |
| `restSay`    | 2       | §9, per point of social value |
| `rallyFirst` | 0       | §9, > 0 puts rallies first    |
| `overdrawDanger` | 0.1 | §9, per AP overdrawn per point of potential danger |

`THREAT_WEIGHTS` (`boxes/threat.ts`) adds:

| weight        | default | read in                                                 |
| ------------- | ------- | ------------------------------------------------------- |
| `harm`        | 1       | §3 harm multiplier                                      |
| `threatened`  | 0.6     | §3 target: team's threat on the foe                     |
| `threatening` | 0.2     | §3 target: foe's threat on the team                     |
| `offence`     | 1       | §4 standing                         |
| `peril`       | 1       | §5 next round's danger added (no longer in §4) |
| `aggression`  | 4       | §4 pull per cell nearer a foe out of reach, §5 per cell nearer the middle |
| `arrival`     | 1       | §4 immediate danger at the cell walked to               |
| `search`      | 1       | §5 per cell newly seen                                  |
| `recall`      | 20      | §5 per remembered foe whose cell comes into sight       |
| `margin`      | 1       | §4, §4.3, §5 must beat by                           |
| `flee`        | 10      | §4.3 harm it must be believed to take to run now        |
| `cover`       | 0       | §4.2, §7 ally's threat over mine                        |
| `redundant`   | 5       | §6 own defence when someone guards                      |
| `company`     | 1       | §4 per metre from nearest ally beyond the next cell     |
| `guardian`    | 1       | §4.2 AP kept for allies                                 |
| `reserve`     | 1       | §3 defence lost, per AP of its own spent                |
| `drain`       | 1       | §3 what the believed defence costs the target           |

Fixed counts (not weights):

| constant                        | value   | file                              |
| ------------------------------- | ------- | --------------------------------- |
| `TOWARDS`, `BEST_CELLS`         | 3, 3    | boxes/threat.ts walk candidates   |
| `ATTACK_SCAN`                   | 8       | boxes/threat.ts attack candidates |
| `RUN_BLOCKS`                    | 2       | boxes/threat.ts least run a movement surge pays for |
| `SEARCH_CELLS`, `SEARCH_SPREAD` | 12, 240 | boxes/threat.ts search            |
| `MAP_ROUNDS`                    | 1       | threat.ts step map depth          |
| `ROUTE_STEPS`                   | 12      | threat.ts first route walk, doubled until it meets |
| `WALKS`, `CONTENTS`             | 3000, 50000 | walks.ts walks kept a board, contents told apart |
| `BALLPARK`                      | 3       | belief.ts                         |
| `FORGET_AFTER`                  | 2       | memory.ts (the user's ruling)     |
| `QUIVER`                        | 20      | belief.ts (gear.tex "Quiver")     |

---

## The other box

`nearestBox` (`boxes/nearest.ts`) is the baseline: walk to the nearest foe, attack it with
the first row the table takes, focus if only a focused shot is left, pass every answer,
spend overflow as §11. No formula beyond distance.

The old box (`boxes/threatOld.ts`, `--box old` in `pnpm arena`) is the threat box as it
was before §0's two questions: a change of arms weighed first, then an attack, then a walk,
and the first member with anything to do starting the turn, reading threat as it was
read before the pair threat (`threatOldReading.ts`: the best attack read for every cell and
guard, the walk in's opportunity attacks counted, the worst foe's danger alone). It is kept
only to play the threat box against; its formulas are not mapped here. Its rest step
(§9) reads `rest.ts`, shared with the threat box.
