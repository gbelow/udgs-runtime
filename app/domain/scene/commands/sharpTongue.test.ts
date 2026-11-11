import { describe, it, expect } from 'vitest'
import { SceneStateSchema, type SceneState } from '../types'
import { makeAction } from '../factories'
import { makeCampaignCharacter } from '../../factories'
import { grantAbility } from '../../character/commands/abilities'
import type { AbilityKey } from '../../abilities'
import { landSocial } from './social'

const fighter = (id: string, abilities: AbilityKey[] = []) =>
  ({ ...abilities.reduce((acc, key) => grantAbility(key)(acc), makeCampaignCharacter({ name: id })), id })

// `a` and `ally` fight `b`.
const inFight = (abilities: AbilityKey[]): SceneState => ({
  ...SceneStateSchema.parse({ round: 2 }),
  characters: { a: fighter('a', abilities), ally: fighter('ally'), b: fighter('b') },
  partyOf: { a: 'x', ally: 'x', b: 'y' },
})

const taunt = makeAction('taunt', { id: 't', actorId: 'a', targetId: 'b' })

// abilities.tex "Sharp Tongue": "Also rallies their team when they taunt an enemy".
describe('Sharp Tongue', () => {
  it('rallies the taunter’s allies as the taunt lands', () => {
    const s = landSocial(inFight(['sharp-tongue']), taunt)
    expect(s.pressure.some((p) => p.from === 'a' && p.kind === 'taunt' && p.target === 'b')).toBe(true)
    expect(s.pressure.some((p) => p.from === 'a' && p.kind === 'rally' && p.target === 'ally')).toBe(true)
  })

  it('rallies nobody without it', () => {
    const s = landSocial(inFight([]), taunt)
    expect(s.pressure.some((p) => p.kind === 'rally')).toBe(false)
  })
})
