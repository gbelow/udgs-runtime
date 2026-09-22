'use client'
import { useContainerLens } from '../hooks/useContainerLens'
import { useItemLens } from '../hooks/useItemLens'
import type { ContainerSlotView } from '../domain/item/projections/containers'
import { Button, Panel } from './ui'

export function ContainerPanel(){
  const { panels, burden, unequip } = useContainerLens()
  const { pending, clear } = useItemLens()

  return(
    <Panel title='Containers' meta={<>burden · {burden.label}</>} pending={!!pending}>
      {
        pending ?
        <div className='flex flex-row flex-wrap gap-2 items-center text-xs text-good'>
          <span>{pending.source === 'catalog' ? `placing ${pending.key} ×${pending.amount}` : pending.source === 'worn' ? 'taking armor off' : 'storing from hand'} — pick a slot group</span>
          <Button size='xs' onClick={clear}>cancel</Button>
        </div>
        : null
      }
      {
        panels.length === 0 ?
        <span className='text-xs text-muted'>none equipped</span> :
        panels.map((panel) => (
          <div key={panel.key} className='flex flex-col gap-1 rounded border border-line px-1.5 py-1'>
            <div className='flex flex-row flex-wrap gap-x-3 items-baseline text-xs'>
              <span className='text-sm'>{panel.name}</span>
              <span className='text-muted'>{panel.kind} · burden {panel.burden}</span>
              {panel.penalty && panel.penalty.value > 0 ? <span className='text-bad font-mono'>−{panel.penalty.value}{panel.penalty.lame ? ' · lame' : ''}</span> : null}
              <Button size='xs' variant='ghost' className='ml-auto' onClick={() => unequip(panel.key)}>unequip</Button>
            </div>
            {panel.slots.map((group) => <SlotGroupRow key={group.slot} containerKey={panel.key} group={group} />)}
          </div>
        ))
      }
    </Panel>
  )
}

function SlotGroupRow({ containerKey, group }: { containerKey: string, group: ContainerSlotView }){
  const { place, remove, draw, wear } = useItemLens()
  const dimmed = group.fits === false

  return(
    <div className={`flex flex-row flex-wrap gap-2 items-baseline text-xs ${dimmed ? 'text-muted' : ''}`}>
      <span className='w-28 shrink-0 text-muted'>
        {group.slot} ({group.bulkName})
      </span>
      <span className={`w-8 shrink-0 font-mono ${group.available < 0 ? 'text-bad' : ''}`}>{group.used}/{group.numSlots}</span>
      {
        group.fits ?
        <Button size='xs' variant='good' aria-label={`place in ${containerKey} ${group.slot}`} onClick={() => place(containerKey, group.slot)}>{group.storeCost === null ? '+ place' : `+ store (${group.storeCost} AP)`}</Button>
        : null
      }
      <div className='flex flex-row flex-wrap gap-1'>
        {group.items.map((item) => (
          <span key={item.id} className='border border-line rounded px-1.5 py-0.5 flex flex-row gap-1.5 items-center' title={`${item.bulkName} · ${item.slots} slot${item.slots === 1 ? '' : 's'}`}>
            <span>{item.name}{item.amount > 1 ? ` ×${item.amount}` : ''}</span>
            {item.drawable ? <button type='button' aria-label={`draw ${item.name}`} title={item.drawCost === null ? 'take in hand' : `take in hand for ${item.drawCost} AP`} className='text-muted hover:text-fg cursor-pointer' onClick={() => draw(containerKey, item.id)}>{item.drawCost === null ? 'draw' : `draw ${item.drawCost}AP`}</button> : null}
            {item.wear ? <button type='button' aria-label={`wear ${item.name}`} disabled={!item.wear.wearable} title={item.wear.wearable ? (item.wear.cost === null ? 'put on' : `put on for ${item.wear.cost} AP`) : item.wear.why} className={item.wear.wearable ? 'text-muted hover:text-fg cursor-pointer' : 'text-muted/50 cursor-not-allowed'} onClick={() => wear(containerKey, item.id)}>{item.wear.cost === null ? 'wear' : `wear ${item.wear.cost}AP`}</button> : null}
            {item.amount > 1 ? <button type='button' aria-label={`remove one ${item.name}`} className='text-muted hover:text-fg cursor-pointer' onClick={() => remove(containerKey, item.id, 1)}>−</button> : null}
            <button type='button' aria-label={`remove ${item.name}`} className='text-muted hover:text-bad cursor-pointer' onClick={() => remove(containerKey, item.id)}>×</button>
          </span>
        ))}
      </div>
    </div>
  )
}
