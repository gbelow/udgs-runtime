import { describe, it, expect } from 'vitest'
import { CombatStateSchema, StrikeActionSchema, type Board, type CombatState } from '../types'
import { makeCampaignCharacter } from '../../factories'
import type { CampaignCharacter } from '../../types'
import { ACTIONS, isReaction } from '../actionCatalog'
import type { ActionKind } from '../types'
import { getAvailableActions, getDLTerms, getOpenAction, getTargetIds } from './action'
import { getStrikeReach } from './board'
import { declareAction, setTarget } from '../commands/action'
import { getCatalogItem, getItemScale } from '../../item/lenses/items'
import { getWieldedWeapons } from '../../item/lenses/hands'

function fighter(id: string, extra: Record<string, unknown> = {}): CampaignCharacter {
  const base = makeCampaignCharacter({ name: id, ...extra })
  return { ...base, id, resources: { ...base.resources, AP: 8, STA: 6 } }
}

function combat(board: Board | null, ...characters: CampaignCharacter[]): CombatState {
  return { ...CombatStateSchema.parse({ board }), characters: Object.fromEntries(characters.map((c) => [c.id, c])) }
}

let n = 0
const newId = () => `a${++n}`

// The board's contract (`CombatStateSchema`): a fight with no board is a
// fight in which every positional gate passes. So it must read exactly like
// a fight on a board where nothing positional is in the way — attacker and
// defender adjacent on flat ground, every cell open.
describe('a fight without a board is a fight where every positional gate passes', () => {
  const open: Board = {
    placements: {
      atk: { cell: { q: 0, r: 0 }, orientation: 0, elevation: 0, focus: null },
      def: { cell: { q: 1, r: 0 }, orientation: 0, elevation: 0, focus: null },
    },
    terrain: {},
    radius: 6,
  }

  function declared(board: Board | null): CombatState {
    let s = combat(board, fighter('atk'), fighter('def'))
    s = declareAction('atk', { kind: 'strike', weaponKey: 'natural:Unarmed', attack: 'punch', variant: 'basic' }, newId)(s)
    return setTarget('def')(s)
  }

  it('offers the same targets', () => {
    const [bare, placed] = [declared(null), declared(open)]
    expect(getTargetIds(bare, getOpenAction(bare)!)).toEqual(getTargetIds(placed, getOpenAction(placed)!))
  })

  it('scores against the same DL', () => {
    const [bare, placed] = [declared(null), declared(open)]
    expect(getDLTerms(bare, getOpenAction(bare)!)).toEqual(getDLTerms(placed, getOpenAction(placed)!))
  })

  const reactions = (Object.keys(ACTIONS) as ActionKind[]).filter(isReaction)
  it.each(reactions)('leaves "%s" as open as it is on open ground', (kind) => {
    const [bare, placed] = [declared(null), declared(open)]
    const pick = (s: CombatState) => getAvailableActions(s, 'def').filter((o) => o.draft.kind === kind).map((o) => [o.available, o.reason])
    expect(pick(bare)).toEqual(pick(placed))
  })
})

// Ruling: gear.tex "Short, Long I/II" gives a reach of 1m x RM, which for
// the smallest weapons comes to less than a cell; the table's decision is
// that a strike always reaches an adjacent target.
describe('reach never falls under a cell', () => {
  const daggers = [1, 2, 3, 4, 5, 6, 7].map((scale) => getCatalogItem('Dagger', 1, scale)!)
  it.each(daggers.map((item) => [getItemScale(item), item] as const))('a dagger of scale %i', (_scale, item) => {
    const atk = fighter('atk', {
      held: [item],
      hands: [{ name: 'left', naturalWeapon: 'Unarmed', canHold: true, itemId: item.id }, { name: 'right', naturalWeapon: 'Unarmed', canHold: true, itemId: '' }],
    })
    const s = combat(null, atk, fighter('def'))
    const [row] = getWieldedWeapons(atk).filter((w) => w.key !== 'natural:Unarmed')
    const action = StrikeActionSchema.parse({ id: 'x', kind: 'strike', actorId: 'atk', weaponKey: row.key, attack: row.weapon.attacks[0].name })
    const reach = getStrikeReach(s, action)
    expect(reach).not.toBeNull()
    expect(reach!).toBeGreaterThanOrEqual(1)
  })
})
