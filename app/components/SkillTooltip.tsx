'use client'

import { ReactNode } from 'react'
import type { Term } from '../domain/character/lenses'

// True when an affliction-sourced term is actively reducing the value.
// Used to color-code skills that are currently penalized by afflictions.
const AFFLICTION_LABELS = new Set(['affliction', 'immobile'])
export function isAfflicted(terms: Term[]): boolean {
  return terms.some((t) => AFFLICTION_LABELS.has(t.label) && t.value < 0)
}

// Hover tooltip showing the per-term breakdown of a derived skill value.
// Tailwind-only, no JS state: the `group`/`group-hover:` pair toggles visibility.
// Zero-value terms are hidden to keep the breakdown readable.
export function SkillTooltip({ terms, total, children }: {
  terms: Term[]
  total: number
  children: ReactNode
}) {
  const visible = terms.filter((t) => t.value !== 0)

  return (
    <div className="group relative">
      {children}
      <div
        className="absolute z-50 left-1/2 -translate-x-1/2 bottom-full mb-1
                   hidden group-hover:block whitespace-nowrap bg-gray-900 border
                   border-gray-600 rounded p-2 text-xs shadow-lg"
      >
        {visible.map((t, i) => (
          <div key={i} className="flex justify-between gap-3">
            <span className="text-gray-300">{t.label}</span>
            <span className={t.value >= 0 ? 'text-green-400' : 'text-red-400'}>
              {t.value >= 0 ? `+${t.value}` : t.value}
            </span>
          </div>
        ))}
        <div className="border-t border-gray-700 mt-1 pt-1 flex justify-between gap-3 font-bold">
          <span>total</span>
          <span>{total}</span>
        </div>
      </div>
    </div>
  )
}
