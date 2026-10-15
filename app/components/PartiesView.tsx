'use client'
import { useState, type ReactNode } from 'react'
import { Card } from './SceneCards'
import { CatalogDrawer } from './RunParts'
import { CreateParty, GM_BAR, NewPartySlot, PartyFrame, PartyHeader, SwitchBanner } from './PartyBoard'
import { Button, NumberInput } from './ui'
import { usePartiesPanel, useSceneCards } from '../hooks/useCombatState'
import { useCombatCommands } from '../hooks/useCombatCommands'
import { useBringIntoParty } from '../hooks/useCharacterLibrary'
import { useRole } from '../hooks/useRole'
import { useFightTimelineClash, usePartyCommands } from '../hooks/useParty'
import { useCombatState } from '../hooks/useCombatState'
import type { SceneCard } from '../domain/scene/projections/cards'

type Switching = { id: string; name: string; from: string }

// Who is in the fight, by party — inherited from the campaign, changed by the
// table before and during the fight, and handed back when it ends. A party is
// made empty and named, then filled from the catalog opened beside it; a
// member is switched by picking them and then the party to put them in, or
// the new party drawn while they are picked, or taken out. The GM has the catalog and
// arranges the parties; a player brings in only PCs. A party or a member
// goes back to the campaign once the scene is over for them, the ETs it took
// passing for each party when the last of it comes back.
export function PartiesView(){
  const { parties, pick } = useSceneCards()
  const { parties: names } = usePartiesPanel()
  const { moveToParty, splitOff, createParty } = useCombatCommands()
  const [addingTo, setAddingTo] = useState<string | null>(null)
  const [switching, setSwitching] = useState<Switching | null>(null)
  const adding = names.find((p) => p.id === addingTo) ?? null
  const clash = useFightTimelineClash()
  const [ets, setEts] = useState(0)

  const placeInto = (partyId: string | null) => {
    if (switching && partyId === null) splitOff(switching.id)
    else if (switching && partyId !== null && partyId !== switching.from) moveToParty(switching.id, partyId)
    setSwitching(null)
  }

  return(
    <div className='flex flex-col gap-2'>
      <div className='flex flex-row flex-wrap gap-2 items-center'>
        <CreateParty create={createParty} hint='a new party with nobody in it yet' />
        {switching ? <SwitchBanner name={switching.name} cancel={() => setSwitching(null)} /> : null}
        <span className='ml-auto text-xs text-muted whitespace-nowrap'>ETs the scene took</span>
        <NumberInput className='w-10' aria-label='ETs taken' title='passed for each party when the last of it comes back' value={ets} onChange={(e) => setEts(parseInt(e.target.value) || 0)} />
      </div>
      {clash ? <span className='text-xs text-bad'>{clash}</span> : null}
      <div className='flex flex-row gap-3 items-start'>
        {adding ? <AddCatalog partyId={adding.id} name={adding.name} close={() => setAddingTo(null)} /> : null}
        <div className='flex flex-row flex-wrap gap-3 items-start flex-1 min-w-0'>
          {parties.length === 0 ? <span className='text-xs text-muted'>no parties yet: create one, then add characters to it</span> : null}
          {parties.map((party) => (
            <PartyColumn key={party.id} id={party.id} name={party.name} ets={ets}
              adding={party.id === addingTo} toggleAdding={() => setAddingTo(party.id === addingTo ? null : party.id)}
              target={switching !== null && party.id !== '' && party.id !== switching.from} place={() => placeInto(party.id)}>
              {party.cards.map((card) => (
                <Card key={card.id} card={card} onClick={() => pick(card)}>
                  <MemberControls card={card} ets={ets} switching={switching?.id === card.id}
                    startSwitch={() => setSwitching(switching?.id === card.id ? null : { id: card.id, name: card.name, from: party.id })} />
                </Card>
              ))}
            </PartyColumn>
          ))}
          {switching ? <NewPartySlot name={switching.name} onClick={() => placeInto(null)} /> : null}
        </div>
      </div>
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
function PartyColumn({ id, name, ets, adding, toggleAdding, target, place, children }: { id: string, name: string, ets: number, adding: boolean, toggleAdding: () => void, target: boolean, place: () => void, children?: ReactNode }){
  const { renameParty } = useCombatCommands()
  const { partyBack } = usePartyCommands()
  const { returnBar } = useCombatState()

  return(
    <PartyFrame target={target} adding={adding} place={place}>
      {id === '' ? <span className='text-xs text-muted'>in no party</span>
        : <div className='flex flex-col gap-1' onClick={(e) => e.stopPropagation()}>
          <PartyHeader name={name} rename={(n) => renameParty(id, n)} adding={adding} toggleAdding={toggleAdding} locked={target} />
          <Button size='xs' aria-label={`${name} back`} disabled={returnBar !== null} title={returnBar ?? 'the scene is over for the party: back to the campaign'} onClick={() => partyBack(id, ets)}>back from scene</Button>
        </div>}
      {children}
    </PartyFrame>
  )
}

// A member switched to another party or a new one of their own, or taken
// out of the fight. The GM's to decide.
function MemberControls({ card, ets, switching, startSwitch }: { card: SceneCard, ets: number, switching: boolean, startSwitch: () => void }){
  const { moveBar } = usePartiesPanel()
  const { removeCharacter } = useCombatCommands()
  const { back } = usePartyCommands()
  const { returnBar } = useCombatState()
  const { gmTools } = useRole()
  const bar = moveBar ?? (gmTools ? null : GM_BAR)

  return(
    <div className='flex flex-row flex-wrap gap-1 items-center' onClick={(e) => e.stopPropagation()}>
      <Button size='xs' aria-label={`switch ${card.name}`} aria-pressed={switching} disabled={bar !== null} selected={switching} title={bar ?? 'pick the party to put them in, or a new one'} onClick={startSwitch}>switch party</Button>
      <Button size='xs' aria-label={`${card.name} back`} disabled={returnBar !== null} title={returnBar ?? 'the scene is over for them: back to the campaign'} onClick={() => back(card.id, ets)}>back</Button>
      <Button size='xs' variant='ghost' className='ml-auto' aria-label={`remove ${card.name}`} disabled={bar !== null} title={bar ?? 'take out of the fight; one sent from the roster goes back to it'} onClick={() => removeCharacter(card.id)}>×</Button>
    </div>
  )
}
