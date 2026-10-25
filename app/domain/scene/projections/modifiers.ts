import type { Action, ActionDraft, SceneState } from '../types'
import type { ActionCost } from '../../character/rules/actionCosts'
import { getModifierToggles } from '../rules/modifiers'

// What an action may be declared as besides, as every panel that declares one
// shows it: each modifier offered as a toggle and open where the action
// stands, or declared already so it can be taken back, what it does to the
// price and the test, and what pressing it declares.
export type ModifierView = { key: string; label: string; on: boolean; allowed: boolean; title: string; press: Partial<ActionDraft> }

export function getModifierViews(state: SceneState, action: Action): ModifierView[] {
  return getModifierToggles(state, action).map((t) => ({
    key: t.key,
    label: t.label,
    on: t.on,
    allowed: t.allowed,
    title: t.allowed ? [priceText(t.price), ...t.terms.map((term) => `${signed(term.value)} to the test`)].filter((s) => s !== '').join(', ') : 'cannot be declared here',
    press: { modifiers: t.modifiers } as Partial<ActionDraft>,
  }))
}

function priceText(price: { set: ActionCost } | { add: ActionCost }): string {
  if ('set' in price) return `${price.set.AP} AP + ${price.set.STA} STA in place of the price`
  return [price.add.AP ? `${signed(price.add.AP)} AP` : '', price.add.STA ? `${signed(price.add.STA)} STA` : ''].filter((s) => s !== '').join(' ')
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : `${n}`
}
