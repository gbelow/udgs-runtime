'use client'
import type { ReactNode } from 'react'
import { useRole } from '../hooks/useRole'
import { useGearBar } from '../hooks/useCombatState'
import { useActiveControlBar, useControlBar } from '../hooks/useControl'

// Controls shown closed, with why, while `bar` says they cannot be used,
// laid out as `className` says (a column by default).
export function Locked({ bar, className = 'min-w-0 flex flex-col gap-2', quiet = false, children }: { bar: string | null, className?: string, quiet?: boolean, children: ReactNode }){
  return(
    <>
      {bar && !quiet ? <span className='text-xs text-muted'>{bar}</span> : null}
      <fieldset disabled={bar !== null} title={bar && quiet ? bar : undefined} className={className}>{children}</fieldset>
    </>
  )
}

// What only the GM changes: closed until the action bar is switched to GM.
// Each lock subscribes for itself, so the panels inside are not drawn again
// when it opens or closes.
export function GmLocked({ children }: { children: ReactNode }){
  const { gm } = useRole()
  return <Locked quiet bar={gm ? null : 'edited by the GM: switch the action bar to GM'}>{children}</Locked>
}

// The active character's gear: closed outside their own turn.
export function GearLocked({ children }: { children: ReactNode }){
  return <Locked bar={useGearBar()}>{children}</Locked>
}

// What the active character does and has: closed to whoever does not play
// them, who may still look.
export function ControlLocked({ children }: { children: ReactNode }){
  return <Locked bar={useActiveControlBar()}>{children}</Locked>
}

// The same for what character `id` does, whoever is active.
export function LockedFor({ id, className, children }: { id: string | null, className?: string, children: ReactNode }){
  return <Locked bar={useControlBar(id)} className={className}>{children}</Locked>
}
