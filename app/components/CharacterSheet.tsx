'use client'
import type { ReactNode } from 'react'
import { ArmorPanel } from './ArmorPanel';
import { ContainerPanel } from './ContainerPanel';
import { TradePanel } from './TradePanel'
import { HandsPanel } from './HandsPanel';
import { Button, NumberInput, SectionLabel, StatTile, Tiles } from './ui';
import { Characteristics, Movement, Resources, Skills } from '../domain/types';
import { useSkillLens } from '../hooks/useSkillLens';
import { SkillTooltip } from './SkillTooltip';
import { useMovementLens } from '../hooks/useMovementLens';
import { useCharacteristicLens } from '../hooks/useCharacteristicLens';
import { useInjuryLens } from '../hooks/useinjuryLens';
import { useResourceLens } from '../hooks/useResourceLens';
import { useCharacterCommands } from '../hooks/useCharacterCommands';
import { useAfflictionBoard } from '../hooks/useAfflictionLens';
import { useCurseLens, usePendingLens } from '../hooks/usePendingLens';
import { useWoundLens } from '../hooks/useWoundLens';
import { useGameCommands } from '../hooks/useGameCommands';
import { useActiveCharacterData } from '../hooks/useCharacterData';
import { useTrainableNameLens } from '../hooks/useTrainableNameLens';
import { useKnowledgeLens, useKnowledgeTerms } from '../hooks/useKnowledgeLens';

type SheetSlots = {
  // the row under the sheet's name and what follows it
  header: ReactNode
  // resource tiles before the ones every sheet shows
  resources?: ReactNode
  // beside the injury dials, and under the wounds and curses
  injuryAction?: ReactNode
  injuryPanels?: ReactNode
  // between the injuries and the movement
  afterInjury?: ReactNode
  // the right column: above the pending tests, between the hands and the
  // containers, and at the end
  asideTop?: ReactNode
  asideMid?: ReactNode
  asideEnd?: ReactNode
}

// The active character's sheet as play shows it, wherever they are; each
// panel fills the slots with what only it offers.
export function CharacterSheet({ header, resources, injuryAction, injuryPanels, afterInjury, asideTop, asideMid, asideEnd }: SheetSlots){

  const { savePlayerCharacter } = useGameCommands()
  const { notes } = useActiveCharacterData()

  return(
    <div className='grid grid-cols-1 md:grid-cols-12 gap-4 py-3'>
      <div className='md:col-span-7 flex flex-col gap-3 text-sm'>
        {header}

        <div className='flex flex-col gap-1'>
          <SectionLabel>Resources</SectionLabel>
          <div className='flex flex-row flex-wrap gap-1.5'>
            {resources}
            <SimpleResource rssName={'STA'} />
            <SimpleResource rssName={'exhaustion'} />
            <SimpleResource rssName={'hunger'} />
            <SimpleResource rssName={'thirst'} />
          </div>
        </div>

        <div className='flex flex-col gap-1'>
          <SectionLabel>Injury</SectionLabel>
          <div className='flex flex-row flex-wrap gap-x-6 gap-y-3 items-start'>
            <div className='flex flex-row flex-wrap gap-3 items-end'>
              <InjuryControl type='potion' />
              <InjuryControl type='injuryLevel' />
              <InjuryControl type='bleed' />
              <InjuryControl type='burning' />
              {injuryAction}
            </div>
            <div className='flex flex-col gap-2 min-w-48'>
              <WoundPanel />
              <CursePanel />
              {injuryPanels}
            </div>
          </div>
        </div>

        {afterInjury}

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
        {asideTop}
        <PendingPanel />
        <AfflictionsPannel />
        <ArmorPanel />
        <HandsPanel />
        {asideMid}
        <ContainerPanel />
        <TradePanel />
        {asideEnd}
      </div>
    </div>
  )
}

const MOVES: { name: keyof Movement, title: string }[] = [
  { name: 'basic', title: 'basic' },
  { name: 'careful', title: 'careful' },
  { name: 'crawl', title: 'crawl' },
  { name: 'climb', title: 'climb' },
  { name: 'run', title: 'run' },
  { name: 'swim', title: 'swim' },
  { name: 'jump', title: 'jump' },
  { name: 'stand', title: 'stand up' },
]
const ATTRIBUTES: (keyof Characteristics)[] = ['STR', 'AGI', 'STA', 'CON', 'INT', 'SPI', 'DEX']
const TRAINABLES: (keyof Characteristics)[] = ['melee', 'ranged', 'awareness', 'charisma', 'sorcery', 'conviction1', 'conviction2', 'devotion']
const COMBAT: (keyof Skills)[] = ['strike', 'accuracy', 'defend', 'reflex', 'grapple', 'force', 'SD']
const PHYSICAL: (keyof Skills)[] = ['balance', 'climb', 'detection', 'stealth', 'prestidigitation', 'health', 'swim']
const MIND: (keyof Skills)[] = ['cunning', 'explore', 'will', 'persuasion', 'deception', 'insight']

const INJURY_TITLES = { injuryLevel: 'injury level', bleed: 'bleed', burning: 'burning', potion: 'potion' } as const

// The injury dial's ring and digits, one colour per stage.
const INJURY_STAGE_CLASS = {
  0: 'border-line bg-surface',
  1: 'border-injury-1 bg-injury-1/15 text-injury-1',
  2: 'border-injury-2 bg-injury-2/20 text-injury-2',
  3: 'border-injury-3 bg-injury-3/25 text-injury-3',
  4: 'border-injury-4 bg-injury-4/40 text-injury-3',
  5: 'border-injury-5 bg-injury-5/70 text-fg',
} as const

function InjuryControl({type}: {type: keyof typeof INJURY_TITLES}){

  const {injuries, setInjury, injuryStage} = useInjuryLens()
  const { updateIL } = useCharacterCommands()

  const value = injuries[type]
  const ring =
    type === 'injuryLevel' ? INJURY_STAGE_CLASS[injuryStage] :
    type === 'bleed' && value > 0 ? 'border-bad bg-bad/15 text-bad' :
    type === 'burning' && value > 0 ? 'border-injury-2 bg-injury-2/15 text-injury-2' :
    'border-line bg-surface'
  return(
    <div className='flex flex-col items-center gap-1'>
      <span className='text-[10px] text-muted'>{INJURY_TITLES[type]}</span>
      <div className={`flex flex-col items-center justify-center gap-0.5 rounded-full border w-16 h-16 ${ring}`}>
        <NumberInput className='w-12 border-transparent text-base' aria-label={'injury'} value={value} onChange={(e) => setInjury( type, parseInt(e.target.value) || 0)} />
        <div className='flex flex-row gap-2 text-xs text-muted'>
          <button type='button' className='hover:text-fg cursor-pointer' aria-label={'causeInjury'} onClick={() => setInjury( type, value + 1)}>+</button>
          <button type='button' className='hover:text-fg cursor-pointer' aria-label={'healInjury'} onClick={() => type == 'injuryLevel' ? updateIL(value - 1) : setInjury( type, value - 1)}>−</button>
        </div>
      </div>
    </div>
  )
}

export function SimpleResource({rssName}: {rssName: keyof Resources}){

  const [ value, setValue] = useResourceLens(rssName)
  const { updateSTA } = useCharacterCommands()

  return(
    <div className='flex flex-row items-center gap-1.5 rounded border border-line bg-surface px-1.5 py-1 w-24'>
      <div className='flex flex-col min-w-0 grow'>
        <span className='text-[10px] text-muted truncate'>{rssName}</span>
        <NumberInput className='w-full border-transparent text-left text-base px-0' aria-label={rssName} value={value} onChange={(e) => setValue(parseInt(e.target.value) || 0)} />
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

// Effects delivered to the character that wait on a test of their own:
// each rolled here, landing or not as the die says.
function PendingPanel(){
  const { rows, roll } = usePendingLens()
  if (rows.length === 0) return null
  return(
    <div className='flex flex-col gap-1 text-xs'>
      <SectionLabel>pending</SectionLabel>
      {rows.map((r) => (
        <div key={r.index} className='flex flex-row flex-wrap gap-x-3 items-center'>
          <span>{r.name || r.kind}</span>
          <SkillTooltip terms={r.terms} total={r.total}>
            <span className='text-muted'>{r.roll} <span className='font-mono text-fg'>{r.total}</span> vs DL <span className='font-mono text-fg'>{r.DL}</span></span>
          </SkillTooltip>
          <Button size='xs' variant='primary' aria-label={`roll ${r.name || r.kind}`} onClick={() => roll(r.index)}>roll</Button>
        </div>
      ))}
    </div>
  )
}

// combat.tex "Wounds": each wound carried, the part it took, what it does,
// and the IL wound still to heal — healed here a point at a time.
function WoundPanel(){
  const { rows, heal } = useWoundLens()
  return(
    <div className='flex flex-col gap-1 text-xs'>
      <SectionLabel>wounds</SectionLabel>
      {rows.length === 0 ? <span className='text-muted'>none</span> : rows.map((r) => (
        <div key={r.index} className='flex flex-row flex-wrap gap-x-3 items-center'>
          <span className='text-bad'>{r.name}</span>
          <span className='text-muted'>{r.part} · {r.consequence}</span>
          <span className='flex flex-row items-center gap-1 ml-auto'>
            <span className='font-mono text-fg'>{r.IL}</span><span className='text-muted'>IL to heal</span>
            <Button size='xs' aria-label={`heal ${r.name}`} onClick={() => heal(r.index, 1)}>−</Button>
            <Button size='xs' aria-label={`reopen ${r.name}`} onClick={() => heal(r.index, -1)}>+</Button>
          </span>
        </div>
      ))}
    </div>
  )
}

// spells.tex "Curse": what the character carries until they beat it, each
// with the test that does.
function CursePanel(){
  const { rows, resist } = useCurseLens()
  if (rows.length === 0) return null
  return(
    <div className='flex flex-col gap-1 text-xs'>
      <SectionLabel>cursed</SectionLabel>
      {rows.map((r) => (
        <div key={r.key} className='flex flex-row flex-wrap gap-x-3 items-center'>
          <span>{r.name}</span>
          {r.roll ? (
            <>
              <SkillTooltip terms={r.terms} total={r.total}>
                <span className='text-muted'>{r.roll} <span className='font-mono text-fg'>{r.total}</span> vs DL <span className='font-mono text-fg'>{r.DL}</span></span>
              </SkillTooltip>
              <Button size='xs' variant='primary' aria-label={`resist ${r.name}`} onClick={() => resist(r.key)}>resist</Button>
            </>
          ) : <span className='text-muted'>no test beats it</span>}
        </div>
      ))}
    </div>
  )
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
              // exhaustion, or held on by a wound, a curse or the ground —
              // they still light up, but a click cannot switch them off.
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
