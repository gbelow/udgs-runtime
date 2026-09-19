'use client'

import { ReactNode } from 'react'
import type { Term } from '../domain/character/lenses'
import { Popover } from './ui'

// Hover breakdown of a derived value, one line per term. Zero-value terms are
// hidden to keep the breakdown readable.
export function SkillTooltip({ terms, total, children }: {
  terms: Term[]
  total: number
  children: ReactNode
}) {
  const visible = terms.filter((t) => t.value !== 0)

  return (
    <Popover content={
      <div className='whitespace-nowrap'>
        {visible.map((t, i) => (
          <div key={i} className='flex justify-between gap-3'>
            <span className='text-muted'>{t.label}</span>
            <span className={`font-mono ${t.value >= 0 ? 'text-good' : 'text-bad'}`}>
              {t.value >= 0 ? `+${t.value}` : t.value}
            </span>
          </div>
        ))}
        <div className='border-t border-line mt-1 pt-1 flex justify-between gap-3 font-medium'>
          <span>total</span>
          <span className='font-mono'>{total}</span>
        </div>
      </div>
    }>
      {children}
    </Popover>
  )
}
