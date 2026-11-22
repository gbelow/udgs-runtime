# Bot map

How `bot:threat` decides (`bot/boxes/threat.ts` on top of `bot/threat.ts`). Everything is
in **harm**: $H = 2\,IL + 5\,bleed$ (`pairs.ts getHarm`), so a life is about 100.
Weights are $w_\cdot$ (box, `THREAT_WEIGHTS`) or tuning constants (`THREAT_TUNING`); the
table at the end has their values.

## 0. Who is asked, in what order (`seat.ts`)

1. dice the seat owes are thrown;
2. a turn just taken: every other seat may **contest** it, for its best `planNow`;
3. seats the table waits on (an answer, a turn, a settle);
4. the auto-table (moves the round on);
5. idle seats: first `immediate` (start a turn for `planNow`), then `any` (for `planLater`).

A seat starts the turn of the member whose plan scores highest. Once the turn is its own it
replans after every action, until nothing is worth doing, then ends the turn.

## 1. Building blocks (`bot/threat.ts`, `odds.ts`, `approach.ts`)

**Expected harm** of an attack (skill $s$) against a defence (DL), over the kept face $f$:

$$E = \sum_{f=0}^{9} p_{mode}(f)\; h\big(f + s - DL\big),\qquad h(x)=\begin{cases}\text{hit at HOP } x-5 & x\ge5\\ \text{graze} & 0\le x<5\\ \text{miss} & x<0\end{cases}$$

A shot is read at $10$ m (`PAIR_GAP`), its distance penalty off $s$.

**Prices**, a building block every decision calls: no danger, no round value. AP flat; STA held $S$ of a pool $S_{max}$, bleeding $b$, dearer as the pool runs down (read halfway through the spending):

$$P_{AP}(a) = \alpha\,a \qquad P_{STA}(x) = x\left(\sigma\,(1 + \mu u) + 2b\right),\quad u = 1 - \frac{S - x/2}{S_{max}} \qquad P = P_{AP}+P_{STA}$$

Every action pays its STA at $P_{STA}$, a surge's and the recovery it gives up included. AP: an attack, a walk, a search and a rest pay $P_{AP}$; a defence pays its AP at the round value, $V(g) - V(g-c)$. A surge's AP is free.

**The defence the target picks** and what the attack is then **worth**:

$$d^* = \arg\min_{d\ \text{affordable}} \big[E_d + \text{spend}(c_d)\big] \qquad W = E_{d^*} + \text{spend}(c_{d^*}) + \varphi\,(E_\varnothing - E_{d^*})$$

with $\text{spend}(c) = V(g) - V(g-c)$: what that AP/STA would have done otherwise this round (see $V$ below); in the pair threat, $c_{AP}\,v_{pair} + P_{STA}(c_{STA})$.

**Threat** of $a$ on $d$: the attack with best $W/AP$ (declarable, $E_\varnothing>0$), walked in, then repeated, then fillers:

$$AP_{walk} = \left\lceil \tfrac{\text{steps}}{m}\right\rceil a_{block} \qquad n = \left\lfloor\frac{AP - AP_{walk}}{c_{AP}}\right\rfloor \qquad T = n\,W^* + \sum_{\text{fillers}} W_i$$

- *immediate*: $AP$ = what $a$ is believed to have left (face third, middle), best of no surge / movement surge pays the walk / combat surge;
- *potential*: a fresh round, $AP = 8$, movement surge pays the walk; $T=0$ if walk + one attack don't fit.

**Danger** on a character (each foe faded by memory, $\lambda^{\text{rounds since seen}}$):

$$D = \max_f T_f + \pi\Big(\sum_f T_f - \max_f T_f\Big)$$

**Round value** $V(AP, STA)$: a knapsack filled best value-per-AP first, of

- defence slots, one per foe striking: value $E_\varnothing - E_{d^*}$, count $n_f/(1+\text{others it reaches})$;
- attack slots: own best attack on a foe, after its walk.

From it: $U$ = all incoming harm undefended, harm taken $H_{tk}(g) = U - \text{fill}_{def}(g)$,
outcome $O(g) = U - V(g)$, defence per AP $\delta_{AP} = \text{fill}_{def}(\max(8,AP), STA)/\max(8,AP)$.

**Opportunity attacks drawn** $H_{OA}$ (`approach.ts`): each foe's best strike met at the step of the walk that enters its reach, answered as above.

## 2. The turn (`planTurn`)

$$\text{planNow} = \max(\text{attack},\ \text{flee}) \quad\text{else (pass `any`)}\quad \text{walk} \;\to\; \text{objective}$$

No foe noticed: **search**. Collapsed: stop own bleed (score $5\,b$). Limit-stress violent: attack whatever it scores.

### Attack (`planAttack`)
Over every foe, row, walk (walk, run), cell that reaches it (`ATTACK_SCAN`), and budget (none, movement surge for a run of $\ge2$ blocks, combat surge only for attacks nothing else pays):

$$S_{atk} = w_h E_{d^*}\,\tau_t + w_d\,\text{spend}(c_{d^*})\,\theta_t - w_r\,\delta_{AP}\,a_{own} - P_{STA}(x) - P_{AP}(a_{own}) + \big(\text{Place}(cell) - \text{Stay}\big) - \omega H_{OA}$$

$$\tau_t = \frac{0.6\,\text{Threatened}_t + 0.2\,\text{Threatening}_t}{\text{mean over foes}} \qquad \theta_t = \frac{\text{Threatening}_t}{\text{mean}}$$

Threatened = team's summed potential $T$ on the foe; Threatening = foe's worst potential $T$ on anyone of the team.
$a_{own}$ = AP not paid by a surge (surge AP is free, its STA is not). Made if $S_{atk}>0$; with the combat surge only if the gain $>P_{STA}(\text{surge STA})$.

### Flee (`planFlee`)
Only if $H_{tk}(\text{here}) > w_{flee}$ and it didn't walk there itself expecting it:

$$S_{flee} = O_{here} - O_{cell}(g') - P_{STA}(x) - \omega H_{OA} \quad > w_{margin}$$

### Walk (`planWalk`)
Cells: 3 towards each foe, 3 away from the worst, towards friends.

$$\text{Place}(c) = w_o \max_f T^{pot}(c\to f) - w_c\,\text{apart}(c) + w_{agg}\,\Delta\text{steps}_{\text{unreachable foes}} - P(a_{own}, x) - w_{arr}\, D^{imm}(c, g')$$

$$S_{walk} = \text{Place}(c) + K(c) - \omega H_{OA} - \text{Stay} \quad > w_{margin}$$

Stay = Place(here) with everything held. $K(c) = w_g \max$ gain of a block/intercept it could still make for a threatened ally from $c$.

### Objective (`planObjective`, `objective.ts`): when nothing scores
Foe = $\arg\max_f W^*/AP$ (position ignored). Rounds to attack it:

$$R(c) = \max\!\left(1, \left\lceil\frac{\lceil \text{route}/m\rceil a_{block} + c_{AP}}{8}\right\rceil\right)$$

Take the best attack on that foe, or walk with $R(c) < R(\text{here})$, provided
$S > -\big(D^{imm}_{here} + 5b\big)$ and not ruinous: $IL + x\,b + H_{tk}/2 \ge$ injury capacity.

### Search (`planSearch`)
Known foe position (ally sees it / remembered):
$S = w_{rec}\sum \lambda^{age}[\text{seen}] + w_o T + w_{agg}\,\Delta d - P - w_p \Delta D^{pot}$.
Nothing known: $w_{search}\cdot$ unseen cells shown $+ w_{agg}\cdot$ closer to the middle $- P - w_p\Delta D^{pot}$.

## 3. Off-turn

**Answer an attack** (`weighDefences`): minimise over none and each offered defence

$$\text{score}(d) = E_d - V(g - c_d) + P_{STA}(c_{d,STA}) + [\text{already guarded}]\,w_{red}$$

A surge is pressed first if it lowers the best score by more than $P_{STA}$(its STA + recovery given up). A shot from within reach: the opportunity attack first, if worth it.

**Protect an ally** (`protect`): if $W_{ally} - W_{me} > w_{cover}$ and nobody guards it, pick block/intercept/guard minimising $E_{left} + V(g) - V(g - c_{own}) + P_{STA}(c_{STA})$ (a protection surge's AP pays first; its STA and the recovery given up are counted); do it if $< W_{ally}$.

**Opportunity attack**: $S_{atk} > 0$ (no walk term).

**Rest step** (`rest.ts`): rest or a social action (rally first if an ally is at the morale trigger):

$$S_{rest} = P_{STA}(\text{back}) + w_{say}\,\text{social} - (\alpha + \delta\,D^{pot})\,\text{AP short of next round} \quad > 0$$

## 4. Weights

| | value | | value |
|---|---|---|---|
| $\alpha$ AP | 2 | $w_h$ harm | 1 |
| $\sigma$ STA | 3 | $w_d$ drain | 1 |
| $\mu$ depletion | 0.5 | $w_r$ reserve | 1 |
| $\delta$ overdrawDanger (rest) | 0.1 | | |
| $\varphi$ forcing | 0.25 | $w_o$ offence | 1 |
| $\omega$ opportunity | 1 | $w_p$ peril | 1 |
| $\pi$ pile | 1 | $w_{agg}$ aggression | 4 |
| share | 0 | $w_{arr}$ arrival | 1 |
| $\lambda$ fade | 0.5 | $w_c$ company | 1 |
| face end | middle | $w_g$ guardian | 1 |
| $w_{say}$ restSay | 2 | $w_{margin}$ | 1 |
| rallyFirst | 0 | $w_{flee}$ | 10 |
| threatened / threatening | 0.6 / 0.2 | $w_{cover}$ / $w_{red}$ | 0 / 5 |
| $w_{search}$ / $w_{rec}$ | 1 / 20 | | |

Constants: `RUN_BLOCKS` 2, `TOWARDS`/`AWAY` 3, `ATTACK_SCAN` 8, `PAIR_GAP` 10 m, `SEARCH_CELLS` 12.
