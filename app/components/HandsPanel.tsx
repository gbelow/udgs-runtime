'use client'
import { useHandsLens } from '../hooks/useHandsLens'
import { useItemLens } from '../hooks/useItemLens'

export function HandsPanel(){
  const { panel, hold, regrip, drop, wear } = useHandsLens()
  const { pending, selectHeld, clear } = useItemLens()

  return(
    <div className='flex flex-col w-84 md:w-full gap-1'>
      <div className='flex flex-row gap-3 justify-center'>
        <span className='font-bold'>Hands</span>
        <span className='text-xs text-gray-400'>{panel.freeHolding} free</span>
      </div>
      {
        panel.canHold ?
        <div className='flex flex-row gap-2 justify-center items-center text-xs text-green-300'>
          <span>hold in</span>
          {panel.canHold[1] ? <input type='button' value='one hand' aria-label='hold in one hand' onClick={() => hold(1)} className='border border-green-400 rounded px-1' /> : null}
          {panel.canHold[2] ? <input type='button' value='two hands' aria-label='hold in two hands' onClick={() => hold(2)} className='border border-green-400 rounded px-1' /> : null}
          {!panel.canHold[1] && !panel.canHold[2] ? <span className='text-gray-500'>no free hand</span> : null}
        </div>
        : null
      }
      <div className='flex flex-row flex-wrap gap-1 justify-center text-xs'>
        {panel.hands.map((hand) => (
          <span key={hand.index} className='border rounded px-1' title={hand.canHold ? 'can hold gear' : 'cannot hold gear'}>
            {hand.name}: {hand.item ? hand.item.name : (hand.naturalWeapon || 'free')}
          </span>
        ))}
      </div>
      <div className='flex flex-col gap-1 text-xs'>
        {panel.held.map((item) => {
          const putting = pending?.source === 'hand' && pending.itemId === item.id
          return (
            <div key={item.id} className={'flex flex-row flex-wrap gap-2 items-center border rounded px-1 ' + (putting ? 'border-green-400' : '')}>
              <span>{item.name}{item.amount > 1 ? ` ×${item.amount}` : ''}</span>
              <span className='text-gray-400'>size {item.scale} · {item.bulkName} · {item.grip}h</span>
              {item.canGrip[1] ? <input type='button' value='1h' aria-label={`grip ${item.name} with one hand`} onClick={() => regrip(item.id, 1)} className='border rounded px-1' /> : null}
              {item.canGrip[2] ? <input type='button' value='2h' aria-label={`grip ${item.name} with two hands`} onClick={() => regrip(item.id, 2)} className='border rounded px-1' /> : null}
              {item.wear ? <input type='button' value={item.wear.cost === null ? 'wear' : `wear (${item.wear.cost} AP)`} aria-label={`wear ${item.name}`} disabled={!item.wear.wearable} title={item.wear.wearable ? '' : item.wear.why} onClick={() => wear(item.id)} className={'border rounded px-1 ' + (item.wear.wearable ? '' : 'text-gray-600 border-gray-600')} /> : null}
              {
                putting ?
                <input type='button' value='cancel' aria-label={`cancel storing ${item.name}`} onClick={clear} className='border rounded px-1 ml-auto' /> :
                <input type='button' value='store' aria-label={`store ${item.name}`} onClick={() => selectHeld(item.id)} className='border rounded px-1 ml-auto' />
              }
              <input type='button' value='drop' aria-label={`drop ${item.name}`} onClick={() => drop(item.id)} className='border rounded px-1' />
            </div>
          )
        })}
      </div>
    </div>
  )
}
