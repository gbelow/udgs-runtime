'use client'
import { useState } from 'react'
import { ArmorPanel } from './ArmorPanel';
import { WeaponPanel } from './WeaponPanel';
import { ContainerPanel } from './ContainerPanel';
import { HandsPanel } from './HandsPanel';
import { AbilityPanel } from './AbilityPanel';
import { SpellPanel } from './SpellPanel';
import { ActionPanel } from './ActionPanel';
import { makeDieRoll } from './utils';
import { Button, NumberInput, SectionLabel, StatTile, Tiles, Tooltip } from './ui';
import { useCombatRoster, useCombatState } from '../hooks/useCombatState';
import { Characteristics, Movement, Resources, Skills } from '../domain/types';
import { useSkillLens } from '../hooks/useSkillLens';
import { SkillTooltip } from './SkillTooltip';
import { useMovementLens } from '../hooks/useMovementLens';
import { useCharacteristicLens } from '../hooks/useCharacteristicLens';
import { useInjuryLens } from '../hooks/useinjuryLens';
import { useResourceLens } from '../hooks/useResourceLens';
import { useCharacterCommands } from '../hooks/useCharacterCommands';
import { useCombatCommands } from '../hooks/useCombatCommands';
import { useAfflictionBoard } from '../hooks/useAfflictionLens';
import { useGameCommands } from '../hooks/useGameCommands';
import { useActiveCharacterData, useSurgeOptions } from '../hooks/useCharacterData';
import { useTrainableNameLens } from '../hooks/useTrainableNameLens';
import { useKnowledgeLens, useKnowledgeTerms } from '../hooks/useKnowledgeLens';

const MOVES: { name: keyof Movement, title: string }[] = [
  { name: 'basic', title: 'basic · 1AP' },
  { name: 'careful', title: 'careful · 1AP' },
  { name: 'crawl', title: 'crawl · 1AP' },
  { name: 'run', title: 'run · 2AP' },
  { name: 'swim', title: 'swim · 1AP' },
  { name: 'jump', title: 'jump · 1AP+1STA' },
  { name: 'stand', title: 'stand up' },
]
const ATTRIBUTES: (keyof Characteristics)[] = ['STR', 'AGI', 'STA', 'CON', 'INT', 'SPI', 'DEX']
const TRAINABLES: (keyof Characteristics)[] = ['melee', 'ranged', 'awareness', 'charisma', 'sorcery', 'conviction1', 'conviction2', 'devotion']
const COMBAT: (keyof Skills)[] = ['strike', 'accuracy', 'defend', 'reflex', 'grapple', 'force', 'SD']
const PHYSICAL: (keyof Skills)[] = ['balance', 'climb', 'detection', 'stealth', 'prestidigitation', 'health', 'swim']
const MIND: (keyof Skills)[] = ['cunning', 'explore', 'will', 'persuasion', 'deception', 'insight']

export function PlayPanel(){

  const { rest } = useCharacterCommands()
  const { nextRound, startTurn, resetCombat, killCharacter } = useCombatCommands()
  const { savePlayerCharacter} = useGameCommands()
  const { isCharacterDead } = useInjuryLens()
  const { round, hasActiveCharacter: isThereActiveCharacter } = useCombatState()
  const { notes, fightName } = useActiveCharacterData()

  const [dice10, setDice10] = useState(1)
  const [dice6, setDice6] = useState(1)

  return(
    <div className='flex flex-col text-left'>
      <div className='flex flex-row gap-2 items-center py-2 border-b border-line'>
        <span className='text-xs text-muted'>Round <span className='font-mono text-fg'>{round}</span></span>
        <CharacterList />
        <Button aria-label='nextRound' onClick={nextRound}>next round</Button>
        <Button aria-label='resetGame' variant='ghost' onClick={resetCombat}>reset</Button>
      </div>
      {
        isThereActiveCharacter ?
        <div className='grid grid-cols-1 md:grid-cols-12 gap-4 py-3'>
          <div className='md:col-span-7 flex flex-col gap-3 text-sm'>
            <div className='flex flex-row flex-wrap gap-1.5 items-center'>
              <span className='text-base font-medium mr-2'>{fightName}</span>
              <Button variant='primary' aria-label='startTurn' onClick={startTurn}>start turn</Button>
              <Button aria-label='roll' onClick={() => setDice10(makeDieRoll(10))}>d10 <span className='font-mono text-fg'>{dice10}</span></Button>
              <Button aria-label='roll' onClick={() => setDice6(makeDieRoll(6))}>d6 <span className='font-mono text-fg'>{dice6}</span></Button>
              <SurgeControl />
              <Button aria-label='rest' onClick={rest}>rest</Button>
            </div>
            <ActionPanel />

            <div className='flex flex-col gap-1'>
              <SectionLabel>Resources</SectionLabel>
              <div className='flex flex-row flex-wrap gap-1.5'>
                <SimpleResource rssName={'AP'} />
                <SimpleResource rssName={'STA'} />
                <SimpleResource rssName={'exhaustion'} />
                <SimpleResource rssName={'hunger'} />
                <SimpleResource rssName={'thirst'} />
              </div>
            </div>

            <div className='flex flex-col gap-1'>
              <SectionLabel>Injury</SectionLabel>
              <div className='flex flex-row flex-wrap gap-3 items-end'>
                <InjuryControl type='potion' />
                <DamageControl />
                <InjuryControl type='injuryLevel' />
                <InjuryControl type='bleed' />
                <Button variant='bad' active={isCharacterDead} className={isCharacterDead ? 'bg-bad/20' : ''} onClick={killCharacter}>{isCharacterDead ? 'dead' : 'kill'}</Button>
              </div>
            </div>

            <div className='flex flex-col gap-1'>
              <SectionLabel>Movement</SectionLabel>
              <Tiles>{MOVES.map((m) => <SimpleMove key={m.name} moveName={m.name} title={m.title} />)}</Tiles>
            </div>

            <div className='flex flex-col gap-1'>
              <SectionLabel>Characteristics</SectionLabel>
              <Tiles>{ATTRIBUTES.map((p) => <SimpleCharacteristic key={p} propName={p} />)}</Tiles>
              <Tiles>{TRAINABLES.map((p) => <SimpleCharacteristic key={p} propName={p} />)}</Tiles>
            </div>

            <div className='flex flex-col gap-1'>
              <SectionLabel>Combat</SectionLabel>
              <Tiles>{COMBAT.map((s) => <SimpleSkill key={s} skillId={s} />)}</Tiles>
            </div>
            <div className='flex flex-col gap-1'>
              <SectionLabel>Physical</SectionLabel>
              <Tiles>{PHYSICAL.map((s) => <SimpleSkill key={s} skillId={s} />)}</Tiles>
            </div>
            <div className='flex flex-col gap-1'>
              <SectionLabel>Mind &amp; social</SectionLabel>
              <Tiles>{MIND.map((s) => <SimpleSkill key={s} skillId={s} />)}</Tiles>
            </div>
            <KnowledgesPanel />
            <textarea aria-label='notes' className='border border-line rounded p-1 min-h-32 w-full bg-surface text-sm' value={notes} readOnly/>
            <div><Button variant='primary' onClick={savePlayerCharacter}>save</Button></div>
          </div>
          <div className='flex flex-col md:col-span-5 gap-3 text-sm'>
            <AfflictionsPannel />
            <ArmorPanel />
            <HandsPanel />
            <WeaponPanel />
            <ContainerPanel />
            <AbilityPanel />
            <SpellPanel />
          </div>
        </div>
        : null
      }
    </div>
  )
}

function DamageButton({amount}: {amount: number}){
  const { injuries, setInjury } = useInjuryLens()

  const dealDamage = () => {
    setInjury('injuryLevel', injuries.injuryLevel + amount);
  }

  return <Button size='xs' variant='bad' className='font-mono w-8' aria-label={`cause${amount}Injury`} onClick={dealDamage}>{amount}</Button>
}

function DamageControl(){
  return(
    <div className='flex flex-col items-center gap-1'>
      <span className='text-[10px] text-muted'>cause injury</span>
      <div className='grid grid-cols-2 gap-1'>
        <DamageButton amount={5} />
        <DamageButton amount={10} />
        <DamageButton amount={20} />
        <DamageButton amount={30} />
      </div>
    </div>
  )
}

const INJURY_TITLES = { injuryLevel: 'injury level', bleed: 'bleed', potion: 'potion' } as const

// The injury dial's ring and digits, one colour per stage.
const INJURY_STAGE_CLASS = {
  0: 'border-line bg-surface',
  1: 'border-injury-1 bg-injury-1/15 text-injury-1',
  2: 'border-injury-2 bg-injury-2/20 text-injury-2',
  3: 'border-injury-3 bg-injury-3/25 text-injury-3',
  4: 'border-injury-4 bg-injury-4/40 text-injury-3',
  5: 'border-injury-5 bg-injury-5/70 text-fg',
} as const

function InjuryControl({type}: {type: 'injuryLevel' | 'bleed' | 'potion'}){

  const {injuries, setInjury, injuryStage} = useInjuryLens()
  const { updateIL } = useCharacterCommands()

  const value = injuries[type]
  const ring =
    type === 'injuryLevel' ? INJURY_STAGE_CLASS[injuryStage] :
    type === 'bleed' && value > 0 ? 'border-bad bg-bad/15 text-bad' :
    'border-line bg-surface'
  return(
    <div className='flex flex-col items-center gap-1'>
      <span className='text-[10px] text-muted'>{INJURY_TITLES[type]}</span>
      <div className={`flex flex-col items-center justify-center gap-0.5 rounded-full border w-16 h-16 ${ring}`}>
        <NumberInput className='w-10 border-transparent text-base' aria-label={'injury'} value={value} onChange={(e) => setInjury( type, parseInt(e.target.value))} />
        <div className='flex flex-row gap-2 text-xs text-muted'>
          <button type='button' className='hover:text-fg cursor-pointer' aria-label={'causeInjury'} onClick={() => setInjury( type, value + 1)}>+</button>
          <button type='button' className='hover:text-fg cursor-pointer' aria-label={'healInjury'} onClick={() => type == 'injuryLevel' ? updateIL(value - 1) : setInjury( type, value - 1)}>−</button>
        </div>
      </div>
    </div>
  )
}

function SimpleResource({rssName}: {rssName: keyof Resources}){

  const [ value, setValue] = useResourceLens(rssName)
  const { updateSTA } = useCharacterCommands()

  return(
    <div className='flex flex-row items-center gap-1.5 rounded border border-line bg-surface px-1.5 py-1 w-24'>
      <div className='flex flex-col min-w-0 grow'>
        <span className='text-[10px] text-muted truncate'>{rssName}</span>
        <NumberInput className='w-full border-transparent text-left text-base px-0' aria-label={rssName} value={value} onChange={(e) => setValue(parseInt(e.target.value) ?? 0)} />
      </div>
      <div className='flex flex-col gap-0.5'>
        <button type='button' className='border border-line rounded w-4 h-4 text-[10px] leading-none text-muted hover:text-fg hover:border-muted cursor-pointer' aria-label={rssName} onClick={() => setValue(value+1)}>+</button>
        <button type='button' className='border border-line rounded w-4 h-4 text-[10px] leading-none text-muted hover:text-fg hover:border-muted cursor-pointer' aria-label={rssName} onClick={() => rssName == 'STA' ? updateSTA(value-1) : setValue(value-1)}>−</button>
      </div>
    </div>
  )
}

function SimpleCharacteristic({propName}: {propName: keyof Characteristics}){
  const [value, , terms, view] = useCharacteristicLens(propName)
  const [name] = useTrainableNameLens(propName)
  return(
    <SkillTooltip terms={terms} total={value}>
      <StatTile label={name} value={value} modifier={view.modifier} afflicted={view.afflicted} />
    </SkillTooltip>
  )
}

function SimpleSkill({skillId}: {skillId: keyof Skills}){
  const [value, , terms, view] = useSkillLens(skillId)
  const [name] = useTrainableNameLens(skillId)
  return(
    <SkillTooltip terms={terms} total={value}>
      <StatTile label={name} value={value} modifier={view.modifier} afflicted={view.afflicted} />
    </SkillTooltip>
  )
}

function KnowledgesPanel(){
  const { knowledges } = useKnowledgeLens()
  const names = Object.keys(knowledges)

  if(!names.length) return null

  return(
    <div className='flex flex-col gap-1'>
      <SectionLabel>Knowledge</SectionLabel>
      <Tiles>{names.map(name => <SimpleKnowledge key={name} name={name} />)}</Tiles>
    </div>
  )
}

function SimpleKnowledge({name}: {name: string}){
  const { getValue } = useKnowledgeLens()
  const [terms, view] = useKnowledgeTerms(name)
  const value = getValue(name)
  return(
    <SkillTooltip terms={terms} total={value}>
      <StatTile label={name} value={value} modifier={view.modifier} afflicted={view.afflicted} />
    </SkillTooltip>
  )
}

function SimpleMove({moveName, title}: {moveName: keyof Movement, title: string}){
  const [value] = useMovementLens(moveName)
  return <StatTile label={title} value={value} className='w-22' />
}

function AfflictionsPannel(){

  const { sections, setAffliction } = useAfflictionBoard()

  return(
    <div className='flex flex-row flex-wrap gap-3 items-start text-xs'>
      {
        sections.map((section) => (
          <div key={section.category} className='flex flex-col gap-1'>
            <SectionLabel>{section.category}</SectionLabel>
            {
              // A ladder is one button showing only the rung the character is
              // on; a click steps it up and wraps to off from the top.
              // Non-controlable entries are derived from hunger, thirst and
              // exhaustion — they still light up, but they aren't hand-settable.
              section.entries.map((entry) => (
                <Button key={entry.name} size='xs' disabled={!entry.controlable} title={entry.name}
                  variant={entry.active ? 'bad' : 'default'} className={`text-left ${entry.active ? 'bg-bad/15' : ''}`}
                  aria-label={entry.name} onClick={() => setAffliction(entry.toggle)}>{entry.label}</Button>
              ))
            }
          </div>
        ))
      }
    </div>
  )
}

function SurgeControl(){
  const { actionSurge } = useCharacterCommands()
  const options = useSurgeOptions()

  return(
    <div className='flex gap-1'>
      {
        options.map(option =>
          // The surge spent this round stays lit until nextRound clears it; the
          // other three close (combat.tex "Action surge": one per round).
          <Tooltip key={option.kind} text={option.used ? `${option.kind} surge used this round` : option.title}>
            {
              option.used ?
              <Button aria-label={option.kind + ' surge'} aria-pressed variant='primary' className='bg-accent/20 pointer-events-none'>
                <span className='mr-1'>✓</span>{option.kind} surge
              </Button> :
              <Button aria-label={option.kind + ' surge'} disabled={!option.available}
                onClick={() => actionSurge(option.kind)}>{option.kind} surge</Button>
            }
          </Tooltip>
        )
      }
    </div>
  )
}

function CharacterList(){
  const { roster, pick } = useCombatRoster()

  return(
    <div className='flex flex-row gap-1.5 grow overflow-x-auto'>
      {
        roster.map((entry) =>
          <Button key={entry.id} aria-label={entry.name}
            variant={entry.targetable ? 'bad' : entry.isActive ? 'primary' : 'default'}
            className={entry.targetable ? 'animate-pulse' : entry.isActive ? 'bg-accent/15' : ''}
            onClick={() => pick(entry)}>
            {entry.name}
            {entry.usedSurge ? <span className={`ml-1.5 text-[10px] ${entry.isActive ? 'text-accent/80' : 'text-muted'}`}>✓ {entry.usedSurge}</span> : null}
            {entry.role && entry.role !== 'none' ? <span className='ml-1.5 text-[10px] text-muted'>{entry.role}</span> : null}
          </Button>
        )
      }
    </div>
  )
}
