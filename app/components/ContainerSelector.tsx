'use client'
import { useContainerLens } from '../hooks/useContainerLens';
import { ListButton } from './ui';

export function ContainerSelector(){
  const { catalog, equip } = useContainerLens()

  return(
    <div className='flex flex-col gap-0.5 w-full'>
      {
        catalog.map((row) => (
          <ListButton key={row.key} className='flex flex-col items-start py-1' aria-label={row.name} onClick={() => equip(row.key)}>
            <span>{row.name}</span>
            <span className='text-xs text-muted'>
              {row.slots.map((s) => `${s.numSlots} ${s.slot} (${s.bulkName})`).join(' · ')}
              {' · burden '}{row.burden}
            </span>
          </ListButton>
        ))
      }
    </div>
  )
}
