'use client'

import { NumberInput, SectionLabel } from './ui';
import { useSenseFlag, useSenseNumber } from '../hooks/useSenseLens';
import type { Senses } from '../domain/types';

const SENSES: (keyof Senses)[] = ['vision', 'hearing', 'smell', 'touch', 'synesthesia']

function Flag({ sense, field }: { sense: keyof Senses, field: 'hasSense' | 'active' | 'reactive' }) {
  const [value, setValue] = useSenseFlag(sense, field)
  return <input type='checkbox' className='justify-self-center accent-accent' aria-label={`${sense} ${field}`} checked={value} onChange={(e) => setValue(e.target.checked)} />
}

function Value({ sense, field }: { sense: keyof Senses, field: 'bonus' | 'penalty' }) {
  const [value, setValue] = useSenseNumber(sense, field)
  return <NumberInput className='w-14 py-0.5 text-sm' aria-label={`${sense} ${field}`} value={value} onChange={(e) => setValue(parseInt(e.target.value) || 0)} />
}

// combat.tex "Senses": which senses the character has, which detect actively
// and which react, the sensory penalty of relying on each and the bonus each
// adds to awareness.
export function SensesPanel() {
  return (
    <div className='flex flex-col gap-1'>
      <SectionLabel>Senses</SectionLabel>
      <div className='grid grid-cols-[auto_repeat(5,minmax(0,1fr))] sm:grid-cols-[auto_repeat(3,2.5rem)_repeat(2,minmax(0,4rem))] gap-x-2 gap-y-1 items-center w-fit'>
        <span />
        <SectionLabel className='text-center'>has</SectionLabel>
        <SectionLabel className='text-center'>active</SectionLabel>
        <SectionLabel className='text-center'>reactive</SectionLabel>
        <SectionLabel className='text-center'>penalty</SectionLabel>
        <SectionLabel className='text-center'>bonus</SectionLabel>
        {SENSES.map((s) => (
          <div key={s} className='contents'>
            <span className='text-xs text-muted'>{s}</span>
            <Flag sense={s} field='hasSense' />
            <Flag sense={s} field='active' />
            <Flag sense={s} field='reactive' />
            <Value sense={s} field='penalty' />
            <Value sense={s} field='bonus' />
          </div>
        ))}
      </div>
    </div>
  )
}
