'use client'
import { useContainerLens } from '../hooks/useContainerLens'
import type { ContainerSlotView } from '../domain/item/lenses'

export function ContainerPanel(){
  const { panels, burden, unequip } = useContainerLens()

  return(
    <div className='flex flex-col w-84 md:w-full gap-1'>
      <div className='flex flex-row gap-3 justify-center'>
        <span className='font-bold'>Containers</span>
        <span>burden: {burden.label}</span>
      </div>
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
            {panel.slots.map((group) => <SlotGroupRow key={group.slot} group={group} />)}
          </div>
        ))
      }
    </div>
  )
}

function SlotGroupRow({ group }: { group: ContainerSlotView }){
  return(
    <div className='flex flex-row gap-2 items-baseline text-xs'>
      <span className='w-24 shrink-0'>
        {group.slot}{group.slot === 'quick' ? ` (${group.bulkName})` : ''}
      </span>
      <span className={'w-10 shrink-0 ' + (group.available < 0 ? 'text-red-400' : '')}>{group.used}/{group.numSlots}</span>
      <div className='flex flex-row flex-wrap gap-1'>
        {group.items.map((item) => (
          <span key={item.id} className='border rounded px-1' title={`${item.bulkName} · ${item.slots} slot${item.slots === 1 ? '' : 's'}`}>
            {item.name}{item.amount > 1 ? ` ×${item.amount}` : ''}
          </span>
        ))}
      </div>
    </div>
  )
}
