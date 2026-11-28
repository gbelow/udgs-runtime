'use client'
import { useRole } from '../hooks/useRole'
import { Segment, Segmented } from './ui'

// Who the screen acts as, for whoever has the GM's tools: the character
// picked, or the GM, who does to the mode what no character does.
export function ActAs(){
  const { gmTools, gm, setGmMode } = useRole()
  if (!gmTools) return null
  return(
    <Segmented label='act as'>
      <Segment aria-label='act as character' selected={!gm} onClick={() => setGmMode(false)}>character</Segment>
      <Segment aria-label='act as GM' selected={gm} onClick={() => setGmMode(true)}>GM</Segment>
    </Segmented>
  )
}
