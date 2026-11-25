'use client'
import { SkipForward } from 'lucide-react'
import { useEndTurn } from '../hooks/useCombatState'
import { useCombatCommands } from '../hooks/useCombatCommands'
import { ActionKey, Tooltip } from './ui'

// The end of the turn held by someone the screen plays, whoever is picked.
export function EndTurn(){
  const view = useEndTurn()
  const { endTurn } = useCombatCommands()
  if (!view) return null
  return (
    <Tooltip text={view.bar ?? 'end the turn; movement and combat surge AP left is lost'}>
      <ActionKey look='go' icon={SkipForward} aria-label='endTurn' disabled={view.bar !== null} onClick={endTurn}>end {view.name}&apos;s turn</ActionKey>
    </Tooltip>
  )
}
