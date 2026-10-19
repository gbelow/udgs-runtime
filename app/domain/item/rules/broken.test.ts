import { describe, it, expect } from 'vitest'
import { makeCampaignCharacter } from '../../factories'
import { ItemSchema } from '../../types'
import { getWeaponPanels } from '../../character/lenses/gear'
import { getAttackOptions } from '../../scene/rules/attack'
import { getMeleeRange } from '../../scene/rules/board/board'
import { breakItem, holdItem, repairItem } from '../commands'

// gear.tex "Weapon Breakage": "A broken weapon can no longer be used".
describe('a broken weapon', () => {
  const dagger = ItemSchema.parse({ name: 'Dagger', type: 'weapon', refId: 'Dagger', bulk: 1 })
  const held = holdItem(dagger)(makeCampaignCharacter({}))
  const heldRows = (c: typeof held) => getWeaponPanels(c, true).filter((p) => p.itemId === dagger.id).flatMap((p) => p.rows)

  it('is offered as no attack, in the panel or the combat options, until it is repaired', () => {
    expect(heldRows(held).some((r) => r.usable)).toBe(true)
    expect(getAttackOptions(held, 'strike', true).some((o) => o.weaponKey === dagger.id)).toBe(true)

    const broken = breakItem(dagger.id)(held)
    expect(heldRows(broken).some((r) => r.usable)).toBe(false)
    expect(getAttackOptions(broken, 'strike', true).some((o) => o.weaponKey === dagger.id)).toBe(false)

    expect(heldRows(repairItem(dagger.id)(broken)).some((r) => r.usable)).toBe(true)
  })

  // A broken weapon still counted as reach, so its holder was offered opportunity attacks with no row to answer them.
  it('threatens nobody until it is repaired', () => {
    const daggers = [1, 2].map(() => ItemSchema.parse({ name: 'Dagger', type: 'weapon', refId: 'Dagger', bulk: 1 }))
    const held = daggers.reduce((c, d) => holdItem(d)(c), makeCampaignCharacter({}))
    const broken = daggers.reduce((c, d) => breakItem(d.id)(c), held)
    expect(getMeleeRange(held)).toBeGreaterThan(0)
    expect(getMeleeRange(broken)).toBe(0)
    expect(getMeleeRange(daggers.reduce((c, d) => repairItem(d.id)(c), broken))).toBe(getMeleeRange(held))
  })
})
