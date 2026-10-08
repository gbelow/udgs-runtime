'use client'
import { useState, type ReactNode } from 'react'
import { Button, SectionLabel, TextInput } from './ui'
import { useAbilityLens } from '../hooks/useAbilityLens'
import type { AbilityFamilyView } from '../domain/character/lenses/abilities'

// Browse the catalog one family per row; a click learns the next stage. The
// stage descriptions unfold under the row so the reader can see what each
// stage adds before committing.
export function AbilitySelector(){
  const { catalog, learn } = useAbilityLens()
  const [filter, setFilter] = useState('')
  const [open, setOpen] = useState<string | null>(null)

  const needle = filter.trim().toLowerCase()
  const visible = needle ? catalog.filter((row) => row.family.toLowerCase().includes(needle)) : catalog
  const sections = visible.reduce<Record<string, AbilityFamilyView[]>>((acc, row) => {
    (acc[row.section] ??= []).push(row)
    return acc
  }, {})

  return(
    <div className='flex flex-col w-full gap-1'>
      <TextInput className='w-full' placeholder='filter' aria-label='ability filter' value={filter} onChange={(e) => setFilter(e.target.value)} />
      {
        Object.entries(sections).map(([section, rows]) => (
          <div key={section} className='flex flex-col'>
            <SectionLabel className='px-1 pt-2'>{section}</SectionLabel>
            {rows.map((row) => (
              <AbilityFamilyRow key={row.family} row={row} open={open === row.family} onToggle={() => setOpen(open === row.family ? null : row.family)} action={
                row.next ?
                <Button size='xs' variant='good' aria-label={`learn ${row.next.name}`} onClick={() => learn(row.next!.key)}>{row.stages.length > 1 ? `+ ${row.next.name}` : '+ learn'}</Button>
                : <span className='text-xs text-muted px-1'>{row.complete ? 'learned' : 'locked'}</span>
              } />
            ))}
          </div>
        ))
      }
    </div>
  )
}

// One family of the catalog: its name, progress and usage, a click unfolding
// every stage; `action` is what the row offers on its right.
export function AbilityFamilyRow({ row, open, onToggle, action, dimmed = false }: { row: AbilityFamilyView; open: boolean; onToggle: () => void; action: ReactNode; dimmed?: boolean }){
  return(
    <div className='flex flex-col'>
      <div className='flex flex-row items-center'>
        <button type='button' aria-label={`${row.family} details`}
          className={`text-left px-1 rounded text-sm grow cursor-pointer hover:bg-raised ${dimmed ? 'text-muted' : ''}`}
          onClick={onToggle}>
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
            </div>
          ))}
        </div>
        : null
      }
    </div>
  )
}
