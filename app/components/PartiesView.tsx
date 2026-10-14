'use client'
import { useState, type ReactNode } from 'react'
import { Card } from './SceneCards'
import { CatalogDrawer } from './RunParts'
import { Button, TextInput, Tooltip } from './ui'
import { usePartiesPanel, useSceneCards } from '../hooks/useCombatState'
import { useCombatCommands } from '../hooks/useCombatCommands'
import { useBringIntoParty } from '../hooks/useCharacterLibrary'
import { useRole } from '../hooks/useRole'
import type { SceneCard } from '../domain/scene/projections/cards'

const GM_BAR = 'the GM arranges the parties'

type Switching = { id: string; name: string; from: string }

// Who is in the fight, by party — inherited from the campaign, changed by the
// table before and during the fight, and handed back when it ends. A party is
// made empty and named, then filled from the catalog opened beside it; a
// member is switched by picking them and then the party to put them in, or
// the new party drawn while they are picked, or taken out. The GM has the catalog and
// arranges the parties; a player brings in only PCs.
export function PartiesView(){
  const { parties, pick } = useSceneCards()
  const { parties: names } = usePartiesPanel()
  const { moveToParty, splitOff } = useCombatCommands()
  const [addingTo, setAddingTo] = useState<string | null>(null)
  const [switching, setSwitching] = useState<Switching | null>(null)
  const adding = names.find((p) => p.id === addingTo) ?? null

  const placeInto = (partyId: string | null) => {
    if (switching && partyId === null) splitOff(switching.id)
    else if (switching && partyId !== null && partyId !== switching.from) moveToParty(switching.id, partyId)
    setSwitching(null)
  }

  return(
    <div className='flex flex-col gap-2'>
      <div className='flex flex-row flex-wrap gap-2 items-center'>
        <CreateParty />
        {switching ? (
          <span className='flex flex-row gap-1 items-center text-xs text-accent'>
            click a party to put {switching.name} in
            <Button size='xs' variant='ghost' aria-label='cancel switch' onClick={() => setSwitching(null)}>cancel</Button>
          </span>
        ) : null}
        <Tooltip text='bring in a whole party saved elsewhere — not built yet' className='ml-auto'>
          <Button size='xs' aria-label='load party' disabled>load party</Button>
        </Tooltip>
      </div>
      <div className='flex flex-row gap-3 items-start'>
        {adding ? <AddCatalog partyId={adding.id} name={adding.name} close={() => setAddingTo(null)} /> : null}
        <div className='flex flex-row flex-wrap gap-3 items-start flex-1 min-w-0'>
          {parties.length === 0 ? <span className='text-xs text-muted'>no parties yet: create one, then add characters to it</span> : null}
          {parties.map((party) => (
            <PartyColumn key={party.id} id={party.id} name={party.name}
              adding={party.id === addingTo} toggleAdding={() => setAddingTo(party.id === addingTo ? null : party.id)}
              target={switching !== null && party.id !== '' && party.id !== switching.from} place={() => placeInto(party.id)}>
              {party.cards.map((card) => (
                <Card key={card.id} card={card} onClick={() => pick(card)}>
                  <MemberControls card={card} switching={switching?.id === card.id}
                    startSwitch={() => setSwitching(switching?.id === card.id ? null : { id: card.id, name: card.name, from: party.id })} />
                </Card>
              ))}
            </PartyColumn>
          ))}
          {switching ? (
            <button type='button' aria-label='into a new party' onClick={() => placeInto(null)}
              className='min-w-56 min-h-24 p-2 rounded border border-dashed border-accent text-xs text-accent bg-accent/5 hover:bg-accent/15 flex items-center justify-center'>
              new party with only {switching.name}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

// A new, empty party under the name typed, or the next free party name.
function CreateParty(){
  const [name, setName] = useState('')
  const { createParty } = useCombatCommands()
  const { gmTools } = useRole()

  return(
    <div className='flex flex-row gap-1 items-center'>
      <TextInput className='w-36 text-xs' aria-label='new party name' placeholder='party name' value={name} disabled={!gmTools} onChange={(e) => setName(e.target.value)} />
      <Button size='xs' variant='primary' aria-label='create party' disabled={!gmTools} title={gmTools ? 'a new party with nobody in it yet' : GM_BAR} onClick={() => { createParty(name.trim()); setName('') }}>create party</Button>
    </div>
  )
}

// The catalog, opened for one party: whatever is picked joins it.
function AddCatalog({ partyId, name, close }: { partyId: string, name: string, close: () => void }){
  const bring = useBringIntoParty()
  const { joinBar } = usePartiesPanel()
  return <CatalogDrawer label={`adding to ${name}`} close={close} bar={joinBar} onSelect={(c) => bring(c, partyId)} />
}

// One party: its name, the button that opens the catalog for it, and its
// members. While a member is being switched, a click on it puts them here.
// The members in no party have no name and no catalog.
function PartyColumn({ id, name, adding, toggleAdding, target, place, children }: { id: string, name: string, adding: boolean, toggleAdding: () => void, target: boolean, place: () => void, children?: ReactNode }){
  const { renameParty } = useCombatCommands()
  const { gmTools } = useRole()
  const frame = target ? 'border-accent bg-accent/5 cursor-pointer hover:bg-accent/15' : adding ? 'border-accent' : 'border-line'

  return(
    <div className={`flex flex-col gap-2 p-2 rounded border min-w-56 ${frame}`} onClick={target ? place : undefined}>
      {target ? <span className='text-xs text-accent'>put here</span> : null}
      {id === '' ? <span className='text-xs text-muted'>in no party</span> : <>
        <TextInput key={name} className='w-full text-xs font-medium' aria-label={`${name} name`} disabled={!gmTools || target} title={gmTools ? "the party's name" : GM_BAR} defaultValue={name} onBlur={(e) => renameParty(id, e.target.value.trim())} />
        <Button size='xs' aria-label={`add characters to ${name}`} aria-pressed={adding} disabled={target} selected={adding} onClick={toggleAdding}>add characters to party</Button>
      </>}
      {children}
    </div>
  )
}

// A member switched to another party or a new one of their own, or taken
// out of the fight. The GM's to decide.
function MemberControls({ card, switching, startSwitch }: { card: SceneCard, switching: boolean, startSwitch: () => void }){
  const { moveBar } = usePartiesPanel()
  const { removeCharacter } = useCombatCommands()
  const { gmTools } = useRole()
  const bar = moveBar ?? (gmTools ? null : GM_BAR)

  return(
    <div className='flex flex-row flex-wrap gap-1 items-center' onClick={(e) => e.stopPropagation()}>
      <Button size='xs' aria-label={`switch ${card.name}`} aria-pressed={switching} disabled={bar !== null} selected={switching} title={bar ?? 'pick the party to put them in, or a new one'} onClick={startSwitch}>switch party</Button>
      <Button size='xs' variant='ghost' className='ml-auto' aria-label={`remove ${card.name}`} disabled={bar !== null} title={bar ?? 'take out of the fight; one sent from the roster goes back to it'} onClick={() => removeCharacter(card.id)}>×</Button>
    </div>
  )
}
