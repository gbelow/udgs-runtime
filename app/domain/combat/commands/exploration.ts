import type { CampaignCharacter } from '../../types'
import type { ExplorationAction } from '../../lists'
import type { CombatState, Updater } from '../types'
import { heal } from '../../character/commands/heal'
import { bleed } from '../../character/commands/bleed'
import { burnScorch, extinguish } from '../../character/commands/deliver'
import { isDead } from '../../character/rules/afflictions'
import { getEndCombatBar, getExplorationBar, getRestBar, getRestHealing, getSleptExhaustion, getWear } from '../rules/exploration'
import { resetCombat } from './resetCombat'

const onCharacter = (id: string, bar: (state: CombatState) => string | null, update: (c: CampaignCharacter) => CampaignCharacter): Updater =>
  (state) => (bar(state) ? state : { ...state, characters: { ...state.characters, [id]: update(state.characters[id]) } })

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
export function explore(id: string, action: ExplorationAction): Updater {
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
export function shortRest(id: string, exposure: number): Updater {
  return onCharacter(id, (s) => getRestBar(s, id, exposure), (c) => {
    const rested = spendPotion(c)
    return { ...rested, resources: { ...rested.resources, exhaustion: Math.max(0, rested.resources.exhaustion - 1) } }
  })
}

// survival.tex "Sleep": "It heals IL, recovers exhaustion" — the potion's
// healing first, then the sleep's own, which costs hunger and thirst.
export function sleep(id: string, exposure: number): Updater {
  return onCharacter(id, (s) => getRestBar(s, id, exposure), (c) => {
    const slept = { ...c, resources: { ...c.resources, exhaustion: getSleptExhaustion(c, exposure) } }
    return healUpTo(getRestHealing(c, exposure))(spendPotion(slept))
  })
}

// survival.tex "Hunger": "Each portion eaten recovers a number of hunger
// points defined in the portion itself."
export function eat(id: string, nutrition: number): Updater {
  return onCharacter(id, (s) => getExplorationBar(s, id), (c) =>
    ({ ...c, resources: { ...c.resources, hunger: Math.max(0, c.resources.hunger - Math.max(0, nutrition)) } }))
}

// survival.tex "Thirst": "Every portion of water recovers 1 thirst".
export function drink(id: string): Updater {
  return onCharacter(id, (s) => getExplorationBar(s, id), (c) =>
    ({ ...c, resources: { ...c.resources, thirst: Math.max(0, c.resources.thirst - 1) } }))
}

// What the end of a fight does to each character: the fire touched this turn
// burns, then combat.tex "Burning": "At the end of combat, burning damage is
// caused once and the counter is set to 0"; combat.tex "Bleed": "When
// combat/chase ends, bleeding causes 3x its current value and stops by
// itself"; what lasts for the rest of the fight — a potion drunk, a light
// cast — is gone, and so is what the round held.
function leaveFight(c: CampaignCharacter): CampaignCharacter {
  if (isDead(c)) return c
  const bled = bleed(3)(extinguish(burnScorch(c)))
  return {
    ...bled,
    injuries: { ...bled.injuries, bleed: 0 },
    active: bled.active.filter((e) => e.kind !== 'potion' && e.kind !== 'light'),
    resources: { ...bled.resources, AP: 0, surgeAP: 0 },
    usedSurge: null,
    runsFree: false,
  }
}

// Ends the fight and keeps everyone in it, where they stand, with what the
// fight left on them; the round goes back to 0, out of combat.
export function endCombat(state: CombatState): CombatState {
  if (getEndCombatBar(state)) return state
  const characters = Object.fromEntries(Object.entries(state.characters).map(([id, c]) => [id, leaveFight(c)]))
  return {
    ...resetCombat(state),
    characters,
    activeCharacterId: state.activeCharacterId,
    board: state.board,
    floor: state.floor,
    fleeing: false,
    turnQueue: [],
    fleers: [],
  }
}
