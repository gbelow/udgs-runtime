'use client'
import { useActiveFace } from '../hooks/useCombatState'
import { Card } from './SceneCards'

// The character picked as the screen is shown them, when it is shown only
// their token: the face, with how much is left of them and nothing to press.
export function ActiveFace(){
  const card = useActiveFace()
  return card ? <Card card={card} onClick={() => undefined} /> : null
}
