import { describe, expect, it } from 'vitest'
import { board, spearman, swordsman } from '../scene/fixtures'
import { getAttackOptions } from '../scene/rules/attack'
import { getOpenAction } from '../scene/rules/log'
import { amendAction, commitAction, declareAction, setTarget } from '../scene/commands/action'
import { bestSpend } from './predict'

let n = 0
const newId = () => `p${++n}`
const ctx = { thrower: () => 5, newId }

describe('what an attack aimed at an item its target holds would do', () => {
  // The fuzzer: the spend was read as injuring the holder, whom the attack
  // never lands on.
  it('is read to injure nobody', () => {
    const start = { ...board({ a: [0, 0], d: [1, 0] }, spearman('a'), swordsman('d')), inTurnCharacter: 'a' }
    const [row] = getAttackOptions(start.characters.a, 'strike', true)
    const declared = setTarget('d')(declareAction('a', { kind: 'strike', weaponKey: row.weaponKey, attack: row.attack, variant: row.variant }, newId)(start))
    const committed = commitAction(() => 5, newId)(amendAction({ object: start.characters.d.held[0].id })(declared))
    expect(getOpenAction(committed)).toMatchObject({ targetId: 'd', object: start.characters.d.held[0].id, step: 'react' })
    for (const roll of [{ degree: 'miss' as const }, { degree: 'hit' as const, HOP: 5 }]) {
      const spent = bestSpend(committed, roll, [], ctx)
      expect(spent).toMatchObject({ ok: true, outcome: null, best: { prediction: { ok: true, outcomes: [] } } })
    }
  })
})
