'use client'
import { useContainerLens } from '../hooks/useContainerLens';

export function ContainerSelector(){
  const { catalog, equip } = useContainerLens()

  return(
    <div className='text-center w-full'>
      {
        catalog.map((row) => (
          <div key={row.key} className='flex flex-col hover:bg-gray-500 p-1'>
            <input type={'button'} className='text-center w-full' value={row.name} aria-label={row.name} onClick={() => equip(row.key)} />
            <span className='text-xs text-gray-400'>
              {row.slots.map((s) => `${s.numSlots} ${s.slot} (${s.bulkName})`).join(' · ')}
              {' · burden '}{row.burden}
            </span>
          </div>
        ))
      }
    </div>
  )
}
