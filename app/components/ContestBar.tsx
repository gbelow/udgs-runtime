'use client'
import { useGmBar } from '../hooks/useControl'
import { useContest } from '../hooks/useContest'
import { ActionKey, Button, Segment, Segmented } from './ui'

// The time to contest the turn just taken: what is left of it, and, to
// whoever may contest, asking for the time to say with whom, saying it, or
// letting the turn go.
export function ContestBar(){
  const { view, left, share, think, pick, mode, settle, close } = useContest()
  const gmBar = useGmBar()
  if (!view) return null
  const { holder, holderOwn, own, thinking, decided, others, contenders } = view
  const chosen = own.some((c) => c.contesting)
  return (
    <div role='group' aria-label='contest the turn' className='basis-full shrink-0 flex flex-row flex-wrap items-center gap-2 rounded border border-accent/60 bg-accent/5 px-2 py-1.5 text-xs'>
      <span className='basis-full text-sm font-semibold text-fg'>
        {thinking ? 'Who contests ' : own.length > 0 && !decided ? 'Contest ' : ''}
        <span className={holderOwn ? 'text-accent' : 'text-bad'}>{holder}</span>
        {thinking || (own.length > 0 && !decided) ? <>&apos;s turn?</> : <>&apos;s turn may be contested</>}
      </span>
      {others && !thinking ? <span className='text-accent'>waiting on {others}</span> : null}
      {left === null ? null : (
        <span className='flex flex-row items-center gap-1.5'>
          <span className='font-mono w-10'>{left.toFixed(1)}s</span>
          <span className='inline-block w-24 h-1.5 rounded bg-line overflow-hidden'><span className='block h-full bg-accent' style={{ width: `${share}%` }} /></span>
        </span>
      )}
      {own.length > 0 && !thinking && !decided ? (
        <>
          <ActionKey look='go' aria-label={`contest ${holder}'s turn`} onClick={think}>contest</ActionKey>
          <ActionKey aria-label='let it go' onClick={() => settle(false)}>let it go</ActionKey>
        </>
      ) : null}
      {thinking ? (
        <>
          {own.map((c) => (
            <span key={c.id} className='inline-flex items-center gap-1'>
              <ActionKey look={c.contesting ? 'picked' : 'plain'} aria-label={`contest with ${c.name}`} aria-pressed={c.contesting} onClick={() => pick(c.id)}>{c.name}</ActionKey>
              {c.contesting && c.modes.length > 1 ? (
                <Segmented label={`cunning of ${c.name}`}>
                  {c.modes.map((m) => <Segment key={m} selected={m === c.mode} onClick={() => mode(c.id, m)}>{m}</Segment>)}
                </Segmented>
              ) : null}
            </span>
          ))}
          <ActionKey look='go' aria-label='contest with them' disabled={!chosen} title={chosen ? undefined : 'pick who contests first'} onClick={() => settle(true)}>contest</ActionKey>
          <ActionKey aria-label='drop the contest' onClick={() => settle(false)}>drop it</ActionKey>
        </>
      ) : null}
      {contenders ? <span className='text-muted'>contested by {contenders}</span> : null}
      {decided && !thinking ? <span className='text-muted'>waiting on the others</span> : null}
      {gmBar === null ? <Button size='xs' weight='ghost' aria-label='close the contest' title='the time to contest is over now: the contest is rolled if anyone asked' onClick={close}>close now</Button> : null}
    </div>
  )
}
