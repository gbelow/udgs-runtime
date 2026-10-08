import type { CampaignCharacter } from '../../types'
import type { CampaignState, CampaignUpdater, ETPlan, TableUpdater } from '../types'
import type { Dice } from '../../combat/dice'
import { resolveTest } from '../../combat/rules/test'
import { heal } from '../../character/commands/heal'
import { isDead } from '../../character/rules/afflictions'
import { canRestHeal, getExhaustionTest, getExplorationBar, getPassBar, getPlanAfterTest, getRestHealing, getRestRecovery, getWear } from '../rules/exploration'
import { getNextET } from '../rules/clock'
import { advanceClock } from './clock'
import { updateRosterCharacter } from './roster'

const onCharacter = (id: string, update: (c: CampaignCharacter) => CampaignCharacter): CampaignUpdater =>
  (state) => (getExplorationBar(state, id) ? state : updateRosterCharacter(id, update)(state))

// What the character will spend the coming ET on; none leaves them idle.
export function setPlan(id: string, plan: ETPlan | null): CampaignUpdater {
  return (state) => {
    if (getExplorationBar(state, id)) return state
    const { [id]: _old, ...rest } = state.plans
    return { ...state, plans: plan ? { ...rest, [id]: plan } : rest }
  }
}

// survival.tex "Exposure": the table sets how rough the party's ground is.
export function setExposure(exposure: number): CampaignUpdater {
  return (state) => ({ ...state, exposure })
}

// survival.tex "Hunger": "Each portion eaten recovers a number of hunger
// points defined in the portion itself."
export function eat(id: string, nutrition: number): CampaignUpdater {
  return onCharacter(id, (c) =>
    ({ ...c, resources: { ...c.resources, hunger: Math.max(0, c.resources.hunger - Math.max(0, nutrition)) } }))
}

// survival.tex "Thirst": "Every portion of water recovers 1 thirst".
export function drink(id: string): CampaignUpdater {
  return onCharacter(id, (c) =>
    ({ ...c, resources: { ...c.resources, thirst: Math.max(0, c.resources.thirst - 1) } }))
}

// survival.tex "Healing Potions": "heal IL in the course of an ET. Healing
// through potions does not increase hunger and thirst. Any healing that is
// not used during the ET is lost."
function spendPotion(c: CampaignCharacter): CampaignCharacter {
  const healed = Math.min(c.injuries.potion, c.injuries.injuryLevel)
  return { ...c, injuries: { ...c.injuries, injuryLevel: c.injuries.injuryLevel - healed, potion: 0 } }
}

const addExhaustion = (amount: number) => (c: CampaignCharacter): CampaignCharacter =>
  ({ ...c, resources: { ...c.resources, exhaustion: Math.max(0, c.resources.exhaustion + amount) } })

const addIL = (amount: number) => (c: CampaignCharacter): CampaignCharacter =>
  ({ ...c, injuries: { ...c.injuries, injuryLevel: c.injuries.injuryLevel + amount } })

// survival.tex "Rest": exhaustion lowers and IL heals, by negative amounts on
// ground rough enough to work against the character.
function rest(c: CampaignCharacter, exposure: number): CampaignCharacter {
  const recovered = addExhaustion(-getRestRecovery(exposure))(c)
  const healing = getRestHealing(c, exposure)
  return healing < 0 ? addIL(-healing)(recovered) : heal(Math.min(healing, recovered.injuries.injuryLevel))(recovered)
}

// One character's ET: the Will test their exhaustion calls for, the potion
// they drank, and their plan, or what the test forced on them instead.
// survival.tex "Exhaustion": every ET but a rest adds +1 exhaustion; "Wear":
// an exploration action adds its wear.
function passFor(state: CampaignState, id: string, dice: Dice): CampaignState {
  const c = state.characters[id]
  if (isDead(c)) return state
  const test = getExhaustionTest(c)
  const roll = test ? resolveTest(test, dice) : null
  const plan = getPlanAfterTest(state.plans[id] ?? null, roll?.degree ?? null)
  const drank = spendPotion(c)
  const resting = plan === 'rest' && canRestHeal(state, id)
  const after = resting ? rest(drank, state.exposure)
    : plan && plan !== 'rest' ? addExhaustion(1)(addIL(getWear(drank, plan))(drank))
    : addExhaustion(1)(drank)
  return {
    ...state,
    characters: { ...state.characters, [id]: after },
    rests: resting ? { ...state.rests, [id]: (state.rests[id] ?? 0) + 1 } : state.rests,
    exhaustionRolls: roll ? { ...state.exhaustionRolls, [id]: { die: roll.die, score: roll.score, DL: roll.DL, degree: roll.degree } } : state.exhaustionRolls,
  }
}

// survival.tex "Exploration Turn (ET)": the ET passes for everyone on the
// roster at once, each doing what they planned, and the clock moves on to
// the next.
export function passET(dice: Dice): TableUpdater {
  return (table) => {
    if (getPassBar(table)) return table
    const { campaign } = table
    const passed = Object.keys(campaign.characters).reduce((state, id) => passFor(state, id, dice), { ...campaign, exhaustionRolls: {} })
    return { ...table, campaign: advanceClock(getNextET(campaign.clock))({ ...passed, plans: {} }) }
  }
}
