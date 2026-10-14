'use client'
import type { StrikeModifierView } from '../domain/scene/projections/strikeDeclaration'
import { Button } from './ui'


// What a strike is declared as besides, the same wherever a strike is
// declared: on a turn, as an answer, or prepared.
export function StrikeModifiers({ modifiers, onPress }: { modifiers: StrikeModifierView[], onPress: (fields: StrikeModifierView['press']) => void }){
  if (modifiers.length === 0) return null
  return (
    <div className='flex flex-row flex-wrap gap-1 items-center'>
      {modifiers.map((m) =>
        <Button key={m.key} size='xs' selected={m.on}
          title={m.allowed ? (m.replaces ? `${m.AP} AP + ${m.STA} STA in place of the attack's` : `+${m.AP} AP +${m.STA} STA`) : 'cannot be declared here'}
          onClick={() => onPress(m.press)}>{m.label}</Button>)}
    </div>
  )
}
