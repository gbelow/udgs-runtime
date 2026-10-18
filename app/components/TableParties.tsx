'use client'
import { useState } from 'react'
import { Card } from './SceneCards'
import { CatalogDrawer, PlayedBy, TimelineControl, TimelineSummary } from './RunParts'
import { CreateParty, NewPartySlot, PartyFrame, PartyHeader, SwitchBanner } from './PartyBoard'
import { Member, ToDowntime, ToExploration } from './CampaignParties'
import { Menu, MenuItem, NumberInput } from './ui'
import { useCombatState, usePartiesPanel } from '../hooks/useCombatState'
import { useCombatCommands } from '../hooks/useCombatCommands'
import { useBringIntoParty } from '../hooks/useCharacterLibrary'
import { useCampaignPartyCommands, useMoveBars } from '../hooks/useCampaign'
import { useFightTimelineClash, usePartyCommands, useTableParties } from '../hooks/useParty'
import { useGmBar } from '../hooks/useControl'
import type { SceneCard } from '../domain/scene/projections/cards'
import type { TablePartyView } from '../domain/scene/projections/tableParties'
import type { Sequence } from '../domain/campaign/types'

type Switching = { id: string; name: string; from: string | null; fighter: boolean }

// Every party of the table, the campaign's and the fight's under one id: a
// member still on the roster is a name with its menu, a fighter a card with
// its own. A party is made in the fight, empty and named, and filled from the
// catalog opened beside it — onto the roster, or straight into the fight
// while one is on; a member is switched by picking them and then the party to
// put them in, or a new one. A party the fight made joins the campaign when
// its fighters come back.
export function TableParties({ sequence }: { sequence?: Sequence }){
  const { parties, loose, pick } = useTableParties(sequence)
  const campaign = useCampaignPartyCommands()
  const fight = useCombatCommands()
  const bringIntoFight = useBringIntoParty()
  const { joinBar } = usePartiesPanel()
  const clash = useFightTimelineClash()
  const [addingTo, setAddingTo] = useState<string | null>(null)
  const [switching, setSwitching] = useState<Switching | null>(null)
  const [ets, setEts] = useState(0)
  const bars = useMoveBars(switching && !switching.fighter ? switching.id : null)
  const adding = parties.find((p) => p.id === addingTo) ?? null
  const fighting = parties.some((p) => p.fighters.length > 0) || loose.fighters.length > 0
  const nobody = parties.length === 0 && loose.roster.length === 0 && loose.fighters.length === 0

  const placeInto = (partyId: string | null) => {
    if (switching?.fighter) {
      if (partyId === null) fight.splitOff(switching.id)
      else if (partyId !== switching.from) fight.moveToParty(switching.id, partyId)
    } else if (switching) {
      if (partyId === null) campaign.splitOff(switching.id)
      else campaign.moveToParty(switching.id, partyId)
    }
    setSwitching(null)
  }

  // Whether a click on the party puts the switched member there, or why not.
  const closedFor = (party: TablePartyView): { target: boolean, closed: string | null } => {
    if (!switching || party.id === switching.from) return { target: false, closed: null }
    if (switching.fighter) return party.inFight ? { target: true, closed: null } : { target: false, closed: 'the fight does not have this party' }
    const bar = party.campaign ? bars[party.id] ?? null : 'made in the fight: only its fighters join it'
    return { target: bar === null, closed: bar }
  }

  const rename = (party: TablePartyView, name: string) => {
    if (party.campaign) campaign.renameParty(party.id, name)
    if (party.inFight) fight.renameParty(party.id, name)
  }

  return(
    <div className='flex flex-col gap-2'>
      <div className='flex flex-row flex-wrap gap-2 items-center'>
        {sequence ? null : <CreateParty create={fight.createParty} hint='a new party in the fight with nobody in it yet' />}
        {switching ? <SwitchBanner name={switching.name} cancel={() => setSwitching(null)} /> : null}
        {fighting ? <>
          <span className='ml-auto text-xs text-muted whitespace-nowrap'>ETs the scene took</span>
          <NumberInput className='w-10' aria-label='ETs taken' title='passed for each party when the last of it comes back' value={ets} onChange={(e) => setEts(parseInt(e.target.value) || 0)} />
        </> : null}
      </div>
      {clash ? <span className='text-xs text-bad'>{clash}</span> : null}
      <div className='flex flex-row gap-3 items-start'>
        {adding ? <CatalogDrawer label={`adding to ${adding.name}`} close={() => setAddingTo(null)} bar={adding.adds === 'fight' ? joinBar : null}
          onSelect={(c) => adding.adds === 'fight' ? bringIntoFight(c, adding.id) : campaign.bring(c, adding.id)} /> : null}
        <div className='flex flex-col gap-3 items-start flex-1 min-w-0'>
          {nobody ? <span className='text-xs text-muted'>{sequence ? `no party running on a timeline is in ${sequence}: the campaign tab puts one there` : 'no parties yet: create one, then add characters to it'}</span> : null}
          {parties.map((party) => {
            const { target, closed } = closedFor(party)
            return (
              <PartyFrame key={party.id} target={target} adding={party.id === addingTo} closed={closed} place={() => placeInto(party.id)}>
                <PartyTop party={party} sequence={sequence} ets={ets} adding={party.id === addingTo} locked={target}
                  rename={(n) => rename(party, n)} toggleAdding={() => setAddingTo(party.id === addingTo ? null : party.id)} />
                {party.roster.map((m) => (
                  <Member key={m.id} member={m} scene inParty switching={switching?.id === m.id}
                    toggle={() => setSwitching(switching?.id === m.id ? null : { id: m.id, name: m.name, from: party.id, fighter: false })} />
                ))}
                {party.fighters.map((card) => (
                  <Fighter key={card.id} card={card} ets={ets} pick={pick} switching={switching?.id === card.id}
                    startSwitch={() => setSwitching(switching?.id === card.id ? null : { id: card.id, name: card.name, from: party.id, fighter: true })} />
                ))}
              </PartyFrame>
            )
          })}
          {loose.roster.length > 0 || loose.fighters.length > 0 ? (
            <PartyFrame target={false}>
              <span className='text-xs text-muted'>in no party</span>
              {loose.roster.map((m) => (
                <Member key={m.id} member={m} scene inParty={false} switching={switching?.id === m.id}
                  toggle={() => setSwitching(switching?.id === m.id ? null : { id: m.id, name: m.name, from: null, fighter: false })} />
              ))}
              {loose.fighters.map((card) => (
                <Fighter key={card.id} card={card} ets={ets} pick={pick} switching={switching?.id === card.id}
                  startSwitch={() => setSwitching(switching?.id === card.id ? null : { id: card.id, name: card.name, from: '', fighter: true })} />
              ))}
            </PartyFrame>
          ) : null}
          {switching ? <NewPartySlot name={switching.name} onClick={() => placeInto(null)} /> : null}
        </div>
      </div>
    </div>
  )
}

// A party's name, what it is doing and its menu: the catalog first, then what
// sends it into the scene or back, deletes it, or moves it between the
// campaign's sequences.
function PartyTop({ party, sequence, ets, adding, locked, rename, toggleAdding }: { party: TablePartyView, sequence?: Sequence, ets: number, adding: boolean, locked: boolean, rename: (name: string) => void, toggleAdding: () => void }){
  const { partyToScene, partyBack } = usePartyCommands()
  const { deleteParty } = useCombatCommands()
  const { joinBar } = usePartiesPanel()
  const returnBar = useCombatState().returnBar
  const gmBar = useGmBar()
  const { campaign } = party

  return(
    <div className='flex flex-col gap-0.5' onClick={(e) => e.stopPropagation()}>
      <PartyHeader name={party.name} rename={rename} adding={adding} toggleAdding={toggleAdding} locked={locked || gmBar !== null}>
        {campaign && party.roster.length > 0 ? <MenuItem bar={joinBar ?? gmBar} hint='the whole party on the roster into the scene' onClick={() => partyToScene(party.id)}>to scene</MenuItem> : null}
        {party.fighters.length > 0 ? <MenuItem bar={returnBar ?? gmBar} hint='the scene is over for the party: back to the campaign' onClick={() => partyBack(party.id, ets)}>back from scene</MenuItem> : null}
        {party.inFight && party.fighters.length === 0 ? <MenuItem bad bar={gmBar} hint='the party is gone from the fight' onClick={() => deleteParty(party.id)}>delete party</MenuItem> : null}
        {campaign ? (campaign.sequence === 'exploration' ? <ToDowntime party={campaign} /> : <ToExploration party={campaign} />) : null}
        {campaign ? <TimelineControl timeline={campaign.timeline} /> : null}
      </PartyHeader>
      {campaign ? <TimelineSummary timeline={campaign.timeline} /> : <span className='text-xs text-muted'>made in the fight: joins the campaign when it comes back</span>}
      {party.fighters.length > 0 ? <span className='text-xs text-bad'>in the fight</span> : null}
      {sequence || !campaign?.playing ? null : <span className='text-xs text-muted'>in {campaign.playing}</span>}
    </div>
  )
}

// A fighter: their card, with a menu to switch party, send them back to the
// campaign or take them out of the fight. The GM's to decide.
function Fighter({ card, ets, pick, switching, startSwitch }: { card: SceneCard, ets: number, pick: (card: SceneCard) => void, switching: boolean, startSwitch: () => void }){
  const { moveBar } = usePartiesPanel()
  const { removeCharacter } = useCombatCommands()
  const { back } = usePartyCommands()
  const gmBar = useGmBar()
  const returnBar = useCombatState().returnBar ?? gmBar
  const bar = moveBar ?? gmBar

  return(
    <Card card={card} onClick={() => pick(card)}>
      <div className='flex flex-row justify-end'>
        <Menu label={`${card.name} options`}>
          <MenuItem bar={bar} selected={switching} hint='pick the party to put them in, or a new one' onClick={startSwitch}>{switching ? 'cancel switching' : 'switch party'}</MenuItem>
          <MenuItem bar={returnBar} hint='the scene is over for them: back to the campaign' onClick={() => back(card.id, ets)}>back</MenuItem>
          <MenuItem bad bar={bar} hint='one sent from the roster goes back to it; one brought straight in is gone' onClick={() => removeCharacter(card.id)}>take out of the fight</MenuItem>
          <PlayedBy id={card.id} name={card.name} />
        </Menu>
      </div>
    </Card>
  )
}
