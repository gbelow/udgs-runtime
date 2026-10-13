'use client'
import type { ReactNode } from 'react'
import { useRole } from '../hooks/useRole'
import { useGearBar } from '../hooks/useCombatState'

// Controls shown closed, with why, while `bar` says they cannot be used.
export function Locked({ bar, children }: { bar: string | null, children: ReactNode }){
  return(
    <>
      {bar ? <span className='text-xs text-muted'>{bar}</span> : null}
      <fieldset disabled={bar !== null} className='min-w-0 flex flex-col gap-2'>{children}</fieldset>
    </>
  )
}

// What only the GM changes: closed until the action bar is switched to GM.
// Each lock subscribes for itself, so the panels inside are not drawn again
// when it opens or closes.
export function GmLocked({ children }: { children: ReactNode }){
  const { gm } = useRole()
  return <Locked bar={gm ? null : 'edited by the GM: switch the action bar to GM'}>{children}</Locked>
}

// The active character's gear: closed outside their own turn.
export function GearLocked({ children }: { children: ReactNode }){
  return <Locked bar={useGearBar()}>{children}</Locked>
}
