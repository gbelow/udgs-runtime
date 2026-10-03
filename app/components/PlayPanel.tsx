'use client'
import { useState } from 'react'
import { ArmorPanel } from './ArmorPanel';
import { WeaponPanel } from './WeaponPanel';
import { ContainerPanel } from './ContainerPanel';
import { HandsPanel } from './HandsPanel';
import { AbilityPanel } from './AbilityPanel';
import { SpellPanel } from './SpellPanel';
import { ActionPanel } from './ActionPanel';
import { BoardPanel } from './BoardPanel';
import { makeDieRoll } from './utils';
import { Button, NumberInput, SectionLabel, StatTile, Tiles, Tooltip } from './ui';
import { useCombatRoster, useCombatState, useCombatSurgeOptions, useMorale, useSocial, useTurnControls } from '../hooks/useCombatState';import { ROLL_MODES } from '../domain/combat/dice';
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
import { useCurseLens, usePendingLens } from '../hooks/usePendingLens';
import { useSustainedPanel } from '../hooks/useSustainedPanel';
import { useWoundLens } from '../hooks/useWoundLens';
import { useGameCommands } from '../hooks/useGameCommands';
import { useActiveCharacterData, useBindingSurge } from '../hooks/useCharacterData';
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

  const { nextRound, resetCombat, killCharacter } = useCombatCommands()
  const { savePlayerCharacter} = useGameCommands()
  const { isCharacterDead } = useInjuryLens()
  const { round, hasActiveCharacter: isThereActiveCharacter, hasOpenAction, nextRoundBar } = useCombatState()
  const { notes, fightName } = useActiveCharacterData()

  const [dice10, setDice10] = useState(1)
  const [dice6, setDice6] = useState(1)

  return(
    <div className='flex flex-col text-left'>
      <div className='flex flex-row gap-2 items-center py-2 border-b border-line'>
        <span className='text-xs text-muted'>Round <span className='font-mono text-fg'>{round}</span></span>
        <CharacterList />
        <Button aria-label='nextRound' disabled={nextRoundBar !== null} title={nextRoundBar ?? undefined} onClick={nextRound}>next round</Button>
        <Button aria-label='resetGame' variant='ghost' onClick={resetCombat}>reset</Button>
      </div>
      <MoralePanel />
      {isThereActiveCharacter ? <SocialPanel /> : null}
      {
        isThereActiveCharacter ?
        <div className='grid grid-cols-1 md:grid-cols-12 gap-4 py-3'>
          <div className='md:col-span-7 flex flex-col gap-3 text-sm'>
            <div className='flex flex-row flex-wrap gap-1.5 items-center'>
              <span className='text-base font-medium mr-2'>{fightName}</span>
              <TurnControl />
              <Button aria-label='roll' onClick={() => setDice10(makeDieRoll(10))}>d10 <span className='font-mono text-fg'>{dice10}</span></Button>
              <Button aria-label='roll' onClick={() => setDice6(makeDieRoll(6))}>d6 <span className='font-mono text-fg'>{dice6}</span></Button>
              <SurgeControl />
            </div>
            <ActionPanel />

            <div className='flex flex-col gap-1'>
              <SectionLabel>Resources</SectionLabel>
              <div className='flex flex-row flex-wrap gap-1.5'>
                <SimpleResource rssName={'AP'} />
                <SimpleResource rssName={'surgeAP'} />
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
                  <Button variant='bad' active={isCharacterDead} disabled={hasOpenAction} title={hasOpenAction ? 'an action is being played out' : undefined} className={isCharacterDead ? 'bg-bad/20' : ''} onClick={killCharacter}>{isCharacterDead ? 'dead' : 'kill'}</Button>
                </div>
                <div className='flex flex-col gap-2 min-w-48'>
                  <WoundPanel />
                  <CursePanel />
                  <SustainedPanel />
                </div>
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
            <BoardPanel />
            <PendingPanel />
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

// spells.tex "Sustained Spells": what the character is holding, what it
// costs each round and to fire again, and who it links or binds them to.
function SustainedPanel(){
  const { rows, release } = useSustainedPanel()
  if (rows.length === 0) return null
  return(
    <div className='flex flex-col gap-1 text-xs'>
      <SectionLabel>sustaining</SectionLabel>
      {rows.map((r) => (
        <div key={r.key} className='flex flex-col gap-0.5'>
          <div className='flex flex-row flex-wrap gap-x-3 items-center'>
            <span className='text-accent'>{r.name}</span>
            <span className='text-muted'>{r.upkeep ? <>upkeep <span className='font-mono'>{r.upkeep}</span> a round</> : 'no upkeep'}</span>
            {r.repeat ? <span className='text-muted'>again <span className='font-mono'>{r.repeat}</span></span> : null}
            {r.linkDL > 0 ? <span className='text-muted'>casting <span className='font-mono text-fg'>+{r.linkDL}</span> DL</span> : null}
            <Button size='xs' className='ml-auto' aria-label={`release ${r.name}`} onClick={() => release(r.key)}>release</Button>
          </div>
          {r.linked.length > 0 ? <span className='text-muted'>linked to {r.linked.map((t) => t.name).join(', ')}</span> : null}
          {r.boundTo ? <span className='text-muted'>arc to {r.boundTo}</span> : null}
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

// play.tex "Combat": a turn is started by whoever asks first, and can be
// contested before its holder declares anything — by as many as ask, all
// rolling cunning at once.
function TurnControl(){
  const { startTurn, toggleContest, toggleAgreeToEnd, rollContest, endTurn, toggleBreakage } = useCombatCommands()
  const { holder, inTurn, start, contesting, contest, contenders, roll, end, result, agreed, breakage, breakageBar } = useTurnControls()

  return(
    <div className='flex flex-col gap-0.5'>
      <div className='flex gap-1 items-center'>
        {
          inTurn ?
          <Tooltip text={end ?? 'end the turn; movement and combat surge AP left is lost'}>
            <Button variant='primary' aria-label='endTurn' disabled={end !== null} onClick={endTurn}>end turn</Button>
          </Tooltip> :
          <Tooltip text={start ?? 'start this turn for the active character'}>
            <Button variant='primary' aria-label='startTurn' disabled={start !== null} onClick={startTurn}>start turn</Button>
          </Tooltip>
        }
        {
          holder && !inTurn ?
          <Tooltip text={contesting ? 'stop contesting the turn' : contest ?? `contest ${holder}'s turn`}>
            <Button aria-label='contestTurn' aria-pressed={contesting} active={contesting} disabled={!contesting && contest !== null} onClick={toggleContest}>contest</Button>
          </Tooltip> : null
        }
        {
          contenders ?
          <Tooltip text={roll ?? 'everyone contesting and the holder roll cunning; the highest takes the turn'}>
            <Button aria-label='rollContest' disabled={roll !== null} onClick={rollContest}>roll contest</Button>
          </Tooltip> : null
        }
        <Tooltip text={agreed ? 'agreed to end the round' : 'agree to end the round'}>
          <Button aria-label='agreeToEnd' aria-pressed={agreed} variant={agreed ? 'primary' : 'default'} className={agreed ? 'bg-accent/20' : ''} onClick={toggleAgreeToEnd}>
            {agreed ? <span className='mr-1'>✓</span> : null}end round ok
          </Button>
        </Tooltip>
        <Tooltip text={breakageBar ?? (breakage ? 'equipment breakage is on' : 'equipment breakage is off')}>
          <Button aria-label='breakage' aria-pressed={breakage} active={breakage} disabled={breakageBar !== null} onClick={toggleBreakage}>breakage</Button>
        </Tooltip>
        {holder ? <span className='text-xs text-muted'>{holder}&apos;s turn{contenders ? `, contested by ${contenders}` : ''}</span> : null}
      </div>
      {result ? <span className='text-xs text-muted'>{result}</span> : null}
    </div>
  )
}

// combat.tex "Morale": the round begins with a will test for whoever the fight
// has under stress, made normally, safely or riskily; a miss activates the
// limit stress action, which the table plays out. Whether an enemy is within
// 30 m is the table's to say.
function MoralePanel(){
  const rows = useMorale()
  const { rollMorale } = useCombatCommands()
  const [enemyNear, setEnemyNear] = useState(true)
  if (rows.length === 0) return null

  return(
    <div className='flex flex-col gap-1 py-2 border-b border-line text-sm'>
      <div className='flex flex-row gap-3 items-center'>
        <SectionLabel>Morale</SectionLabel>
        <label className='flex gap-1 items-center text-xs text-muted'>
          <input type='checkbox' aria-label='enemyNear' checked={enemyNear} onChange={(e) => setEnemyNear(e.target.checked)} />
          enemy within 30 m
        </label>
      </div>
      {rows.map((r) => (
        <div key={r.id} className='flex flex-row flex-wrap gap-x-3 gap-y-1 items-center'>
          <span className='font-medium'>{r.name}</span>
          <span className='text-muted'>DL <span className='font-mono text-fg'>{r.DL}</span>{r.aggravators ? ` (${r.aggravators})` : ''}</span>
          {
            !r.result ?
            ROLL_MODES.map((mode) => (
              <Button key={mode} size='xs' aria-label={`morale ${mode} ${r.name}`} onClick={() => rollMorale(r.id, mode, enemyNear)}>{mode}</Button>
            )) :
            <span className='text-xs text-muted'>{r.result}</span>
          }
          {r.limitStress ? <span className='text-xs text-bad border border-bad rounded px-1.5'>limit stress action: {r.limitStress}</span> : null}
          {r.owed ? <span className='text-xs text-muted'>{r.owed}</span> : null}
        </div>
      ))}
    </div>
  )
}

// combat.tex "Social actions": the active character intimidates, taunts or
// rallies whoever the table picks, for 5 AP; it weighs on their morale test
// at the next round's beginning. Negotiating and surrendering cost the same
// and take no one; the table plays out what they come to.
function SocialPanel(){
  const { bar, negotiateBar, insultBar, cowardBar, surrenderBar, unsurrenderBar, surrendered, value, kinds, targets } = useSocial()
  const { say, insult, negotiate, defaultToCoward, surrender, unsurrender } = useCombatCommands()
  const [picked, setPicked] = useState<string[]>([])
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))

  return(
    <div className='flex flex-row flex-wrap gap-x-3 gap-y-1 py-2 border-b border-line text-sm items-center'>
      <SectionLabel>Social</SectionLabel>
      {targets.map((t) => (
        <label key={t.id} className='flex gap-1 items-center text-xs text-muted'>
          <input type='checkbox' aria-label={`social ${t.name}`} checked={picked.includes(t.id)} onChange={() => toggle(t.id)} />
          {t.name}
        </label>
      ))}
      {kinds.map((kind) => (
        <Button key={kind} size='xs' aria-label={`social ${kind}`} disabled={bar !== null || picked.length === 0} title={bar ?? undefined} onClick={() => say(kind, picked)}>{kind} · {value}</Button>
      ))}
      <Button size='xs' aria-label='social negotiate' disabled={negotiateBar !== null} title={negotiateBar ?? undefined} onClick={negotiate}>negotiate</Button>
      {insultBar === null || cowardBar === null ? (
        <>
          <Button size='xs' aria-label='social insult' disabled={insultBar !== null || picked.length === 0} title={insultBar ?? undefined} onClick={() => insult(picked)}>insult</Button>
          <Button size='xs' aria-label='default to coward' disabled={cowardBar !== null} title={cowardBar ?? undefined} onClick={defaultToCoward}>default to coward</Button>
        </>
      ) : null}
      {surrendered
        ? <Button size='xs' aria-label='social unsurrender' disabled={unsurrenderBar !== null} title={unsurrenderBar ?? undefined} onClick={unsurrender}>unsurrender</Button>
        : <Button size='xs' aria-label='social surrender' disabled={surrenderBar !== null} title={surrenderBar ?? undefined} onClick={surrender}>surrender</Button>}
    </div>
  )
}

function SurgeControl(){
  const { endSurge } = useCharacterCommands()
  const { actionSurge } = useCombatCommands()
  const options = useCombatSurgeOptions()
  const binding = useBindingSurge()

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
      {
        binding ?
        <Tooltip text={`give up the ${binding} surge AP left, to do something it does not allow`}>
          <Button aria-label='endSurge' variant='bad' onClick={endSurge}>end surge</Button>
        </Tooltip> : null
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
            {entry.surrendered ? <span className={`ml-1.5 text-[10px] ${entry.isActive ? 'text-accent/80' : 'text-muted'}`}>surrendered</span> : null}
            {entry.role && entry.role !== 'none' ? <span className='ml-1.5 text-[10px] text-muted'>{entry.role}</span> : null}
          </Button>
        )
      }
    </div>
  )
}
