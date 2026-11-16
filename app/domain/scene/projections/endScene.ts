import type { Table } from '../types'
import { getEndSceneBar, isFromRoster } from '../rules/fight'
import { getFightName } from '../rules/fighters'
import { isDead } from '../../character/rules/afflictions'

// Ending the scene as the table sees it: why it cannot be ended now, and the
// living brought straight into the fight, whom the table may keep in the
// campaign; everyone sent from it goes back to it whatever is kept.
export type EndSceneView = { bar: string | null; made: { id: string; name: string }[] }

export function getEndSceneView(table: Table): EndSceneView {
  const made = Object.values(table.fight.characters).filter((c) => !isDead(c) && !isFromRoster(table, c.id))
  return { bar: getEndSceneBar(table.fight), made: made.map((c) => ({ id: c.id, name: getFightName(table.fight, c.id) })) }
}
