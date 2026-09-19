'use client'

import { ReactNode, useLayoutEffect, useRef, useState } from 'react'
import type { Term } from '../domain/character/lenses'

const EDGE = 8

// Hover tooltip showing the per-term breakdown of a derived value. It opens
// centred above the tile, then slides sideways just enough to stay inside the
// viewport, and drops below the tile when there is no room above.
// Zero-value terms are hidden to keep the breakdown readable.
export function SkillTooltip({ terms, total, children }: {
  terms: Term[]
  total: number
  children: ReactNode
}) {
  const visible = terms.filter((t) => t.value !== 0)
  const [open, setOpen] = useState(false)
  const [shift, setShift] = useState({ x: 0, below: false })
  const tip = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!open || !tip.current) return
    const r = tip.current.getBoundingClientRect()
    const x = r.left < EDGE ? EDGE - r.left : r.right > window.innerWidth - EDGE ? window.innerWidth - EDGE - r.right : 0
    setShift({ x, below: r.top < EDGE })
  }, [open])

  return (
    <div className="relative" onMouseEnter={() => setOpen(true)} onMouseLeave={() => { setOpen(false); setShift({ x: 0, below: false }) }}>
      {children}
      {open ?
      <div ref={tip} role="tooltip"
        style={{ transform: `translateX(calc(-50% + ${shift.x}px))` }}
        className={`absolute z-50 left-1/2 ${shift.below ? 'top-full mt-1' : 'bottom-full mb-1'}
                    whitespace-nowrap bg-raised border border-line rounded p-2 text-xs shadow-lg shadow-black/40 text-left`}
      >
        {visible.map((t, i) => (
          <div key={i} className="flex justify-between gap-3">
            <span className="text-muted">{t.label}</span>
            <span className={`font-mono ${t.value >= 0 ? 'text-good' : 'text-bad'}`}>
              {t.value >= 0 ? `+${t.value}` : t.value}
            </span>
          </div>
        ))}
        <div className="border-t border-line mt-1 pt-1 flex justify-between gap-3 font-medium">
          <span>total</span>
          <span className="font-mono">{total}</span>
        </div>
      </div>
      : null}
    </div>
  )
}
