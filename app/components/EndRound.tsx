'use client'
import { useState } from 'react'
import { Check } from 'lucide-react'
import { useEndRound } from '../hooks/useEndRound'
import { Button, Tooltip } from './ui'

// Agreeing to end the round for everyone the screen plays, asked again with
// the AP it leaves unspent.
export function EndRound(){
  const { view, agree } = useEndRound()
  const [asking, setAsking] = useState(false)
  if (view.bar !== null && !view.agreed) return null
  const confirming = asking && !view.agreed && view.lost.length > 0
  const press = () => { if (view.agreed) agree(false); else if (view.lost.length > 0) setAsking(!asking); else agree(true) }
  return (
    <>
      <Tooltip text={view.bar ?? (view.agreed ? 'all your characters agreed to end the round: take it back' : 'all your characters agree to end the round')}>
        <Button size='xs' aria-label='end round ok' aria-pressed={view.agreed} selected={view.agreed || confirming} icon={view.agreed ? Check : undefined} disabled={view.bar !== null} onClick={press}>end round ok</Button>
      </Tooltip>
      {confirming ? (
        <div role='alertdialog' aria-label='confirm end round' className='basis-full flex flex-col gap-1.5 rounded border border-bad/60 bg-bad/5 p-2 text-xs'>
          <span className='font-semibold text-bad'>The round ends once everyone agrees. AP lost:</span>
          {view.lost.map((l) => (
            <span key={l.id}>{l.name} <span className='font-mono'>{l.AP} AP</span>{l.surge ? <span className='text-muted'> and the surge not made</span> : null}</span>
          ))}
          <span className='text-muted'>Until then it can still be used, and at the round change it can pay for a rest or a social action.</span>
          <div className='flex flex-row gap-1'>
            <Button size='xs' weight='solid' tone='bad' onClick={() => { agree(true); setAsking(false) }}>end the round</Button>
            <Button size='xs' weight='ghost' onClick={() => setAsking(false)}>cancel</Button>
          </div>
        </div>
      ) : null}
    </>
  )
}
