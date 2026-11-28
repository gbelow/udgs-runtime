'use client'
import { Pause, Play } from 'lucide-react'
import { useBotsPaused } from '../hooks/useBots'
import { Button, Tooltip } from './ui'
import { useKeyMap } from '../hooks/useKeyMap'
import { keyLabel } from '../keys'

// The bots paused or playing, and the switch between, in the action bar while
// any is in the fight.
export function BotsPause(){
  const { paused, inPlay, bar, toggle, pauseKey } = useBotsPaused()
  const key = keyLabel(useKeyMap(), 'bots.pause')
  if (!inPlay && !paused) return null
  const what = paused ? 'the bots make no move until they are started again' : 'stop the bots, to contest a turn or to think'
  return (
    <Tooltip text={bar ?? `${what}${pauseKey ? ` (${key}, over the board)` : ''}`}>
      <Button size='xs' aria-label='pause bots' aria-pressed={paused} icon={paused ? Play : Pause} weight={paused ? 'solid' : 'outline'} tone={paused ? 'accent' : 'neutral'} disabled={bar !== null} onClick={toggle}>
        {paused ? 'bots paused' : 'pause bots'}
      </Button>
    </Tooltip>
  )
}
