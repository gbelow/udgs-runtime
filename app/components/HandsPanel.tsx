'use client'
import { useHandsLens } from '../hooks/useHandsLens'
import { useItemLens } from '../hooks/useItemLens'
import { Button, Panel, Row } from './ui'

export function HandsPanel(){
  const { panel, hold, regrip, drop, wear } = useHandsLens()
  const { pending, selectHeld, clear } = useItemLens()

  return(
    <Panel title='Hands' meta={`${panel.freeHolding} free`} pending={!!panel.canHold}>
      {
        panel.canHold ?
        <div className='flex flex-row flex-wrap gap-2 items-center text-xs text-good'>
          <span>hold in</span>
          {panel.canHold[1] ? <Button size='xs' variant='good' aria-label='hold in one hand' onClick={() => hold(1)}>one hand</Button> : null}
          {panel.canHold[2] ? <Button size='xs' variant='good' aria-label='hold in two hands' onClick={() => hold(2)}>two hands</Button> : null}
          {!panel.canHold[1] && !panel.canHold[2] ? <span className='text-muted'>no free hand</span> : panel.lamingHold ? <span className='text-bad'>lames</span> : null}
        </div>
        : null
      }
      <div className='flex flex-row flex-wrap gap-1 text-xs'>
        {panel.hands.map((hand) => (
          <span key={hand.index} className={`border border-line rounded px-1.5 py-0.5 ${hand.item ? '' : 'text-muted'}`} title={hand.canHold ? 'can hold gear' : 'cannot hold gear'}>
            {hand.name}: {hand.item ? hand.item.name : (hand.naturalWeapon || 'free')}
          </span>
        ))}
      </div>
      {panel.held.length ?
      <div className='flex flex-col gap-1'>
        {panel.held.map((item) => {
          const putting = pending?.source === 'hand' && pending.itemId === item.id
          return (
            <Row key={item.id} pending={putting}>
              <span>{item.name}{item.amount > 1 ? ` ×${item.amount}` : ''}</span>
              <span className='text-muted'>size {item.scale} · {item.bulkName} · {item.grip}h{item.laming ? <span className='text-bad'> · lame</span> : null}</span>
              {item.canGrip[1] ? <Button size='xs' aria-label={`grip ${item.name} with one hand`} onClick={() => regrip(item.id, 1)}>1h</Button> : null}
              {item.canGrip[2] ? <Button size='xs' aria-label={`grip ${item.name} with two hands`} onClick={() => regrip(item.id, 2)}>2h</Button> : null}
              {item.wear ? <Button size='xs' variant='good' aria-label={`wear ${item.name}`} disabled={!item.wear.wearable} title={item.wear.wearable ? '' : item.wear.why} onClick={() => wear(item.id)}>{item.wear.cost === null ? 'wear' : `wear (${item.wear.cost} AP)`}</Button> : null}
              <span className='ml-auto flex flex-row gap-1'>
                {
                  putting ?
                  <Button size='xs' aria-label={`cancel storing ${item.name}`} onClick={clear}>cancel</Button> :
                  <Button size='xs' aria-label={`store ${item.name}`} onClick={() => selectHeld(item.id)}>store</Button>
                }
                <Button size='xs' variant='ghost' aria-label={`drop ${item.name}`} onClick={() => drop(item.id)}>drop</Button>
              </span>
            </Row>
          )
        })}
      </div> : null}
    </Panel>
  )
}
