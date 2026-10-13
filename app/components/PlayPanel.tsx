'use client'
import { useState } from 'react'
import { WeaponPanel } from './WeaponPanel';
import { AbilityPanel } from './AbilityPanel';
import { SpellPanel } from './SpellPanel';
import { ActionLog, ActionPanel } from './ActionPanel';
import { BoardPanel } from './BoardPanel';
import { ChasePanel, ChaseSetup } from './ChasePanel';
import { ArmorPanel } from './ArmorPanel';
import { HandsPanel } from './HandsPanel';
import { ContainerPanel } from './ContainerPanel';
import { TradePanel } from './TradePanel';
import { Sidebar } from './Sidebar';
import { AfflictionsPannel, CharacteristicTiles, CursePanel, InjuryDials, KnowledgesPanel, MovementTiles, NotesAndSave, PendingPanel, ResourceTiles, SimpleResource, SkillTiles, SpecificKnowledgesPanel, WoundPanel } from './CharacterSheet';
import { makeDieRoll } from './utils';
import { Button, NumberInput, SectionLabel, TextInput, Tooltip, selectClass } from './ui';
import { useCombatRoster, useCombatState, usePartyPicker, useCombatSurgeOptions, useHeldTests, useMorale, useSocial, useTablePressure, useTurnControls } from '../hooks/useCombatState';
import { useChase } from '../hooks/useChase';
import { ROLL_MODES } from '../domain/play/dice';
import { useInjuryLens } from '../hooks/useinjuryLens';
import { useCharacterCommands } from '../hooks/useCharacterCommands';
import { useCombatCommands } from '../hooks/useCombatCommands';
import { useSustainedPanel } from '../hooks/useSustainedPanel';
import { usePartyCommands } from '../hooks/useParty';
import { useActiveCharacterData, useBindingSurge } from '../hooks/useCharacterData';

// The run screen: the fight and the catalog on the left, the space the scene
// is played in at the middle, the active character's sheet on the right, and
// along the bottom what they have, what they can do and what just happened.
export function PlayPanel(){
  const { hasActiveCharacter } = useCombatState()

  return(
    <div className='flex flex-col md:h-[calc(100vh-3rem)] text-left text-sm'>
      <div className='flex flex-col md:flex-row flex-1 min-h-0'>
        <aside className='md:w-64 shrink-0 flex flex-col gap-2 p-2 border-b md:border-b-0 md:border-r border-line min-h-0 overflow-y-auto'>
          <FightControls />
          <FightSettings />
          <CharacterList />
          {hasActiveCharacter ? <PartyControl /> : null}
          <div className='border-t border-line pt-2'><Sidebar /></div>
        </aside>
        <section className='flex-1 min-w-0 min-h-0 p-2 overflow-y-auto flex flex-col gap-2'>
          <SceneSpace />
        </section>
        {hasActiveCharacter ? (
          <aside className='md:w-[28rem] shrink-0 p-2 border-t md:border-t-0 md:border-l border-line min-h-0 overflow-y-auto'>
            <SheetTabs />
          </aside>
        ) : null}
      </div>
      {hasActiveCharacter ? (
        <div className='grid grid-cols-1 md:grid-cols-12 border-t border-line shrink-0 md:h-[30vh]'>
          <div className='md:col-span-3 p-2 flex flex-col gap-2 overflow-y-auto border-b md:border-b-0 md:border-r border-line'>
            <Status />
          </div>
          <div className='md:col-span-5 p-2 flex flex-col gap-2 overflow-y-auto border-b md:border-b-0 md:border-r border-line'>
            <ActionBar />
          </div>
          <div className='md:col-span-4 p-2 flex flex-col gap-1 min-h-0'>
            <SectionLabel>Log</SectionLabel>
            <div className='flex-1 min-h-0 overflow-y-auto'><ActionLog /></div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function FightControls(){
  const { nextRound, resetCombat } = useCombatCommands()
  const { returnFromFight } = usePartyCommands()
  const { round, nextRoundBar, returnBar } = useCombatState()
  const [etsTaken, setEtsTaken] = useState(0)

  return(
    <div className='flex flex-col gap-1.5'>
      <div className='flex flex-row gap-2 items-center'>
        <span className='text-xs text-muted'>Round <span className='font-mono text-fg'>{round}</span></span>
        <Button aria-label='nextRound' disabled={nextRoundBar !== null} title={nextRoundBar ?? undefined} onClick={nextRound}>{round === 0 ? 'start combat' : 'next round'}</Button>
        <Button aria-label='resetGame' variant='ghost' className='ml-auto' onClick={resetCombat}>reset</Button>
      </div>
      <div className='flex flex-row gap-2 items-center'>
        <Button aria-label='endCombat' disabled={returnBar !== null} title={returnBar ?? 'everyone back to the party'} onClick={() => { returnFromFight(etsTaken); setEtsTaken(0) }}>{round > 0 ? 'end combat' : 'back to party'}</Button>
        <span className='text-xs text-muted'>ETs taken</span>
        <NumberInput className='w-10' aria-label='ETs taken' value={etsTaken} onChange={(e) => setEtsTaken(parseInt(e.target.value) || 0)} />
      </div>
    </div>
  )
}

// How the table plays this fight, apart from anything a character does.
function FightSettings(){
  const { toggleBreakage } = useCombatCommands()
  const { breakage, breakageBar } = useTurnControls()

  return(
    <div className='flex flex-col gap-1 border-t border-line pt-2'>
      <SectionLabel>Settings</SectionLabel>
      <Tooltip text={breakageBar ?? (breakage ? 'gear can break: turn it off' : 'gear never breaks: turn it on')}>
        <Button size='xs' aria-label='breakage' aria-pressed={breakage} active={breakage} disabled={breakageBar !== null} onClick={toggleBreakage}>
          equipment breakage: {breakage ? 'on' : 'off'}
        </Button>
      </Tooltip>
    </div>
  )
}

// What the scene is played on: the chase's chain while there is a chase, the
// board otherwise.
function SceneSpace(){
  const chase = useChase([], 'combat')
  if (chase.chasing) return <ChasePanel />
  return <BoardPanel />
}

const SHEET_TABS = ['sheet', 'knowledge', 'gear', 'abilities', 'spells', 'body'] as const
type SheetTab = typeof SHEET_TABS[number]

function SheetTabs(){
  const [tab, setTab] = useState<SheetTab>('gear')
  const { fightName } = useActiveCharacterData()

  return(
    <div className='flex flex-col gap-2'>
      <span className='text-base font-medium'>{fightName}</span>
      <div className='flex flex-row flex-wrap gap-1'>
        {SHEET_TABS.map((t) =>
          <Button key={t} size='xs' aria-label={`sheet ${t}`} variant={t === tab ? 'primary' : 'default'} className={t === tab ? 'bg-accent/15' : ''} onClick={() => setTab(t)}>{t}</Button>)}
      </div>
      {tab === 'sheet' ? <><MovementTiles /><CharacteristicTiles /><SkillTiles /><NotesAndSave /></> : null}
      {tab === 'knowledge' ? <><KnowledgesPanel /><SpecificKnowledgesPanel /></> : null}
      {tab === 'gear' ? <><HandsPanel /><WeaponPanel /><ArmorPanel /><ContainerPanel /><TradePanel /></> : null}
      {tab === 'abilities' ? <AbilityPanel /> : null}
      {tab === 'spells' ? <><SustainedPanel /><SpellPanel /></> : null}
      {tab === 'body' ? <><WoundPanel /><CursePanel /></> : null}
    </div>
  )
}

// What the active character has to spend and what weighs on them.
function Status(){
  const { killCharacter } = useCombatCommands()
  const { isCharacterDead } = useInjuryLens()
  const { hasOpenAction } = useCombatState()

  return(
    <>
      <ResourceTiles><SimpleResource rssName={'AP'} /></ResourceTiles>
      <InjuryDials action={<Button variant='bad' active={isCharacterDead} disabled={hasOpenAction} title={hasOpenAction ? 'an action is being played out' : undefined} className={isCharacterDead ? 'bg-bad/20' : ''} onClick={killCharacter}>{isCharacterDead ? 'dead' : 'kill'}</Button>} />
      <PendingPanel />
      <AfflictionsPannel />
    </>
  )
}

const DRAWERS = ['social', 'chase', 'morale', 'held tests'] as const
type Drawer = typeof DRAWERS[number]

// The turn, the surges and the actions; what the whole scene can do —
// talking, running away, morale and the tests held for the round — waits
// behind its own button until it is wanted, lit while something is owed.
function ActionBar(){
  const [dice10, setDice10] = useState(1)
  const [dice6, setDice6] = useState(1)
  const [drawer, setDrawer] = useState<Drawer | null>(null)
  const morale = useMorale()
  const held = useHeldTests()
  const chase = useChase([], 'combat')
  const due: Record<Drawer, boolean> = {
    social: false,
    chase: false,
    morale: morale.some((r) => !r.result),
    'held tests': held.some((r) => !r.result),
  }
  const shown: Record<Drawer, boolean> = {
    social: true,
    chase: !chase.chasing,
    morale: true,
    'held tests': held.length > 0,
  }

  return(
    <>
      <TurnControl />
      <div className='flex flex-row flex-wrap gap-1 items-center'>
        <SectionLabel>surge</SectionLabel>
        <SurgeControl />
      </div>
      <div className='flex flex-row flex-wrap gap-1 items-center'>
        {DRAWERS.filter((d) => shown[d]).map((d) =>
          <Button key={d} size='xs' aria-label={`drawer ${d}`} variant={drawer === d ? 'primary' : due[d] ? 'bad' : 'default'} className={drawer === d ? 'bg-accent/15' : ''} onClick={() => setDrawer(drawer === d ? null : d)}>
            {d}{due[d] ? ' !' : ''}
          </Button>)}
        <span className='ml-auto flex flex-row gap-1'>
          <Button size='xs' aria-label='roll' onClick={() => setDice10(makeDieRoll(10))}>d10 <span className='font-mono text-fg'>{dice10}</span></Button>
          <Button size='xs' aria-label='roll' onClick={() => setDice6(makeDieRoll(6))}>d6 <span className='font-mono text-fg'>{dice6}</span></Button>
        </span>
      </div>
      {drawer === 'social' ? <SocialPanel /> : null}
      {drawer === 'chase' ? <ChaseSetup /> : null}
      {drawer === 'morale' ? <MoralePanel /> : null}
      {drawer === 'held tests' ? <HeldTestsPanel /> : null}
      <ActionPanel />
    </>
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

// play.tex "Combat": a turn is started by whoever asks first, and can be
// contested before its holder declares anything — by as many as ask, all
// rolling cunning at once.
function TurnControl(){
  const { startTurn, toggleContest, toggleAgreeToEnd, rollContest, endTurn } = useCombatCommands()
  const { holder, inTurn, start, contesting, contest, contenders, roll, end, result, agreed, stealth } = useTurnControls()

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
        {holder ? <span className='text-xs text-muted'>{holder}&apos;s turn{contenders ? `, contested by ${contenders}` : ''}</span> : null}
      </div>
      {result ? <span className='text-xs text-muted'>{result}</span> : null}
      {stealth ? <span className='text-xs text-muted'>{stealth}</span> : null}
    </div>
  )
}

// combat.tex "Morale": the round begins with a will test for whoever the fight
// has under stress, made normally, safely or riskily; a miss activates the
// limit stress action, which the table plays out. Whether an enemy is within
// 30 m is the table's to say, and so is the pressure the fight puts on each
// fighter, set ahead of the round it weighs on.
function MoralePanel(){
  const rows = useMorale()
  const pressure = useTablePressure()
  const { rollMorale, setTablePressure } = useCombatCommands()
  const [enemyNear, setEnemyNear] = useState(true)
  if (pressure.length === 0) return null

  return(
    <div className='flex flex-col gap-1 py-2 border-b border-line text-sm'>
      <div className='flex flex-row gap-3 items-center'>
        <SectionLabel>Morale</SectionLabel>
        <label className='flex gap-1 items-center text-xs text-muted'>
          <input type='checkbox' aria-label='enemyNear' checked={enemyNear} onChange={(e) => setEnemyNear(e.target.checked)} />
          enemy within 30 m
        </label>
      </div>
      <div className='flex flex-row flex-wrap gap-x-3 gap-y-1 items-center text-xs text-muted'>
        <span>pressure</span>
        {pressure.map((r) => (
          <label key={r.id} className='flex gap-1 items-center'>
            {r.name}
            <NumberInput className='w-10' aria-label={`pressure ${r.name}`} value={r.value} onChange={(e) => setTablePressure(r.id, parseInt(e.target.value) || 0)} />
          </label>
        ))}
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

// combat.tex "Swimming": the round begins with a swimming test for whoever
// stands in water; its score then stands against every water the round has
// them swim in.
function HeldTestsPanel(){
  const rows = useHeldTests()
  const { rollHeld } = useCombatCommands()
  if (rows.length === 0) return null

  return(
    <div className='flex flex-col gap-1 py-2 border-b border-line text-sm'>
      <SectionLabel>Held tests</SectionLabel>
      {rows.map((r) => (
        <div key={`${r.id}:${r.kind}`} className='flex flex-row flex-wrap gap-x-3 gap-y-1 items-center'>
          <span className='font-medium'>{r.name}</span>
          <span className='text-muted'>{r.kind}{r.DL !== null && <> DL <span className='font-mono text-fg'>{r.DL}</span></>}</span>
          {
            !r.result ?
            r.modes.map((mode) => (
              <Button key={mode} size='xs' aria-label={`${r.kind} ${mode} ${r.name}`} onClick={() => rollHeld(r.id, r.kind, mode)}>{mode}</Button>
            )) :
            <span className='text-xs text-muted'>{r.result}</span>
          }
        </div>
      ))}
    </div>
  )
}

// combat.tex "Social actions": the active character intimidates, taunts or
// rallies, for 5 AP: with nobody picked, intimidation goes to every enemy and
// rally to the party; picking characters says it to them instead. It weighs
// on their morale test at the next round's beginning. Negotiating and surrendering cost the same
// and take no one; the table plays out what they come to.
function SocialPanel(){
  const { bar, negotiateBar, insultBar, cowardBar, surrenderBar, unsurrenderBar, surrendered, value, kinds, insultAtDefault, targets } = useSocial()
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
      {kinds.map(({ kind, atDefault }) => (
        <Button key={kind} size='xs' aria-label={`social ${kind}`} disabled={bar !== null || (picked.length === 0 && !atDefault)} title={bar ?? undefined} onClick={() => say(kind, picked)}>{kind} · {value}</Button>
      ))}
      <Button size='xs' aria-label='social negotiate' disabled={negotiateBar !== null} title={negotiateBar ?? undefined} onClick={negotiate}>negotiate</Button>
      {insultBar === null || cowardBar === null ? (
        <>
          <Button size='xs' aria-label='social insult' disabled={insultBar !== null || (picked.length === 0 && !insultAtDefault)} title={insultBar ?? undefined} onClick={() => insult(picked)}>insult</Button>
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

// Who is in which party of the fight: inherited from the campaign, changed by
// the table before and during the fight, and handed back when it ends.
function PartyControl(){
  const picker = usePartyPicker()
  const { moveToParty, splitOff, renameParty } = useCombatCommands()
  if (!picker) return null

  return(
    <div className='flex gap-1 items-center text-xs'>
      <select className={selectClass} aria-label='party' value={picker.partyId} disabled={picker.bar !== null} title={picker.bar ?? 'the party this character is in'} onChange={(e) => moveToParty(e.target.value)}>
        {picker.parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      <TextInput key={picker.partyId} className='w-24 text-xs' aria-label='party name' defaultValue={picker.name} onBlur={(e) => renameParty(picker.partyId, e.target.value.trim())} />
      <Button size='xs' aria-label='new party' disabled={picker.bar !== null} title={picker.bar ?? 'a new party with only this character in it'} onClick={splitOff}>new party</Button>
    </div>
  )
}

function CharacterList(){
  const { parties, pick } = useCombatRoster()

  return(
    <div className='flex flex-col gap-2'>
      {
        parties.map((party) =>
          <div key={party.id} className='flex flex-col gap-1 items-stretch'>
            {party.name ? <span className='text-[10px] text-muted whitespace-nowrap'>{party.name}</span> : null}
            {party.entries.map((entry) =>
              <Button key={entry.id} aria-label={entry.name}
                variant={entry.targetable ? 'bad' : entry.isActive ? 'primary' : 'default'}
                className={`text-left ${entry.targetable ? 'animate-pulse' : entry.isActive ? 'bg-accent/15' : ''}`}
                onClick={() => pick(entry)}>
                {entry.name}
                {entry.usedSurge ? <span className={`ml-1.5 text-[10px] ${entry.isActive ? 'text-accent/80' : 'text-muted'}`}>✓ {entry.usedSurge}</span> : null}
                {entry.surrendered ? <span className={`ml-1.5 text-[10px] ${entry.isActive ? 'text-accent/80' : 'text-muted'}`}>surrendered</span> : null}
                {entry.holding ? <span className={`ml-1.5 text-[10px] ${entry.isActive ? 'text-accent/80' : 'text-muted'}`}>holding {entry.holding.label} ({entry.holding.AP} AP)</span> : null}
                {entry.role && entry.role !== 'none' ? <span className='ml-1.5 text-[10px] text-muted'>{entry.role}</span> : null}
              </Button>
            )}
          </div>
        )
      }
    </div>
  )
}
