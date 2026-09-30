import { describe, it, expect } from 'vitest'
import { canCastSpell } from './spells'
import { makeCampaignCharacter } from '../../factories'
import { SPELLS, SPELL_KEYS, type SpellKey } from '../../spells'
import { ContainerSchema, ItemSchema } from '../../types'

// Everything a cast asks of the caster but its requirements: the spell
// learned, the focus surge used, the pools full, nothing held.
function readyToCast(key: SpellKey, extra: object = {}) {
  return makeCampaignCharacter({ spells: { [key]: { method: 'intuitive', practice: 0 } }, usedSurge: 'focus', resources: { AP: 99, STA: 99 }, ...extra })
}

const blocksCast = (key: SpellKey) => SPELLS[key].castRequirements.some((item) => item.every((alt) => alt.kind !== 'condition' && !alt.not))

// spells.tex "Requirements": "Some spells may even be impossible to cast if
// the minimum conditions are not met." A condition is the table's to judge.
describe('a spell is cast only with its requirements met', () => {
  const rolled = SPELL_KEYS.filter((key) => SPELLS[key].DL !== null)

  it.each(rolled.filter(blocksCast))('%s is not castable without them', (key) => {
    expect(canCastSpell(readyToCast(key), key, false)).toBe(false)
  })

  it.each(rolled.filter((key) => !blocksCast(key)))('%s is castable with nothing it needs missing', (key) => {
    expect(canCastSpell(readyToCast(key), key, false)).toBe(true)
  })
})

// A grenade only in the backpack let a charged spell be cast and paid for,
// and the charge landed nowhere.
it('gear carried but not at hand does not cast', () => {
  const grenade = ItemSchema.parse({ name: 'Grenade', type: 'weapon', refId: 'Grenade', bulk: 1 })
  const pack = ContainerSchema.parse({ name: 'Backpack', kind: 'backpack', slots: { medium: { numSlots: 12, items: [grenade] } } })
  expect(canCastSpell(readyToCast('shock-explosive', { containers: { pack } }), 'shock-explosive', false)).toBe(false)
})
