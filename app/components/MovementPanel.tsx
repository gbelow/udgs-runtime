'use client'

import { NumberInput, SectionLabel } from './ui';
import { useMovementLens } from '../hooks/useMovementLens';
import type { Movement } from '../domain/types';

const MOVES: { name: keyof Movement, title: string }[] = [
  { name: 'basic', title: 'basic' },
  { name: 'careful', title: 'careful' },
  { name: 'crawl', title: 'crawl' },
  { name: 'climb', title: 'climb' },
  { name: 'run', title: 'run' },
  { name: 'swim', title: 'swim' },
  { name: 'jump', title: 'jump' },
  { name: 'stand', title: 'stand up' },
]

function Cell({ move, field, step }: { move: keyof Movement, field: 'distance' | 'AP' | 'STA', step?: number }) {
  const [value, setValue] = useMovementLens(move, field)
  return <NumberInput className='w-14 py-0.5 text-sm' aria-label={`${move} ${field}`} step={step} value={value}
    onChange={(e) => setValue((step && !Number.isInteger(step) ? parseFloat(e.target.value) : parseInt(e.target.value)) || 0)} />
}

// A block of each movement: what it costs and how far it goes. Standing up
// crosses no cells, so it has no distance.
export function MovementPanel() {
  return (
    <div className='flex flex-col gap-1'>
      <SectionLabel>Movement</SectionLabel>
      <div className='grid grid-cols-[auto_repeat(3,minmax(0,1fr))] sm:grid-cols-[auto_repeat(3,minmax(0,4rem))] gap-x-2 gap-y-1 items-center w-fit'>
        <span />
        <SectionLabel className='text-center'>AP</SectionLabel>
        <SectionLabel className='text-center'>STA</SectionLabel>
        <SectionLabel className='text-center'>metres</SectionLabel>
        {MOVES.map((m) => (
          <div key={m.name} className='contents'>
            <span className='text-xs text-muted'>{m.title}</span>
            <Cell move={m.name} field='AP' />
            <Cell move={m.name} field='STA' />
            {m.name === 'stand' ? <span /> : <Cell move={m.name} field='distance' step={0.1} />}
          </div>
        ))}
      </div>
    </div>
  )
}
