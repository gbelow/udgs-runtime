'use client'
import { useState, type ReactNode } from 'react'
import { ArmorPanel } from './ArmorPanel';
import { ContainerPanel } from './ContainerPanel';
import { TradePanel } from './TradePanel'
import { HandsPanel } from './HandsPanel';
import { Minus, Plus } from 'lucide-react'
import { Button, IconButton, NumberInput, SectionLabel, Segment, Segmented, StatTile, Tiles, selectClass } from './ui';
import { Characteristics, Knowledges, Movement, Resources, Skills } from '../domain/types';
import { useSkillLens } from '../hooks/useSkillLens';
import { SkillTooltip } from './SkillTooltip';
import { useMovementLens } from '../hooks/useMovementLens';
import { useCharacteristicLens } from '../hooks/useCharacteristicLens';
import { useInjuryLens } from '../hooks/useinjuryLens';
import { useResourceBars, useResourceLens } from '../hooks/useResourceLens';
import { HURT, THIRDS } from './SceneCards';
import { useCharacterCommands } from '../hooks/useCharacterCommands';
import { useActiveAfflictions, useAfflictionBoard } from '../hooks/useAfflictionLens';
import { useCurseLens, usePendingLens } from '../hooks/usePendingLens';
import { RollButtons } from './DieCalls';
import { useWoundLens } from '../hooks/useWoundLens';
import { useGameCommands } from '../hooks/useGameCommands';
import { useActiveCharacterData } from '../hooks/useCharacterData';
import { useTrainableNameLens } from '../hooks/useTrainableNameLens';
import { useConvictionXP } from '../hooks/useConvictionXP';
import { useRiskyTests } from '../hooks/useRiskyTests';
import { useFormalKnowledgeLens, useKnowledgeTerms, useSpecificKnowledges } from '../hooks/useKnowledgeLens';
import { knowledges_list } from '../domain/lists';

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
  return(
    <div className='grid grid-cols-1 md:grid-cols-12 gap-4 py-3'>
      <div className='md:col-span-7 flex flex-col gap-3 text-sm'>
        {header}
        <ResourceTiles>{resources}</ResourceTiles>
        <InjurySection action={injuryAction} panels={injuryPanels} />
        {afterInjury}
        <MovementTiles />
        <CharacteristicTiles />
        <SkillTiles />
        <KnowledgesPanel />
        <SpecificKnowledgesPanel />
        <NotesAndSave />
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

export function ResourceTiles({ children, after, needs = true }: { children?: ReactNode, after?: ReactNode, needs?: boolean }){
  const { tableName, name } = useActiveCharacterData()
  return(
    <div className='flex flex-col gap-1 min-w-0 overflow-hidden'>
      <SectionLabel className='block max-w-full truncate !text-xs'>{tableName || name}</SectionLabel>
      <div className='flex flex-row flex-wrap gap-1.5'>
        {children}
        <SimpleResource rssName={'STA'} />
        {after}
        {needs ? <>
          <SimpleResource rssName={'exhaustion'} />
          <SimpleResource rssName={'hunger'} />
          <SimpleResource rssName={'thirst'} />
        </> : null}
      </div>
    </div>
  )
}

// AP, STA and IL as bars coloured as a face shows them, one under the other,
// with what is passed in (the surges) under them.
export function ResourceBars({ after }: { after?: ReactNode }){
  const { tableName, name } = useActiveCharacterData()
  const bars = useResourceBars()
  const [AP, setAP] = useResourceLens('AP')
  const [STA, setSTA] = useResourceLens('STA')
  const { injuries, setInjury } = useInjuryLens()
  const { updateSTA, updateIL } = useCharacterCommands()
  if (!bars) return null
  const IL = injuries.injuryLevel
  return(
    <div className='flex flex-col gap-1 min-w-0'>
      <SectionLabel className='block max-w-full truncate !text-xs'>{tableName || name}</SectionLabel>
      <div className='flex flex-col gap-2 items-start'>
        <div className='flex flex-col gap-1.5 w-full min-w-0'>
          <Bar label='AP' value={AP} fill={bars.AP.fill} color={THIRDS[bars.AP.third].className} title={THIRDS[bars.AP.third].label}
            set={setAP} raise={() => setAP(AP + 1)} lower={() => setAP(AP - 1)} />
          <Bar label='STA' value={STA} fill={bars.STA.fill} color={THIRDS[bars.STA.third].className} title={THIRDS[bars.STA.third].label}
            set={setSTA} raise={() => setSTA(STA + 1)} lower={() => updateSTA(STA - 1)} />
          <Bar label='IL' value={IL} fill={bars.IL.fill} color={HURT[bars.IL.tens]} title={`injury level, collapse marked`} mark={bars.IL.collapse}
            set={(v) => setInjury('injuryLevel', v)} raise={() => setInjury('injuryLevel', IL + 1)} lower={() => updateIL(IL - 1)} />
        </div>
        {after}
      </div>
    </div>
  )
}

function Bar({ label, value, fill, color, title, mark, set, raise, lower }: { label: string, value: number, fill: number, color: string, title: string, mark?: number, set: (value: number) => void, raise: () => void, lower: () => void }){
  return(
    <div className='flex flex-row items-center gap-1.5'>
      <span className='w-7 shrink-0 text-[10px] text-muted'>{label}</span>
      <div title={title} className='relative grow min-w-12 h-3 rounded-sm border border-line bg-raised overflow-hidden'>
        <div className={`absolute inset-y-0 left-0 ${color}`} style={{ width: `${fill}%` }} />
        {mark !== undefined ? <div className='absolute inset-y-0 w-px bg-fg/70' style={{ left: `${mark}%` }} /> : null}
      </div>
      <NumberInput className='w-10 border-transparent text-sm px-0' aria-label={label} value={value} onChange={(e) => set(parseInt(e.target.value) || 0)} />
      <div className='flex flex-row gap-0.5'>
        <IconButton icon={Plus} aria-label={`raise ${label}`} title='raise' onClick={raise} />
        <IconButton icon={Minus} aria-label={`lower ${label}`} title='lower' onClick={lower} />
      </div>
    </div>
  )
}

export function InjuryDials({ action, level = true }: { action?: ReactNode, level?: boolean }){
  return(
    <div className='flex flex-row flex-wrap gap-3 items-end'>
      <InjuryControl type='potion' />
      {level ? <InjuryControl type='injuryLevel' /> : null}
      <InjuryControl type='bleed' />
      <InjuryControl type='burning' />
      {action}
    </div>
  )
}

function InjurySection({ action, panels }: { action?: ReactNode, panels?: ReactNode }){
  return(
    <div className='flex flex-col gap-1'>
      <SectionLabel>Injury</SectionLabel>
      <div className='flex flex-row flex-wrap gap-x-6 gap-y-3 items-start'>
        <InjuryDials action={action} />
        <div className='flex flex-col gap-2 min-w-48'>
          <WoundPanel />
          <CursePanel />
          {panels}
        </div>
      </div>
    </div>
  )
}

export function MovementTiles(){
  return(
    <div className='flex flex-col gap-1'>
      <SectionLabel>Movement</SectionLabel>
      <Tiles>{MOVES.map((m) => <SimpleMove key={m.name} moveName={m.name} title={m.title} />)}</Tiles>
    </div>
  )
}

export function CharacteristicTiles(){
  return(
    <div className='flex flex-col gap-1'>
      <SectionLabel>Characteristics</SectionLabel>
      <Tiles>{ATTRIBUTES.map((p) => <SimpleCharacteristic key={p} propName={p} />)}</Tiles>
      <Tiles>{TRAINABLES.map((p) => <SimpleCharacteristic key={p} propName={p} />)}</Tiles>
      <div className='flex flex-row flex-wrap gap-2'>
        <ConvictionXP slot='conviction1' />
        <ConvictionXP slot='conviction2' />
        <RiskyTests />
      </div>
    </div>
  )
}

// A conviction's XP, raised or lowered by hand for the attitudes the table
// judges (abilities.tex "Promoted Attitudes"), given to something it may
// study where one is picked (abilities.json "Cunning Studies", abilities.tex
// "Adaptive Learning"), with how far each XP goes on it.
function ConvictionXP({slot}: {slot: 'conviction1' | 'conviction2'}){
  const { name, XP, adopted, studies, addXP, study } = useConvictionXP(slot)
  const [studied, setStudied] = useState('')
  if (!adopted) return null
  const picked = studies.find((s) => s.key === studied)
  return(
    <div className='flex flex-row items-center gap-1.5 rounded border border-line bg-surface px-1.5 py-1 text-sm'>
      <span className='text-muted'>{name} XP</span>
      <span className='tabular-nums'>{XP}</span>
      <IconButton icon={Plus} aria-label={`give ${name} XP`} title={picked ? `give 1 XP to ${name}, ${picked.rate} to ${picked.name}` : 'give 1 XP'} onClick={() => (picked ? study(picked.target, 1) : addXP(1))} />
      <IconButton icon={Minus} aria-label={`take ${name} XP`} title='take 1 XP' onClick={() => addXP(-1)} />
      {studies.length > 0 ?
        <select aria-label={`${name} XP also trains`} className={selectClass} value={picked?.key ?? ''} onChange={(e) => setStudied(e.target.value)}>
          <option value=''>{name} only</option>
          {studies.map((s) => <option key={s.key} value={s.key}>also {s.name}{s.rate === 1 ? '' : ` (×${s.rate})`}</option>)}
        </select> : null}
    </div>
  )
}

// play.tex "Safe and risky tests": whether the character throws every test
// they may throw riskily in a risky manner (abilities.tex "Adaptation").
function RiskyTests(){
  const { shown, risky, setRisky } = useRiskyTests()
  if (!shown) return null
  return(
    <Segmented label='tests'>
      <Segment selected={!risky} onClick={() => setRisky(false)}>normal tests</Segment>
      <Segment selected={risky} onClick={() => setRisky(true)}>risky tests</Segment>
    </Segmented>
  )
}

export function SkillTiles(){
  return(
    <>
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
    </>
  )
}

export function NotesAndSave(){
  const { copyToMyCharacters } = useGameCommands()
  const { tableName, description, notes, setNotes } = useActiveCharacterData()
  return(
    <>
      {description ? <p className='text-sm'>{description}</p> : null}
      <label className='flex flex-col gap-1'>
        <SectionLabel>notes</SectionLabel>
        <textarea key={`${tableName}:${notes}`} aria-label='notes' className='border border-line rounded p-1 min-h-32 w-full bg-surface text-sm' placeholder='kept while they are in play' defaultValue={notes} onBlur={(e) => setNotes(e.target.value)} />
      </label>
      <div><Button weight='solid' tone='accent' onClick={copyToMyCharacters}>copy to my characters</Button></div>
    </>
  )
}

const MOVES: { name: keyof Movement, title: string }[] = [
  { name: 'walk', title: 'walk' },
  { name: 'tread', title: 'tread' },
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
        <div className='flex flex-row gap-1'>
          <IconButton icon={Plus} aria-label={'causeInjury'} title='raise' onClick={() => setInjury( type, value + 1)} />
          <IconButton icon={Minus} aria-label={'healInjury'} title='lower' onClick={() => type == 'injuryLevel' ? updateIL(value - 1) : setInjury( type, value - 1)} />
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

export function KnowledgesPanel(){
  return(
    <div className='flex flex-col gap-1'>
      <SectionLabel>Knowledge</SectionLabel>
      <Tiles>{knowledges_list.map(key => <SimpleKnowledge key={key} knowledgeKey={key} />)}</Tiles>
    </div>
  )
}

function SimpleKnowledge({knowledgeKey}: {knowledgeKey: keyof Knowledges}){
  const [value, , terms, view] = useFormalKnowledgeLens(knowledgeKey)
  return(
    <SkillTooltip terms={terms} total={value}>
      <StatTile label={knowledgeKey} value={value} modifier={view.modifier} afflicted={view.afflicted} />
    </SkillTooltip>
  )
}

export function SpecificKnowledgesPanel(){
  const { names } = useSpecificKnowledges()
  if(!names.length) return null
  return(
    <div className='flex flex-col gap-1'>
      <SectionLabel>Specific knowledge</SectionLabel>
      <Tiles>{names.map(name => <SimpleSpecificKnowledge key={name} name={name} />)}</Tiles>
    </div>
  )
}

function SimpleSpecificKnowledge({name}: {name: string}){
  const { getValue } = useSpecificKnowledges()
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
export function PendingPanel(){
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
          <RollButtons name={r.name || r.kind} options={[{ key: 'roll', label: 'roll' }]} onRoll={(_, die) => roll(r.index, die)} />
        </div>
      ))}
    </div>
  )
}

// combat.tex "Wounds": each wound carried, the part it took, what it does,
// and the IL wound still to heal — healed here a point at a time.
export function WoundPanel(){
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
            <IconButton icon={Minus} aria-label={`heal ${r.name}`} onClick={() => heal(r.index, 1)} />
            <IconButton icon={Plus} aria-label={`reopen ${r.name}`} onClick={() => heal(r.index, -1)} />
          </span>
        </div>
      ))}
    </div>
  )
}

// spells.tex "Curse": what the character carries until they beat it, each
// with the test that does.
export function CursePanel(){
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
              <RollButtons name={r.name} options={[{ key: 'resist', label: 'resist' }]} onRoll={(_, die) => resist(r.key, die)} />
            </>
          ) : <span className='text-muted'>no test beats it</span>}
        </div>
      ))}
    </div>
  )
}

export function ActiveConditions(){
  const labels = useActiveAfflictions()
  const { rows } = useWoundLens()

  return(
    <div className='flex flex-row flex-wrap gap-1 text-xs min-w-0'>
      {rows.map((r) => <span key={`wound-${r.index}`} className='px-1.5 py-0.5 rounded bg-bad/15 text-bad'>{r.name}</span>)}
      {labels.map((label) => <span key={label} className='px-1.5 py-0.5 rounded bg-bad/15 text-bad'>{label}</span>)}
    </div>
  )
}

export function AfflictionsPannel(){

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
                  tone={entry.active ? 'bad' : 'neutral'} active={entry.active} className='text-left'
                  aria-label={entry.name} onClick={() => setAffliction(entry.toggle)}>{entry.label}</Button>
              ))
            }
          </div>
        ))
      }
    </div>
  )
}
