import type { CampaignCharacter } from '../../types'
import type { SceneState, SocialSay } from '../types'
import { getAfflictions } from '../../character/rules/afflictions'
import { canAffordRest } from '../../character/rules/rest'
import { ActionCost, getActionCost } from '../../character/rules/actionCosts'
import { getPressureKey } from './morale'
import { getSituationalAfflictions } from './situational'
import { getStressSocial } from './stress'
import { getIncomingAP } from './roundChange'

// Everyone in the fight in another party than the character's: their
// enemies.
export function getEnemies(state: SceneState, id: string): string[] {
  const party = getPressureKey(state, id)
  return Object.keys(state.characters).filter((t) => getPressureKey(state, t) !== party)
}

// Who hears what is said: combat.tex "Intimidation": "all enemies"; "Rally":
// "allies", the rest of the party; creating.tex "Limit Stress Actions"
// (abusive): "insult allies", the same party. A negotiation, a surrender and
// an unsurrender reach nobody the fight tracks.
export function getHeard(state: SceneState, id: string, say: SocialSay): string[] {
  if (say === 'intimidate') return getEnemies(state, id)
  if (say === 'rally' || say === 'insult') return Object.keys(state.characters).filter((t) => t !== id && getPressureKey(state, t) === getPressureKey(state, id))
  return []
}

// combat.tex "Social actions": "Every social action costs 5 AP"; combat.tex
// "Surrender": unflagging is free.
export function getSocialCost(c: CampaignCharacter, say: SocialSay): ActionCost {
  return say === 'unsurrender' ? { AP: 0, STA: 0 } : getActionCost(c, 'socialAction')
}

// combat.tex "Social actions": each "counts as a Rest action", so like a rest
// it may overdraw the AP the round brings.
function getSocialAPBar(state: SceneState, c: CampaignCharacter): string | null {
  return canAffordRest(c, 'socialAction', getIncomingAP(state)) ? null : 'not enough AP'
}

// Why the character cannot say it now, beside what closes any of their own
// actions (rules/options.ts), or null.
export function getSocialSayBar(state: SceneState, c: CampaignCharacter, say: SocialSay): string | null {
  switch (say) {
    case 'intimidate':
    case 'rally':
      return getHeard(state, c.id, say).length === 0 ? 'nobody to say it to' : getSocialAPBar(state, c)
    // creating.tex "Limit Stress Actions" (abusive): only the abusive in their
    // owed turn
    case 'insult':
      if (getStressSocial(state, c.id) !== 'insult') return 'not compelled to insult'
      return getHeard(state, c.id, say).length === 0 ? 'nobody to insult' : getSocialAPBar(state, c)
    case 'negotiate':
      return getSocialAPBar(state, c)
    // combat.tex "Surrender": the flag is raised once
    case 'surrender':
      return state.surrendered.includes(c.id) ? 'already surrendered' : getSocialAPBar(state, c)
    // combat.tex "Surrender": the character "can unflag itself as surrendered
    // at any time, as long as it is not dominated"; free
    case 'unsurrender':
      if (!state.surrendered.includes(c.id)) return 'not surrendered'
      return getAfflictions(c, getSituationalAfflictions(state, c.id)).includes('dominated') ? 'dominated' : null
  }
}

// combat.tex "Taunt": "one enemy".
export function getTauntBar(state: SceneState, c: CampaignCharacter): string | null {
  return getEnemies(state, c.id).length === 0 ? 'nobody to taunt' : getSocialAPBar(state, c)
}
