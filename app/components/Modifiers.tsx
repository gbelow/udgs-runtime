'use client'
import type { ModifierView } from '../domain/scene/projections/modifiers'
import { Button } from './ui'


// What an action is declared as besides, the same wherever it is declared:
// on a turn, as an answer, or prepared.
export function Modifiers({ modifiers, onPress }: { modifiers: ModifierView[], onPress: (fields: ModifierView['press']) => void }){
  if (modifiers.length === 0) return null
  return (
    <div className='flex flex-row flex-wrap gap-1 items-center'>
      {modifiers.map((m) =>
        <Button key={m.key} size='xs' selected={m.on} title={m.title} onClick={() => onPress(m.press)}>{m.label}</Button>)}
    </div>
  )
}
