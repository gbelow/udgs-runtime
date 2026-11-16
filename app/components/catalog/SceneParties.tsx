'use client'
import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import { CatalogDrawer } from '../RunParts'
import { Button, IconButton, NumberInput, SectionLabel, TextInput, selectClass } from '../ui'
import { SCENE_PLAYERS, useScenePresetDraft } from '../../hooks/useScenePresets'

// The parties a prepared scene brings into its fight, each the enemy of
// every other: a card each, made of catalog characters picked from the
// catalog opened beside the cards, so many copies of each and who plays them.
export function SceneParties({ value, onChange }: { value: Record<string, unknown>, onChange: (value: Record<string, unknown>) => void }) {
  const { parties, addParty, renameParty, removeParty, addMember, setCount, setPlayer, removeMember } = useScenePresetDraft(value, onChange)
  const [adding, setAdding] = useState<number | null>(null)
  const open = adding !== null && adding < parties.length ? adding : null
  const remove = (party: number) => { setAdding(null); removeParty(party) }

  return (
    <div className='flex flex-col gap-2'>
      <div className='flex flex-row items-center gap-2'>
        <SectionLabel>parties</SectionLabel>
        <Button size='xs' weight='subtle' tone='good' icon={Plus} onClick={addParty}>create party</Button>
      </div>
      {parties.length === 0 ? <span className='text-xs text-muted'>No party yet: whoever meets the scene would fight nobody.</span> : null}
      <div className='flex flex-row gap-3 items-start'>
        {open !== null
          ? <CatalogDrawer label={`adding to ${parties[open].name || `party ${open + 1}`}`} close={() => setAdding(null)} onSelect={(c) => addMember(open, c)} />
          : null}
        <div className='flex flex-row flex-wrap gap-2 flex-1 min-w-0 items-start'>
          {parties.map((party, p) => (
            <div key={p} className={`flex flex-col gap-1 p-2 rounded border w-80 ${open === p ? 'border-accent' : 'border-line'}`}>
              <div className='flex flex-row items-center gap-1'>
                <TextInput className='text-sm grow min-w-0' aria-label={`party ${p + 1} name`} placeholder={`party ${p + 1}`}
                  value={party.name} onChange={(e) => renameParty(p, e.target.value)} />
                <IconButton icon={X} tone='bad' aria-label={`remove party ${p + 1}`} onClick={() => remove(p)} />
              </div>
              {party.members.map((member, m) => (
                <div key={`${member.key}-${m}`} className='flex flex-row items-center gap-1'>
                  <span className='text-sm grow min-w-0 truncate' title={member.key}>{member.key || '(no character)'}</span>
                  <span className='text-xs text-muted'>×</span>
                  <NumberInput className='w-10 text-sm' aria-label={`${member.key} count`} min={1}
                    value={member.count} onChange={(e) => setCount(p, m, Number(e.target.value))} />
                  <select aria-label={`${member.key} played by`} className={selectClass} title='who plays them'
                    value={member.player ?? ''} onChange={(e) => setPlayer(p, m, e.target.value || null)}>
                    <option value=''>the GM</option>
                    {SCENE_PLAYERS.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    {member.player && !SCENE_PLAYERS.some((b) => b.id === member.player) ? <option value={member.player}>{member.player}</option> : null}
                  </select>
                  <IconButton icon={X} aria-label={`remove ${member.key}`} onClick={() => removeMember(p, m)} />
                </div>
              ))}
              <Button size='xs' className='self-start' aria-pressed={open === p} selected={open === p}
                onClick={() => setAdding(open === p ? null : p)}>add characters</Button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
