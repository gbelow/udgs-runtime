'use client'
import { useState } from 'react'
import { Button, NumberInput, SectionLabel } from './ui';
import { CharacterSheet } from './CharacterSheet';
import { useClock, useExploration, useExposure, usePartyCommands, usePartyRoster, usePassBar } from '../hooks/useParty';
import { useActiveCharacterData } from '../hooks/useCharacterData';

// The party out of any fight: the clock they share, who is with them, and the
// sheet of whoever is picked, with the ET buttons.
export function PartyPanel(){

  const { roster, pick } = usePartyRoster()
  const { day, et, minutes } = useClock()
  const exposure = useExposure()
  const passBar = usePassBar()
  const { passET, setExposure, sendActiveToFight, sendAllToFight, leaveParty } = usePartyCommands()
  const { fightName } = useActiveCharacterData()
  const hasActive = roster.some((r) => r.isActive)

  return(
    <div className='flex flex-col text-left'>
      <div className='flex flex-row gap-2 items-center py-2 border-b border-line'>
        <span className='text-xs text-muted'>Day <span className='font-mono text-fg'>{day}</span> · ET <span className='font-mono text-fg'>{et}</span>/6 · <span className='font-mono text-fg'>{minutes}</span> min</span>
        <span className='text-xs text-muted'>exposure</span>
        <NumberInput className='w-12' aria-label='exposure' value={exposure} onChange={(e) => setExposure(parseInt(e.target.value) || 0)} />
        <Button aria-label='passET' disabled={passBar !== null} title={passBar ?? undefined} onClick={passET}>next ET</Button>
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

const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`)

// survival.tex "Exhaustion", "Rest", "Wear" — what the character will spend
// the coming ET on, and eating and drinking, which take no ET.
function ExplorationSection(){

  const [nutrition, setNutrition] = useState(3)
  const { bar, plan, options, willDL, lastRoll, potion } = useExploration()
  const { setPlan, eat, drink } = usePartyCommands()

  return(
    <div className='flex flex-col gap-1'>
      <SectionLabel>Next exploration turn</SectionLabel>
      <div className='flex flex-row flex-wrap gap-1.5 items-center'>
        {options.map((o) => (
          <Button key={o.plan ?? 'idle'} aria-label={o.plan ?? 'idle'} variant={o.plan === plan ? 'primary' : 'default'} className={o.plan === plan ? 'bg-accent/15' : ''} disabled={bar !== null} title={bar ?? `${signed(o.IL)} IL, ${signed(o.exhaustion)} exhaustion${o.idle && o.plan ? ' (no healing rests left today)' : ''}`} onClick={() => setPlan(o.plan)}>{o.plan ?? 'idle'}</Button>
        ))}
      </div>
      {potion > 0 ? <span className='text-xs text-muted'>potion heals up to <span className='font-mono text-fg'>{potion}</span> IL over the ET</span> : null}
      {willDL !== null ? <span className='text-xs text-muted'>Will test DL <span className='font-mono text-fg'>{willDL}</span> opens the ET; a graze or miss forces a rest</span> : null}
      {lastRoll ? <span className='text-xs text-muted'>Will test last ET: <span className='font-mono text-fg'>{lastRoll.score}</span> vs DL <span className='font-mono text-fg'>{lastRoll.DL}</span>, {lastRoll.degree}</span> : null}
      <div className='flex flex-row flex-wrap gap-1.5 items-center'>
        <span className='text-xs text-muted'>portion</span>
        <NumberInput className='w-12' aria-label='nutrition' value={nutrition} onChange={(e) => setNutrition(parseInt(e.target.value) || 0)} />
        <Button aria-label='eat' disabled={bar !== null} title={bar ?? undefined} onClick={() => eat(nutrition)}>eat</Button>
        <Button aria-label='drink' disabled={bar !== null} title={bar ?? undefined} onClick={drink}>drink water</Button>
      </div>
    </div>
  )
}