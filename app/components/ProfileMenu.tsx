'use client'
import { useState } from 'react'
import { useProfile } from '../hooks/useProfile'
import { Button, ListButton, SectionLabel, TextInput } from './ui'

// The first screen while none is picked: who is at it, picked from the
// profiles there are or made anew.
export function ProfileLanding(){
  const { profiles, pick, create, nameBar, dev } = useProfile()
  return (
    <main className='min-h-screen flex items-center justify-center p-4'>
      <div className='w-full max-w-sm flex flex-col gap-4 bg-surface border border-line rounded p-4 text-sm'>
        <div className='flex flex-col gap-1'>
          <h1 className='text-lg text-fg'>fallowRPG</h1>
          <span className='text-muted text-xs'>who is playing?{dev ? ' (dev server: a GM is the developer, a player is a player)' : ''}</span>
        </div>
        <ProfileList profiles={profiles} current={null} pick={pick} />
        <NewProfile create={create} nameBar={nameBar} />
      </div>
    </main>
  )
}

// The header's switch: the profile picked, renamed in place, and the others
// to switch to.
export function ProfileMenu(){
  const { profile, profiles, pick, create, rename, setDice, nameBar, dev } = useProfile()
  const [open, setOpen] = useState(false)

  return (
    <div className='relative ml-auto self-center flex flex-row items-center gap-2'>
      {dev ? <span className='text-[10px] text-muted'>dev server</span> : null}
      <Button size='xs' active={open} aria-label='profile' onClick={() => setOpen((o) => !o)}>
        {profile ? `playing as ${profile.name}` : 'pick a profile'}
      </Button>
      {open ? (
        <div className='absolute right-0 top-full mt-1 z-50 w-60 flex flex-col gap-2 bg-raised border border-line rounded p-2 shadow-lg shadow-black/40 text-xs'>
          {profile ? (
            <div className='flex flex-col gap-1'>
              <SectionLabel>your name</SectionLabel>
              <TextInput key={profile.id} aria-label='profile name' defaultValue={profile.name} onBlur={(e) => rename(e.target.value)} />
              <SectionLabel>dice</SectionLabel>
              <div className='flex flex-row gap-1'>
                <Button size='xs' selected={!profile.manualDice} onClick={() => setDice(false)}>rolled on screen</Button>
                <Button size='xs' selected={profile.manualDice} onClick={() => setDice(true)}>my own dice</Button>
              </div>
            </div>
          ) : null}
          <ProfileList profiles={profiles} current={profile?.id ?? null} pick={(id) => { pick(id); setOpen(false) }} />
          <NewProfile create={(name) => { create(name); setOpen(false) }} nameBar={nameBar} />
        </div>
      ) : null}
    </div>
  )
}

function ProfileList({ profiles, current, pick }: { profiles: { id: string, name: string }[], current: string | null, pick: (id: string) => void }){
  return (
    <div className='flex flex-col gap-0.5'>
      <SectionLabel>profiles</SectionLabel>
      {profiles.length ? profiles.map((p) => (
        <ListButton key={p.id} selected={p.id === current} onClick={() => pick(p.id)}>{p.name}</ListButton>
      )) : <span className='text-muted text-xs'>none yet: make the first</span>}
    </div>
  )
}

function NewProfile({ create, nameBar }: { create: (name: string) => void, nameBar: (name: string) => string | null }){
  const [name, setName] = useState('')
  const bar = nameBar(name)
  return (
    <form className='flex flex-row gap-1' onSubmit={(e) => { e.preventDefault(); if (bar) return; create(name); setName('') }}>
      <TextInput className='flex-1 min-w-0' aria-label='new profile name' placeholder='new profile' value={name} onChange={(e) => setName(e.target.value)} />
      <Button type='submit' size='xs' variant='primary' disabled={!!bar} title={bar ?? undefined}>make</Button>
    </form>
  )
}
