'use client'
import { useState } from 'react'
import { Button, Menu, MenuConfirm, MenuItem } from './ui'
import { CatalogDrawer, PlayedBy, TimelineControl, TimelineSummary } from './RunParts'
import { CreateParty, NewPartySlot, PartyFrame, PartyHeader, SwitchBanner } from './PartyBoard'
import { useCampaignPartyCommands, useCampaignRoster, useMoveBars, useTimelineChart } from '../hooks/useCampaign'
import { useRole } from '../hooks/useRole'
import { usePartyCommands, useToDowntimeBar } from '../hooks/useParty'
import { useDowntimeCommands, useToExplorationBar } from '../hooks/useDowntime'
import { usePartiesPanel } from '../hooks/useCombatState'
import { useControlBar, useGmBar } from '../hooks/useControl'
import type { RosterMember, RosterPartyView } from '../domain/campaign/projections/roster'

type Switching = { id: string; name: string; from: string | null }

// The campaign's parties out of a fight, arranged the way the fight's are: a
// party is made empty and named, filled from the catalog opened beside it,
// put on a timeline and running; a member is switched by picking them and
// then the party to put them in, or a new one, or taken out of every party,
// where they are outside time. A party earlier on its timeline than the one
// being left is closed, since time only goes forward.
export function CampaignParties(){
  const { parties, unplaced } = useCampaignRoster()
  const chart = useTimelineChart()
  const { gmTools } = useRole()
  const [starting, setStarting] = useState(false)
  const canStart = !chart.started && parties.length > 0
  const { moveToParty, splitOff, bring, createParty, renameParty, startTimeline } = useCampaignPartyCommands()
  const gmBar = useGmBar()
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
        {canStart ? (
          <Button size='xs' weight='subtle' tone='accent' aria-label='start the timeline' aria-pressed={starting} active={starting} disabled={!gmTools}
            title={gmTools ? 'then click the party to start it with' : 'only the GM starts the timeline'} onClick={() => setStarting(!starting)}>
            {starting ? 'click a party to start with it' : 'start the timeline'}
          </Button>
        ) : null}
      </div>
      <div className='flex flex-row gap-3 items-start'>
        {adding ? <CatalogDrawer label={`adding to ${adding.name}`} close={() => setAddingTo(null)} onSelect={(c) => bring(c, adding.id)} /> : null}
        <div className='flex flex-row flex-wrap gap-3 items-start flex-1 min-w-0'>
          {parties.length === 0 ? <span className='text-xs text-muted'>no parties yet: create one, then add characters to it</span> : null}
          {parties.map((party) => {
            const away = switching !== null && party.id !== switching.from
            const bar = away ? bars[party.id] ?? null : null
            return (
              <PartyFrame key={party.id} target={(starting && canStart) || (away && bar === null)} adding={party.id === addingTo} closed={bar} place={() => { if (starting && canStart) { startTimeline(party.id); setStarting(false) } else placeInto(party.id) }}>
                <div className='flex flex-col gap-0.5' onClick={(e) => e.stopPropagation()}>
                  <PartyHeader name={party.name} rename={(n) => renameParty(party.id, n)} adding={party.id === addingTo} locked={gmBar !== null}
                    toggleAdding={() => setAddingTo(party.id === addingTo ? null : party.id)}>
                    {party.sequence === 'exploration' ? <ToDowntime party={party} /> : <ToExploration party={party} />}
                    <TimelineControl timeline={party.timeline} />
                  </PartyHeader>
                  <TimelineSummary timeline={party.timeline} />
                  {party.fighting ? <span className='text-xs text-bad'>in the fight</span> : null}
                  {!party.playing ? null : <span className='text-xs text-muted'>in {party.playing}</span>}
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
export function ToDowntime({ party }: { party: RosterPartyView }){
  const { toDowntime } = usePartyCommands()
  const gmBar = useGmBar()
  const bar = useToDowntimeBar(party.id) ?? gmBar
  return <MenuItem bar={bar} hint='the whole party leaves exploration to spend days in downtime' onClick={() => toDowntime(party.id)}>to downtime</MenuItem>
}

// The party leaves downtime to explore again, once nobody in it is on an
// activity.
export function ToExploration({ party }: { party: RosterPartyView }){
  const { toExploration } = useDowntimeCommands()
  const gmBar = useGmBar()
  const bar = useToExplorationBar(party.id) ?? gmBar
  return <MenuItem bar={bar} hint='the whole party leaves downtime to explore' onClick={() => toExploration(party.id)}>to exploration</MenuItem>
}

// A member: their name, a click on which picks them, and their menu, where
// whoever plays them, or the GM, switches them to another party or a new one,
// takes them out of every party, or out of the campaign once it is confirmed.
export function Member({ member, scene = false, inParty, switching, toggle }: { member: RosterMember, scene?: boolean, inParty: boolean, switching: boolean, toggle: () => void }){
  const { pick, leaveParty, removeFromCampaign } = useCampaignPartyCommands()
  const { toScene } = usePartyCommands()
  const gmBar = useGmBar()
  const bar = useControlBar(member.id)
  const joinBar = usePartiesPanel().joinBar ?? gmBar

  if (member.fighting) return <span className='text-xs text-muted' title='off the roster until the fight sends them back'>{member.name} · in the fight</span>

  return(
    <div className='flex flex-row gap-1 items-center' onClick={(e) => e.stopPropagation()}>
      <Button size='xs' aria-label={member.name} selected={member.isActive || switching} onClick={() => pick(member.id)}>{member.name}</Button>
      <Menu label={`${member.name} options`}>
        {scene ? <MenuItem bar={joinBar} hint='into the scene' onClick={() => toScene(member.id)}>to scene</MenuItem> : null}
        <MenuItem bar={bar} selected={switching} hint='pick the party to put them in, or a new one' onClick={toggle}>{switching ? 'cancel switching' : 'switch party'}</MenuItem>
        {inParty ? <MenuItem bar={bar} hint='outside time until they join one on a timeline' onClick={() => leaveParty(member.id)}>out of party</MenuItem> : null}
        <PlayedBy id={member.id} name={member.name} />
        <MenuConfirm bar={bar} hint='off the roster and out of the campaign once it is saved; a player character keeps its own record' onConfirm={() => { removeFromCampaign(member.id) }}>remove from campaign</MenuConfirm>
      </Menu>
    </div>
  )
}
