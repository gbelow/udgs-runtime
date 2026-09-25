import { describe, it, expect } from 'vitest'
import { CombatStateSchema, type CombatState } from '../types'
import { makeCampaignCharacter } from '../../factories'
import type { CampaignCharacter } from '../../types'
import { getOutcomePreviews } from './outcomes'
import { getOpenAction } from '../rules/log'
import { commitAction, declareAction, resolveAction, rollAction, setTarget } from '../commands/action'

function fighter(id: string): CampaignCharacter {
  const base = makeCampaignCharacter({ name: id })
  return { ...base, id, resources: { ...base.resources, AP: 8, STA: 6 } }
}

function combat(...characters: CampaignCharacter[]): CombatState {
  return { ...CombatStateSchema.parse({}), characters: Object.fromEntries(characters.map((c) => [c.id, c])) }
}

// The preview shown before "done" is computed by the same function the
// resolution applies; the target's sheet has to move by exactly what was
// shown.
describe('the preview', () => {
  it('is what the target takes', () => {
    let n = 0
    const newId = () => `a${++n}`
    let s = combat(fighter('atk'), fighter('def'))
    s = declareAction('atk', { kind: 'strike', weaponKey: 'natural:Unarmed', attack: 'punch', variant: 'heavyI' }, newId)(s)
    s = setTarget('def')(s)
    s = commitAction()(s)
    s = rollAction(() => 30, newId)(s)
    const open = getOpenAction(s)!
    const preview = getOutcomePreviews(s, open)[0].outcome
    expect(preview.tier).not.toBeNull()

    const after = resolveAction(newId)(s)
    expect(after.characters.def.injuries.injuryLevel - s.characters.def.injuries.injuryLevel).toBe(preview.IL)
    expect(after.characters.def.injuries.bleed - s.characters.def.injuries.bleed).toBe(preview.bleed)
    expect(s.characters.def.resources.AP - after.characters.def.resources.AP).toBe(preview.apLoss)
  })
})
