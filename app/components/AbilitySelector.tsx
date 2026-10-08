'use client'
import { useState, type ReactNode } from 'react'
import { Button, CatalogList, Tooltip } from './ui'
import { groupBy } from '../domain/utils'
import { useAbilityLens } from '../hooks/useAbilityLens'
import type { AbilityFamilyView } from '../domain/character/lenses/abilities'

// Browse the catalog one family per row; a click learns the next stage. The
// stage descriptions unfold under the row so the reader can see what each
// stage adds before committing.
export function AbilitySelector(){
  const { catalog, learn } = useAbilityLens()
  return(
    <CatalogList label='ability' groups={groupBy(catalog, (row) => row.section)} nameOf={(row) => row.family} render={(row) => (
      <AbilityFamilyRow key={row.family} row={row} action={
        row.next ?
        <Button size='xs' variant='good' aria-label={`learn ${row.next.name}`} onClick={() => learn(row.next!.key)}>{row.stages.length > 1 ? `+ ${row.next.name}` : '+ learn'}</Button>
        : row.complete ? <span className='text-xs text-muted px-1'>learned</span>
        : <LockedLabel reason={row.blocked} />
      } />
    )} />
  )
}

// One family of the catalog: its name, progress and usage, a click unfolding
// every stage; `action` is what the row offers on its right.
export function AbilityFamilyRow({ row, action }: { row: AbilityFamilyView; action: ReactNode }){
  const [open, setOpen] = useState(false)
  return(
    <div className='flex flex-col'>
      <div className='flex flex-row items-center'>
        <button type='button' aria-label={`${row.family} details`}
          className='text-left px-1 rounded text-sm grow cursor-pointer hover:bg-raised'
          onClick={() => setOpen(!open)}>
          {row.family}
          {row.progress ? <span className='text-xs text-muted'> {row.progress}</span> : null}
          <span className='text-xs text-muted'> · {row.usage}</span>
        </button>
        {action}
      </div>
      {
        open ?
        <div className='flex flex-col gap-1 px-2 pb-1 text-xs'>
          {row.stages.map((stage) => (
            <div key={stage.key} className={stage.learned ? '' : 'text-muted'}>
              <span className={stage.learned ? 'text-good' : 'text-fg'}>{stage.name}</span>
              {stage.price ? <span className='text-muted'> {stage.price}</span> : null}
              {stage.requirements ? <span className='text-muted'> · needs {stage.requirements}</span> : null}
              {' — '}{stage.description || 'nothing new at this level'}
              {stage.unmet.length ? <span className='block text-bad'>missing {stage.unmet.join(' · ')}</span> : null}
            </div>
          ))}
        </div>
        : null
      }
    </div>
  )
}

// A family whose next stage cannot be learned, with what it lacks on hover.
export function LockedLabel({ reason }: { reason: string }){
  return (
    <Tooltip text={reason}>
      <span className='text-xs text-muted px-1'>locked</span>
    </Tooltip>
  )
}
