'use client'
import { useState, type ReactNode } from 'react'
import { Button, Menu, MenuItem, TextInput } from './ui'
import { useGmBar } from '../hooks/useControl'

// The pieces every arrangement of parties is drawn with, in a fight or out
// of one: what differs is only which commands they call.

// A new, empty party under the name typed, or the next free party name.
export function CreateParty({ create, hint }: { create: (name: string) => void, hint: string }){
  const [name, setName] = useState('')
  const gmBar = useGmBar()

  return(
    <div className='flex flex-row gap-1 items-center'>
      <TextInput className='w-36 text-xs' aria-label='new party name' placeholder='party name' value={name} disabled={gmBar !== null} onChange={(e) => setName(e.target.value)} />
      <Button size='xs' weight='solid' tone='accent' aria-label='create party' disabled={gmBar !== null} title={gmBar ?? hint} onClick={() => { create(name.trim()); setName('') }}>create party</Button>
    </div>
  )
}

// Who is being switched, and the way back out of it.
export function SwitchBanner({ name, cancel }: { name: string, cancel: () => void }){
  return(
    <span className='flex flex-row gap-1 items-center text-xs text-accent'>
      click a party to put {name} in
      <Button size='xs' weight='subtle' aria-label='cancel switch' onClick={cancel}>cancel</Button>
    </span>
  )
}

// The party a switched member would make of their own.
export function NewPartySlot({ name, onClick }: { name: string, onClick: () => void }){
  return(
    <button type='button' aria-label='into a new party' onClick={onClick}
      className='min-w-56 min-h-24 p-2 rounded border border-dashed border-accent text-xs text-accent bg-accent/5 hover:bg-accent/15 flex items-center justify-center'>
      new party with only {name}
    </button>
  )
}

// A party's column: while a member is being switched, a click on an open one
// puts them here, and a closed one says why not.
// A party only the scene has is drawn dashed.
export function PartyFrame({ target = false, adding = false, closed = null, sceneOnly = false, place, children }: { target?: boolean, adding?: boolean, closed?: string | null, sceneOnly?: boolean, place?: () => void, children: ReactNode }){
  const frame = target ? 'border-accent bg-accent/5 cursor-pointer hover:bg-accent/15' : adding ? 'border-accent' : 'border-line'
  return(
    <div className={`flex flex-col items-start gap-2 p-2 rounded border min-w-56 ${sceneOnly ? 'border-dashed' : ''} ${frame}`} onClick={target ? place : undefined}>
      {target ? <span className='text-xs text-accent'>put here</span> : null}
      {closed ? <span className='text-xs text-muted'>{closed}</span> : null}
      {children}
    </div>
  )
}

// A party's name, renamed in place, and its menu: the catalog opened for it
// first, then whatever else `children` offers.
// `tag` says what kind of party it is, beside its name.
export function PartyHeader({ name, rename, adding, toggleAdding, locked = false, tag, children }: { name: string, rename: (name: string) => void, adding: boolean, toggleAdding: () => void, locked?: boolean, tag?: ReactNode, children?: ReactNode }){
  const gmBar = useGmBar()
  return(
    <div className='flex flex-row gap-1 items-center'>
      <TextInput key={name} className='w-40 text-xs font-medium' aria-label={`${name} name`} disabled={gmBar !== null || locked} title={gmBar ?? "the party's name"} defaultValue={name} onBlur={(e) => rename(e.target.value.trim())} />
      {tag}
      <Menu label={`${name} options`}>
        <MenuItem bar={locked ? 'pick the party to switch into first' : null} selected={adding} hint='open the catalog beside the party' onClick={toggleAdding}>{adding ? 'stop adding characters' : 'add characters'}</MenuItem>
        {children}
      </Menu>
    </div>
  )
}

// What kind of party it is: the campaign's, kept with its place and
// timeline, or only the scene's, gone with it unless it is brought back.
export function PartyKindTag({ campaign }: { campaign: boolean }){
  return campaign
    ? <span className='text-[10px] uppercase tracking-wider px-1 rounded border border-line text-fg' title='kept in the campaign, with its place and timeline'>campaign</span>
    : <span className='text-[10px] uppercase tracking-wider px-1 rounded border border-dashed border-line text-muted' title='only in the scene: joins the campaign only if brought back'>scene only</span>
}
