import type { CampaignCharacter } from '../../types'
import type { ExplorationAction } from '../../lists'
import type { CampaignState, CampaignUpdater } from '../types'
import { heal } from '../../character/commands/heal'
import { getExplorationBar, getRestBar, getRestHealing, getSleptExhaustion, getWear } from '../rules/exploration'
import { getNextET } from '../rules/clock'
import { updateRosterCharacter } from './roster'

const onCharacter = (id: string, bar: (state: CampaignState) => string | null, update: (c: CampaignCharacter) => CampaignCharacter): CampaignUpdater =>
  (state) => (bar(state) ? state : updateRosterCharacter(id, update)(state))

// survival.tex "Healing": healing takes off no more IL than there is.
const healUpTo = (amount: number) => (c: CampaignCharacter): CampaignCharacter =>
  heal(Math.min(amount, c.injuries.injuryLevel))(c)

// survival.tex "Healing Potions": "take their effect during sleep or a short
// rest. They heal IL, but do not affect the hunger and thirst values. Any
// healing that is not used during rest is lost."
function spendPotion(c: CampaignCharacter): CampaignCharacter {
  const healed = Math.min(c.injuries.potion, c.injuries.injuryLevel)
  return { ...c, injuries: { ...c.injuries, injuryLevel: c.injuries.injuryLevel - healed, potion: 0 } }
}

// survival.tex "Wear": what the exploration action wears on whoever took
// part in it, at the end of the ET.
export function explore(id: string, action: ExplorationAction): CampaignUpdater {
  return onCharacter(id, (s) => getExplorationBar(s, id), (c) => {
    const wear = getWear(c, action)
    return {
      ...c,
      injuries: { ...c.injuries, injuryLevel: c.injuries.injuryLevel + wear.IL },
      resources: { ...c.resources, exhaustion: c.resources.exhaustion + wear.exhaustion },
    }
  })
}

// survival.tex "Short Rest": "spend an ET doing nothing, which recovers 1
// exhaustion".
export function shortRest(id: string, exposure: number): CampaignUpdater {
  return onCharacter(id, (s) => getRestBar(s, id, exposure), (c) => {
    const rested = spendPotion(c)
    return { ...rested, resources: { ...rested.resources, exhaustion: Math.max(0, rested.resources.exhaustion - 1) } }
  })
}

// survival.tex "Sleep": "It heals IL, recovers exhaustion" — the potion's
// healing first, then the sleep's own, which costs hunger and thirst.
export function sleep(id: string, exposure: number): CampaignUpdater {
  return onCharacter(id, (s) => getRestBar(s, id, exposure), (c) => {
    const slept = { ...c, resources: { ...c.resources, exhaustion: getSleptExhaustion(c, exposure) } }
    return healUpTo(getRestHealing(c, exposure))(spendPotion(slept))
  })
}

// survival.tex "Hunger": "Each portion eaten recovers a number of hunger
// points defined in the portion itself."
export function eat(id: string, nutrition: number): CampaignUpdater {
  return onCharacter(id, (s) => getExplorationBar(s, id), (c) =>
    ({ ...c, resources: { ...c.resources, hunger: Math.max(0, c.resources.hunger - Math.max(0, nutrition)) } }))
}

// survival.tex "Thirst": "Every portion of water recovers 1 thirst".
export function drink(id: string): CampaignUpdater {
  return onCharacter(id, (s) => getExplorationBar(s, id), (c) =>
    ({ ...c, resources: { ...c.resources, thirst: Math.max(0, c.resources.thirst - 1) } }))
}


// survival.tex "Exploration Turn (ET)": the party's clock moves on to the
// start of the next ET.
export function passET(state: CampaignState): CampaignState {
  return { ...state, clock: getNextET(state.clock) }
}
