'use client'
import { useContainerLens } from '../hooks/useContainerLens'
import { useItemLens } from '../hooks/useItemLens'
import type { ContainerSlotView } from '../domain/item/lenses'

export function ContainerPanel(){
  const { panels, burden, unequip } = useContainerLens()
  const { pending, clear } = useItemLens()

  return(
    <div className='flex flex-col w-84 md:w-full gap-1'>
      <div className='flex flex-row gap-3 justify-center'>
        <span className='font-bold'>Containers</span>
        <span>burden: {burden.label}</span>
      </div>
      {
        pending ?
        <div className='flex flex-row gap-2 justify-center items-center text-xs text-green-300'>
          <span>placing {pending.key} ×{pending.amount} — pick a slot group</span>
          <input type='button' value='cancel' onClick={clear} className='border rounded px-1' />
        </div>
        : null
      }
      {
        panels.length === 0 ?
        <span className='text-xs text-gray-400'>none equipped</span> :
        panels.map((panel) => (
          <div key={panel.key} className='flex flex-col border rounded p-1 text-left'>
            <div className='flex flex-row gap-3 items-center'>
              <span className='font-bold'>{panel.name}</span>
              <span className='text-xs text-gray-400'>{panel.kind} · {panel.burden}</span>
              <input type='button' value='unequip' onClick={() => unequip(panel.key)} className='border rounded px-1 ml-auto' />
            </div>
            {panel.slots.map((group) => <SlotGroupRow key={group.slot} containerKey={panel.key} group={group} />)}
          </div>
        ))
      }
    </div>
  )
}

function SlotGroupRow({ containerKey, group }: { containerKey: string, group: ContainerSlotView }){
  const { place, remove } = useItemLens()
  const dimmed = group.fits === false

  return(
    <div className={'flex flex-row gap-2 items-baseline text-xs ' + (dimmed ? 'text-gray-500' : '')}>
      <span className='w-24 shrink-0'>
        {group.slot}{group.slot === 'quick' ? ` (${group.bulkName})` : ''}
      </span>
      <span className={'w-10 shrink-0 ' + (group.available < 0 ? 'text-red-400' : '')}>{group.used}/{group.numSlots}</span>
      {
        group.fits ?
        <input type='button' value='+ place' aria-label={`place in ${containerKey} ${group.slot}`} onClick={() => place(containerKey, group.slot)} className='border border-green-400 text-green-300 rounded px-1' />
        : null
      }
      <div className='flex flex-row flex-wrap gap-1'>
        {group.items.map((item) => (
          <span key={item.id} className='border rounded px-1 flex flex-row gap-1' title={`${item.bulkName} · ${item.slots} slot${item.slots === 1 ? '' : 's'}`}>
            <span>{item.name}{item.amount > 1 ? ` ×${item.amount}` : ''}</span>
            {item.amount > 1 ? <button type='button' aria-label={`remove one ${item.name}`} className='text-gray-400 hover:text-white' onClick={() => remove(containerKey, item.id, 1)}>−</button> : null}
            <button type='button' aria-label={`remove ${item.name}`} className='text-gray-400 hover:text-white' onClick={() => remove(containerKey, item.id)}>×</button>
          </span>
        ))}
      </div>
    </div>
  )
}
