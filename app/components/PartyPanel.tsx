'use client'
import { useState } from 'react'
import { Button, NumberInput, SectionLabel } from './ui';
import { CharacterSheet } from './CharacterSheet';
import { useClock, useExploration, usePartyCommands, usePartyRoster } from '../hooks/useParty';
import { useActiveCharacterData } from '../hooks/useCharacterData';

// The party out of any fight: the clock they share, who is with them, and the
// sheet of whoever is picked, with the ET buttons.
export function PartyPanel(){

  const { roster, pick } = usePartyRoster()
  const { day, et, minutes } = useClock()
  const { passET, sendActiveToFight, sendAllToFight, leaveParty } = usePartyCommands()
  const { fightName } = useActiveCharacterData()
  const hasActive = roster.some((r) => r.isActive)

  return(
    <div className='flex flex-col text-left'>
      <div className='flex flex-row gap-2 items-center py-2 border-b border-line'>
        <span className='text-xs text-muted'>Day <span className='font-mono text-fg'>{day}</span> · ET <span className='font-mono text-fg'>{et}</span>/6 · <span className='font-mono text-fg'>{minutes}</span> min</span>
        <Button aria-label='passET' onClick={passET}>next ET</Button>
        <div className='flex flex-row gap-1.5 grow overflow-x-auto'>
          {roster.map((entry) =>
            <Button key={entry.id} aria-label={entry.name} variant={entry.isActive ? 'primary' : 'default'} className={entry.isActive ? 'bg-accent/15' : ''} onClick={() => pick(entry.id)}>{entry.name}</Button>
          )}
        </div>
        <Button aria-label='allToFight' disabled={roster.length === 0} onClick={sendAllToFight}>all to fight</Button>
      </div>
      {
        hasActive ?
        <CharacterSheet
          header={
            <div className='flex flex-row flex-wrap gap-1.5 items-center'>
              <span className='text-base font-medium mr-2'>{fightName}</span>
              <Button aria-label='toFight' onClick={sendActiveToFight}>to fight</Button>
              <Button aria-label='leaveParty' variant='bad' onClick={leaveParty}>leave party</Button>
            </div>
          }
          afterInjury={<ExplorationSection />}
        />
        : null
      }
    </div>
  )
}

// survival.tex "Rest, Exhaustion and Healing" — the ET buttons.
function ExplorationSection(){

  const [exposure, setExposure] = useState(0)
  const [nutrition, setNutrition] = useState(3)
  const { bar, restBar, actions, sleep: slept, potion } = useExploration(exposure)
  const { explore, shortRest, sleep, eat, drink } = usePartyCommands()

  return(
    <div className='flex flex-col gap-1'>
      <SectionLabel>Exploration turn</SectionLabel>
      <div className='flex flex-row flex-wrap gap-1.5 items-center'>
        <span className='text-xs text-muted'>exposure</span>
        <NumberInput className='w-12' aria-label='exposure' value={exposure} onChange={(e) => setExposure(parseInt(e.target.value) || 0)} />
        {actions.map((a) => (
          <Button key={a.action} aria-label={a.action} disabled={bar !== null} title={bar ?? `+${a.IL} IL, +${a.exhaustion} exhaustion`} onClick={() => explore(a.action)}>{a.action}</Button>
        ))}
        <Button aria-label='shortRest' disabled={restBar !== null} title={restBar ?? `-1 exhaustion${potion > 0 ? `, potion heals up to ${potion} IL` : ''}`} onClick={() => shortRest(exposure)}>short rest</Button>
        <Button aria-label='sleep' disabled={restBar !== null} title={restBar ?? `heals ${slept.heal} IL${potion > 0 ? ` and up to ${potion} more from the potion` : ''}, exhaustion becomes ${slept.exhaustion}`} onClick={() => sleep(exposure)}>sleep</Button>
      </div>
      <div className='flex flex-row flex-wrap gap-1.5 items-center'>
        <span className='text-xs text-muted'>portion</span>
        <NumberInput className='w-12' aria-label='nutrition' value={nutrition} onChange={(e) => setNutrition(parseInt(e.target.value) || 0)} />
        <Button aria-label='eat' disabled={bar !== null} title={bar ?? undefined} onClick={() => eat(nutrition)}>eat</Button>
        <Button aria-label='drink' disabled={bar !== null} title={bar ?? undefined} onClick={drink}>drink water</Button>
      </div>
    </div>
  )
}
