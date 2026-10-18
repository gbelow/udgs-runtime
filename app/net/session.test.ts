import { describe, expect, it } from 'vitest'
import { makeCampaignCharacter } from '../domain/factories'
import { useCombatStore } from '../stores/useCombatStore'
import { useCampaignStore } from '../stores/useCampaignStore'
import { landShared } from './session'
import { readShared, sharedOf, type Shared } from './protocol'

const shared = () => sharedOf(useCombatStore.getState(), useCampaignStore.getState())

// the host's state as a guest receives it: over JSON
const wire = (s: Shared) => JSON.parse(JSON.stringify(s)) as Shared

describe('what a guest lands from the host', () => {
  it('never carries or overwrites the screen\'s own selection', () => {
    const mine = makeCampaignCharacter({ name: 'mine', id: 'mine' })
    useCombatStore.setState({ characters: { mine }, activeCharacterId: 'mine' })
    useCampaignStore.setState({ characters: { mine }, activeCharacterId: 'mine' })
    const before = shared()

    const whole = readShared(wire(before))
    expect(whole.scene).not.toHaveProperty('activeCharacterId')
    expect(whole.campaign).not.toHaveProperty('activeCharacterId')

    landShared(whole)

    expect(useCombatStore.getState().activeCharacterId).toBe('mine')
    expect(useCampaignStore.getState().activeCharacterId).toBe('mine')
  })
})
