import { describe, it, expect } from 'vitest'
import { makeCampaignCharacter } from '../../factories'
import { ItemSchema } from '../../types'
import { getWeaponPanels } from '../../character/lenses/gear'
import { getAttackOptions } from '../../combat/rules/attack'
import { breakItem, holdItem, repairItem } from '../commands'

// gear.tex "Weapon Breakage": "A broken weapon can no longer be used".
describe('a broken weapon', () => {
  const dagger = ItemSchema.parse({ name: 'Dagger', type: 'weapon', refId: 'Dagger', bulk: 1 })
  const held = holdItem(dagger)(makeCampaignCharacter({}))
  const heldRows = (c: typeof held) => getWeaponPanels(c).filter((p) => p.itemId === dagger.id).flatMap((p) => p.rows)

  it('is offered as no attack, in the panel or the combat options, until it is repaired', () => {
    expect(heldRows(held).some((r) => r.usable)).toBe(true)
    expect(getAttackOptions(held, 'strike').some((o) => o.weaponKey === dagger.id)).toBe(true)

    const broken = breakItem(dagger.id)(held)
    expect(heldRows(broken).some((r) => r.usable)).toBe(false)
    expect(getAttackOptions(broken, 'strike').some((o) => o.weaponKey === dagger.id)).toBe(false)

    expect(heldRows(repairItem(dagger.id)(broken)).some((r) => r.usable)).toBe(true)
  })
})
