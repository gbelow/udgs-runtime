'use client'
import { Route, X } from 'lucide-react'
import { ActionKey, Button, Closed } from './ui'
import { useFollowPick } from '../hooks/useFollowPick'
import type { FollowOffer } from '../domain/scene/projections/turn'

// combat.tex "Follow": the entry of the tactical actions that asks whom the
// active character follows this round. Pressed, the next click on a token or
// the roster marks them; once marked, pressing it takes the mark back.
export function FollowOption({ offer, onPress }: { offer: FollowOffer, onPress: () => void }){
  const { picking, start, release } = useFollowPick()
  const press = () => {
    if (offer.marked) release()
    else start()
    onPress()
  }

  return(
    <Closed reason={offer.bar}>
      <ActionKey icon={Route} look={picking || offer.marked ? 'picked' : 'plain'} cost='free' aria-label='follow'
        title={offer.marked ? `stop following ${offer.marked}` : 'then click whom to follow on the board or the roster'}
        disabled={offer.bar !== null} onClick={press}>
        {offer.marked ? `following ${offer.marked}` : 'follow'}
      </ActionKey>
    </Closed>
  )
}

// What the panel says while the pick waits for a click.
export function FollowPicking(){
  const { picking, cancel } = useFollowPick()
  if (!picking) return null
  return(
    <div className='flex flex-row flex-wrap gap-2 items-center text-xs'>
      <Route size={13} aria-hidden className='text-accent' />
      <span>click whom to follow, on the board or the roster</span>
      <Button size='xs' icon={X} aria-label='cancel follow' onClick={cancel}>cancel</Button>
    </div>
  )
}
