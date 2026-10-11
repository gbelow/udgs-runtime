import type { SceneState } from '../types'
import { STRIKE_MODIFIERS, getStrikeContext, type StrikeHolder, type StrikeModifierKey } from '../rules/strikeDeclaration'

// What a strike may be declared as besides, as every panel that declares one
// shows it: each modifier open where the strike stands, or declared already
// so it can be taken back, and what it does to the price — its own in place
// of the variation's (`replaces`), or added to it — and what pressing it
// declares.
export type StrikeModifierView = { key: StrikeModifierKey; label: string; on: boolean; allowed: boolean; AP: number; STA: number; replaces: boolean; press: Partial<Record<StrikeModifierKey, boolean>> }

export function getStrikeModifierViews(state: SceneState, holder: StrikeHolder): StrikeModifierView[] {
  const ctx = getStrikeContext(state, holder)
  if (!ctx) return []
  return (Object.keys(STRIKE_MODIFIERS) as StrikeModifierKey[]).flatMap((key) => {
    const modifier = STRIKE_MODIFIERS[key]
    const on = holder[key]
    const allowed = modifier.allowed(ctx)
    if (!on && !allowed) return []
    const change = modifier.price(ctx)
    const price = 'set' in change ? change.set : change.add
    return [{ key, label: modifier.label, on, allowed, AP: price.AP, STA: price.STA, replaces: 'set' in change, press: { [key]: !on } }]
  })
}
