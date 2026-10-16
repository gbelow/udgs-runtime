'use client'
import { useState } from 'react'
import { Button } from './ui'
import { CatalogDrawer, PlayedBy, TimelineControl } from './RunParts'
import { CreateParty, NewPartySlot, PartyFrame, PartyHeader, SwitchBanner } from './PartyBoard'
import { useCampaignPartyCommands, useCampaignRoster, useMoveBars } from '../hooks/useCampaign'
import { usePartyCommands, useToDowntimeBar } from '../hooks/useParty'
import { useDowntimeCommands, useToExplorationBar } from '../hooks/useDowntime'
import { usePartiesPanel } from '../hooks/useCombatState'
import { useGmBar } from '../hooks/useControl'
import type { RosterMember, RosterPartyView } from '../domain/campaign/projections/roster'

type Switching = { id: string; name: string; from: string | null }

// The campaign's parties out of a fight, arranged the way the fight's are: a
// party is made empty and named, filled from the catalog opened beside it,
// put on a timeline and in play; a member is switched by picking them and
// then the party to put them in, or a new one, or taken out of every party,
// where they are outside time. A party earlier on its timeline than the one
// being left is closed, since time only goes forward.
export function CampaignParties(){
  const { parties, unplaced } = useCampaignRoster()
  const { moveToParty, splitOff, bring, createParty, renameParty } = useCampaignPartyCommands()
  const { partyToScene } = usePartyCommands()
  const gmBar = useGmBar()
  const joinBar = usePartiesPanel().joinBar ?? gmBar
  const [addingTo, setAddingTo] = useState<string | null>(null)
  const [switching, setSwitching] = useState<Switching | null>(null)
  const bars = useMoveBars(switching?.id ?? null)
  const adding = parties.find((p) => p.id === addingTo) ?? null
  const toggle = (m: RosterMember, from: string | null) => setSwitching(switching?.id === m.id ? null : { id: m.id, name: m.name, from })

  const placeInto = (partyId: string | null) => {
    if (switching && partyId === null) splitOff(switching.id)
    else if (switching && partyId !== null) moveToParty(switching.id, partyId)
    setSwitching(null)
  }

  return(
    <div className='flex flex-col gap-2'>
      <div className='flex flex-row flex-wrap gap-2 items-center'>
        <CreateParty create={createParty} hint='a new party with nobody in it yet, outside time' />
        {switching ? <SwitchBanner name={switching.name} cancel={() => setSwitching(null)} /> : null}
      </div>
      <div className='flex flex-row gap-3 items-start'>
        {adding ? <CatalogDrawer label={`adding to ${adding.name}`} close={() => setAddingTo(null)} onSelect={(c) => bring(c, adding.id)} /> : null}
        <div className='flex flex-row flex-wrap gap-3 items-start flex-1 min-w-0'>
          {parties.length === 0 ? <span className='text-xs text-muted'>no parties yet: create one, then add characters to it</span> : null}
          {parties.map((party) => {
            const away = switching !== null && party.id !== switching.from
            const bar = away ? bars[party.id] ?? null : null
            return (
              <PartyFrame key={party.id} target={away && bar === null} adding={party.id === addingTo} closed={bar} place={() => placeInto(party.id)}>
                <div className='flex flex-col gap-1' onClick={(e) => e.stopPropagation()}>
                  <PartyHeader name={party.name} rename={(n) => renameParty(party.id, n)} adding={party.id === addingTo} locked={gmBar !== null}
                    toggleAdding={() => setAddingTo(party.id === addingTo ? null : party.id)} />
                  <TimelineControl timeline={party.timeline} />
                  <Button size='xs' aria-label={`${party.name} to scene`} disabled={joinBar !== null || party.members.length === 0} title={joinBar ?? 'the whole party into the scene'} onClick={() => partyToScene(party.id)}>to scene</Button>
                  {party.sequence === 'exploration' ? <ToDowntime party={party} /> : <ToExploration party={party} />}
                </div>
                {party.members.map((m) => <Member key={m.id} member={m} inParty switching={switching?.id === m.id} toggle={() => toggle(m, party.id)} />)}
              </PartyFrame>
            )
          })}
          {unplaced.length > 0 ? (
            <PartyFrame>
              <span className='text-xs text-muted'>in no party: outside time</span>
              {unplaced.map((m) => <Member key={m.id} member={m} inParty={false} switching={switching?.id === m.id} toggle={() => toggle(m, null)} />)}
            </PartyFrame>
          ) : null}
          {switching ? <NewPartySlot name={switching.name} onClick={() => placeInto(null)} /> : null}
        </div>
      </div>
    </div>
  )
}

// The party leaves exploration for downtime, whole: none of it spends days
// while the rest spend ETs.
function ToDowntime({ party }: { party: RosterPartyView }){
  const { toDowntime } = usePartyCommands()
  const gmBar = useGmBar()
  const bar = useToDowntimeBar(party.id) ?? gmBar
  return <Button size='xs' aria-label={`${party.name} to downtime`} disabled={bar !== null} title={bar ?? 'the whole party leaves exploration to spend days in downtime'} onClick={() => toDowntime(party.id)}>to downtime</Button>
}

// The party leaves downtime to explore again, once nobody in it is on an
// activity.
function ToExploration({ party }: { party: RosterPartyView }){
  const { toExploration } = useDowntimeCommands()
  const gmBar = useGmBar()
  const bar = useToExplorationBar(party.id) ?? gmBar
  return(
    <div className='flex flex-row flex-wrap gap-1 items-center'>
      <span className='text-xs text-muted'>in downtime</span>
      <Button size='xs' aria-label={`${party.name} to exploration`} disabled={bar !== null} title={bar ?? 'the whole party leaves downtime to explore again'} onClick={() => toExploration(party.id)}>back to exploring</Button>
    </div>
  )
}

// A member: a click picks them; the GM switches them to another party or a
// new one, or takes them out of every party.
function Member({ member, inParty, switching, toggle }: { member: RosterMember, inParty: boolean, switching: boolean, toggle: () => void }){
  const { pick, leaveParty } = useCampaignPartyCommands()
  const { toScene } = usePartyCommands()
  const bar = useGmBar()
  const joinBar = usePartiesPanel().joinBar ?? bar

  return(
    <div className='flex flex-row flex-wrap gap-1 items-center' onClick={(e) => e.stopPropagation()}>
      <Button size='xs' aria-label={member.name} selected={member.isActive} onClick={() => pick(member.id)}>{member.name}</Button>
      <Button size='xs' aria-label={`${member.name} to scene`} disabled={joinBar !== null} title={joinBar ?? 'into the scene'} onClick={() => toScene(member.id)}>to scene</Button>
      <Button size='xs' aria-label={`switch ${member.name}`} aria-pressed={switching} disabled={bar !== null} selected={switching} title={bar ?? 'pick the party to put them in, or a new one'} onClick={toggle}>switch party</Button>
      {inParty ? <Button size='xs' variant='ghost' className='ml-auto' aria-label={`out of party ${member.name}`} disabled={bar !== null} title={bar ?? 'out of the party: outside time until they join one on a timeline'} onClick={() => leaveParty(member.id)}>×</Button> : null}
      <PlayedBy id={member.id} name={member.name} />
    </div>
  )
}
