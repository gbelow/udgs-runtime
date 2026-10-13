'use client'
import { SceneCards } from './SceneCards'
import { Button, SectionLabel, TextInput, Tooltip, selectClass } from './ui'
import { usePartyPicker } from '../hooks/useCombatState'
import { useCombatCommands } from '../hooks/useCombatCommands'

// Who is in the fight, by party: the cards, and the party the active
// character is in — inherited from the campaign, changed by the table before
// and during the fight, and handed back when it ends.
export function PartiesView(){
  return(
    <div className='flex flex-col gap-3'>
      <div className='flex flex-row flex-wrap gap-2 items-center'>
        <PartyControl />
        <Tooltip text='bring in a whole party saved elsewhere — not built yet' className='ml-auto'>
          <Button size='xs' aria-label='load party' disabled>load party</Button>
        </Tooltip>
      </div>
      <SceneCards />
    </div>
  )
}

function PartyControl(){
  const picker = usePartyPicker()
  const { moveToParty, splitOff, renameParty } = useCombatCommands()
  if (!picker) return <span className='text-xs text-muted'>pick a character to change their party</span>

  return(
    <div className='flex gap-1 items-center text-xs'>
      <SectionLabel>party</SectionLabel>
      <select className={selectClass} aria-label='party' value={picker.partyId} disabled={picker.bar !== null} title={picker.bar ?? 'the party this character is in'} onChange={(e) => moveToParty(e.target.value)}>
        {picker.parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <TextInput key={picker.partyId} className='w-28 text-xs' aria-label='party name' defaultValue={picker.name} onBlur={(e) => renameParty(picker.partyId, e.target.value.trim())} />
      <Button size='xs' aria-label='new party' disabled={picker.bar !== null} title={picker.bar ?? 'a new party with only this character in it'} onClick={splitOff}>new party</Button>
    </div>
  )
}
