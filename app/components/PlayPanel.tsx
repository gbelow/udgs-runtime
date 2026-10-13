'use client'
import { useState } from 'react'
import { WeaponPanel } from './WeaponPanel';
import { AbilityPanel } from './AbilityPanel';
import { SpellPanel } from './SpellPanel';
import { ActionLog, ActionPanel } from './ActionPanel';
import { BoardPanel } from './BoardPanel';
import { ChasePanel } from './ChasePanel';
import { RoundChangePanel } from './RoundChangePanel';
import { ArmorPanel } from './ArmorPanel';
import { HandsPanel } from './HandsPanel';
import { ContainerPanel } from './ContainerPanel';
import { TradePanel } from './TradePanel';
import { ItemSelector } from './ItemSelector';
import { AbilitySelector } from './AbilitySelector';
import { SpellSelector } from './SpellSelector';
import { CharacterSelector } from './CharacterSelector';
import { AfflictionsPannel, CharacteristicTiles, CursePanel, InjuryDials, KnowledgesPanel, MovementTiles, NotesAndSave, PendingPanel, ResourceTiles, SimpleResource, SkillTiles, SpecificKnowledgesPanel, WoundPanel } from './CharacterSheet';
import { makeDieRoll } from './utils';
import { Button, NumberInput, SectionLabel, Tooltip } from './ui';
import { PartiesView } from './PartiesView';
import { useCombatRoster, useCombatState, useCombatSurgeOptions, useCowardBar, useHeldTests, useRoundChange, useTurnControls } from '../hooks/useCombatState';
import { useChase } from '../hooks/useChase';
import { useInjuryLens } from '../hooks/useinjuryLens';
import { useCharacterCommands } from '../hooks/useCharacterCommands';
import { useCombatCommands } from '../hooks/useCombatCommands';
import { useSustainedPanel } from '../hooks/useSustainedPanel';
import { usePartyCommands } from '../hooks/useParty';
import { useActiveCharacterData, useBindingSurge } from '../hooks/useCharacterData';
import { useRole } from '../hooks/useRole';
import { GearLocked, GmLocked } from './Locks';

// The run screen: the round and who is in it along the top, the middle for
// the scene or whatever catalog the GM opened, the active character's sheet
// on the right, and along the bottom what they have, what they can do and
// what just happened. Everything the GM has that a player does not opens
// from the GM drawer.
export function PlayPanel(){
  const { hasActiveCharacter, hasBoard } = useCombatState()
  const [opened, setOpened] = useState<CatalogView[]>([])
  const [center, setCenter] = useState<CenterView>('scene')
  const views: CenterView[] = ['scene', ...(hasBoard ? ['parties' as const] : []), ...opened]
  const shown = views.includes(center) ? center : 'scene'
  const open = (v: CatalogView) => { setOpened((o) => (o.includes(v) ? o : [...o, v])); setCenter(v) }
  const close = (v: CatalogView) => { setOpened((o) => o.filter((x) => x !== v)); if (center === v) setCenter('scene') }

  return(
    <div className='flex flex-col md:h-[calc(100vh-3rem)] text-left text-sm'>
      <Tracker />
      <div className='flex flex-col md:flex-row flex-1 min-h-0'>
        <section className='flex-1 min-w-0 min-h-0 p-2 flex flex-col gap-2'>
          {views.length > 1 ? (
            <div className='flex flex-row flex-wrap gap-1 items-center'>
              {views.map((v) => (
                <span key={v} className='inline-flex items-center'>
                  <Button size='xs' aria-label={`view ${v}`} variant={v === shown ? 'primary' : 'default'} className={v === shown ? 'bg-accent/15' : ''} onClick={() => setCenter(v)}>{v}</Button>
                  {isCatalogView(v) ? <Button size='xs' variant='ghost' aria-label={`close ${v}`} title={`close the ${v} catalog`} onClick={() => close(v)}>×</Button> : null}
                </span>
              ))}
            </div>
          ) : null}
          <div className='flex-1 min-h-0 overflow-y-auto flex flex-col'>
            <CenterSpace view={shown} />
          </div>
        </section>
        {hasActiveCharacter ? (
          <aside className='md:w-[32rem] shrink-0 p-2 border-t md:border-t-0 md:border-l border-line min-h-0 overflow-y-auto'>
            <SheetTabs />
          </aside>
        ) : null}
      </div>
      <div className='grid grid-cols-1 md:grid-cols-12 border-t border-line shrink-0 md:h-[30vh]'>
        <div className='md:col-span-3 p-2 flex flex-col gap-2 overflow-y-auto border-b md:border-b-0 md:border-r border-line'>
          {hasActiveCharacter ? <Status /> : <span className='text-xs text-muted'>pick a character in the tracker</span>}
        </div>
        <div className='md:col-span-5 p-2 flex flex-col gap-2 overflow-y-auto border-b md:border-b-0 md:border-r border-line'>
          <ActionColumn open={open} hasActiveCharacter={hasActiveCharacter} />
        </div>
        <div className='md:col-span-4 p-2 flex flex-col gap-1 min-h-0'>
          <SectionLabel>Log</SectionLabel>
          <div className='flex-1 min-h-0 overflow-y-auto'><ActionLog /></div>
        </div>
      </div>
    </div>
  )
}

const CATALOG_VIEWS = ['items', 'abilities', 'spells', 'characters'] as const
type CatalogView = typeof CATALOG_VIEWS[number]
type CenterView = 'scene' | 'parties' | CatalogView

function isCatalogView(v: CenterView): v is CatalogView {
  return (CATALOG_VIEWS as readonly string[]).includes(v)
}

// The middle of the screen: the scene, the parties beside a board, or a
// catalog laid out across the whole width, giving to the sheet on the right.
function CenterSpace({ view }: { view: CenterView }){
  if (view === 'parties') return <PartiesView />
  if (view === 'items') return <ItemSelector wide />
  if (view === 'abilities') return <AbilitySelector wide />
  if (view === 'spells') return <SpellSelector wide />
  if (view === 'characters') return <div className='max-w-md'><CharacterSelector /></div>
  return <SceneSpace />
}

// The round and who is in it, kept to a strip so the middle has the height.
function Tracker(){
  const [settings, setSettings] = useState(false)
  return(
    <div className='flex flex-col border-b border-line shrink-0'>
      <div className='flex flex-row flex-wrap gap-x-4 gap-y-1 items-center px-2 py-1.5'>
        <FightControls settings={settings} toggleSettings={() => setSettings(!settings)} />
        <CharacterList />
      </div>
      {settings ? <FightSettings /> : null}
    </div>
  )
}

function FightControls({ settings, toggleSettings }: { settings: boolean, toggleSettings: () => void }){
  const { nextRound, resetCombat } = useCombatCommands()
  const { returnFromFight } = usePartyCommands()
  const { round, nextRoundBar, returnBar } = useCombatState()
  const [etsTaken, setEtsTaken] = useState(0)

  return(
    <div className='flex flex-row gap-2 items-center'>
      <span className='text-xs text-muted whitespace-nowrap'>Round <span className='font-mono text-fg'>{round}</span></span>
      <Button aria-label='nextRound' disabled={nextRoundBar !== null} title={nextRoundBar ?? undefined} onClick={nextRound}>{round === 0 ? 'start combat' : 'next round'}</Button>
      <Button aria-label='endCombat' disabled={returnBar !== null} title={returnBar ?? 'everyone back to the party'} onClick={() => { returnFromFight(etsTaken); setEtsTaken(0) }}>{round > 0 ? 'end combat' : 'back to party'}</Button>
      <span className='text-xs text-muted whitespace-nowrap'>ETs taken</span>
      <NumberInput className='w-10' aria-label='ETs taken' value={etsTaken} onChange={(e) => setEtsTaken(parseInt(e.target.value) || 0)} />
      <Button aria-label='resetGame' variant='ghost' onClick={resetCombat}>reset</Button>
      <Button aria-label='fight settings' aria-pressed={settings} variant={settings ? 'primary' : 'ghost'} className={settings ? 'bg-accent/15' : ''} title='how the table plays this fight' onClick={toggleSettings}>⚙</Button>
    </div>
  )
}

// How the table plays this fight, apart from anything a character does.
function FightSettings(){
  const { toggleBreakage } = useCombatCommands()
  const { breakage, breakageBar } = useTurnControls()

  return(
    <div className='flex flex-row flex-wrap gap-2 items-center px-2 py-1.5 border-t border-line'>
      <SectionLabel>Settings</SectionLabel>
      <Tooltip text={breakageBar ?? (breakage ? 'gear can break: turn it off' : 'gear never breaks: turn it on')}>
        <Button size='xs' aria-label='breakage' aria-pressed={breakage} active={breakage} disabled={breakageBar !== null} onClick={toggleBreakage}>
          equipment breakage: {breakage ? 'on' : 'off'}
        </Button>
      </Tooltip>
    </div>
  )
}

// What the scene is played on: the round change while it runs, the chase's
// chain while there is a chase, the board otherwise.
function SceneSpace(){
  const chase = useChase([], 'combat')
  const { view } = useRoundChange()
  if (view) return <RoundChangePanel />
  if (chase.chasing) return <ChasePanel />
  return <BoardPanel />
}

const SHEET_TABS = ['sheet', 'knowledge', 'inventory', 'gear', 'abilities', 'spells', 'body'] as const
type SheetTab = typeof SHEET_TABS[number]

// The inventory holds what an item is taken into — the hands, the worn
// armor, the containers, the trade — so it stays short beside a catalog;
// what the gear does in a fight is under gear.
function SheetTabs(){
  const [tab, setTab] = useState<SheetTab>('inventory')
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
      {tab === 'inventory' ? <GearLocked><HandsPanel /><ArmorPanel tiers={false} /><ContainerPanel /><TradePanel /></GearLocked> : null}
      {tab === 'gear' ? <GearLocked><WeaponPanel /><ArmorPanel /></GearLocked> : null}
      {tab === 'abilities' ? <AbilityPanel /> : null}
      {tab === 'spells' ? <><SustainedPanel /><SpellPanel /></> : null}
      {tab === 'body' ? <GmLocked><WoundPanel /><CursePanel /></GmLocked> : null}
    </div>
  )
}

// What the active character has to spend and what weighs on them; the
// resources, the injuries and the afflictions are the GM's to edit, and the
// pending tests the character's to roll.
function Status(){
  const { killCharacter } = useCombatCommands()
  const { isCharacterDead } = useInjuryLens()
  const { hasOpenAction } = useCombatState()

  return(
    <>
      <GmLocked>
        <ResourceTiles><SimpleResource rssName={'AP'} /></ResourceTiles>
        <InjuryDials action={<Button variant='bad' active={isCharacterDead} disabled={hasOpenAction} title={hasOpenAction ? 'an action is being played out' : undefined} className={isCharacterDead ? 'bg-bad/20' : ''} onClick={killCharacter}>{isCharacterDead ? 'dead' : 'kill'}</Button>} />
        <AfflictionsPannel />
      </GmLocked>
      <PendingPanel />
    </>
  )
}

// Who acts from the bar: the active character, held to their turn, or — for
// the GM and the developer — the GM, whose actions take the place of the
// character's and who edits anyone's sheet and gear at any time.
function ActionColumn({ open, hasActiveCharacter }: { open: (v: CatalogView) => void, hasActiveCharacter: boolean }){
  const [dice10, setDice10] = useState(1)
  const [dice6, setDice6] = useState(1)
  const { gmTools, gm, setGmMode } = useRole()

  return(
    <>
      <div className='flex flex-row flex-wrap gap-1 items-center'>
        {gmTools ? <>
          <Button size='xs' aria-label='act as character' aria-pressed={!gm} variant={gm ? 'default' : 'primary'} className={gm ? '' : 'bg-accent/15'} onClick={() => setGmMode(false)}>character</Button>
          <Button size='xs' aria-label='act as GM' aria-pressed={gm} variant={gm ? 'primary' : 'default'} className={gm ? 'bg-accent/15' : ''} onClick={() => setGmMode(true)}>GM</Button>
        </> : null}
        <span className='ml-auto flex flex-row gap-1'>
          <Button size='xs' aria-label='roll' onClick={() => setDice10(makeDieRoll(10))}>d10 <span className='font-mono text-fg'>{dice10}</span></Button>
          <Button size='xs' aria-label='roll' onClick={() => setDice6(makeDieRoll(6))}>d6 <span className='font-mono text-fg'>{dice6}</span></Button>
        </span>
      </div>
      {gm ? <GmToolsPanel open={open} />
        : hasActiveCharacter ? <ActionBar />
        : <span className='text-xs text-muted'>pick a character in the tracker</span>}
    </>
  )
}

// The turn, the surges and the actions; the tests held for the round wait
// behind their own button until wanted, lit while one is owed. Morale and
// starting a chase belong to the round change.
function ActionBar(){
  const [heldOpen, setHeldOpen] = useState(false)
  const held = useHeldTests()
  const due = held.some((r) => !r.result)

  return(
    <>
      <TurnControl />
      <div className='flex flex-row flex-wrap gap-1 items-center'>
        <SectionLabel>surge</SectionLabel>
        <SurgeControl />
      </div>
      {held.length > 0 ? (
        <div className='flex flex-row flex-wrap gap-1 items-center'>
          <Button size='xs' aria-label='drawer held tests' variant={heldOpen ? 'primary' : due ? 'bad' : 'default'} className={heldOpen ? 'bg-accent/15' : ''} onClick={() => setHeldOpen(!heldOpen)}>
            held tests{due ? ' !' : ''}
          </Button>
        </div>
      ) : null}
      {heldOpen ? <HeldTestsPanel /> : null}
      <ActionPanel />
    </>
  )
}

// What the GM has that a player does not, in one place: the catalogs, opened
// in the middle of the screen, and what the GM does to the scene that no
// character does, each starting a declaration aimed on the board or the
// roster like a character's action.
const GM_TOOLS = [
  { label: 'explosion', title: 'an explosion where the GM aims it' },
  { label: 'effect', title: 'an effect on the characters the GM picks' },
  { label: 'test', title: 'a test the GM asks of the characters picked, rolled from held tests' },
  { label: 'triggers', title: "fire one of the scene's triggers" },
] as const

function GmToolsPanel({ open }: { open: (v: CatalogView) => void }){
  const cowardBar = useCowardBar()
  const { defaultToCoward } = useCombatCommands()

  return(
    <div className='flex flex-col gap-1'>
      <div className='flex flex-row flex-wrap gap-1 items-center'>
        <SectionLabel>catalog</SectionLabel>
        {CATALOG_VIEWS.map((v) => <Button key={v} size='xs' aria-label={`open ${v}`} onClick={() => open(v)}>{v}</Button>)}
      </div>
      <div className='flex flex-row flex-wrap gap-1 items-center'>
        <SectionLabel>scene</SectionLabel>
        {GM_TOOLS.map((t) => (
          <Tooltip key={t.label} text={`${t.title} — not built yet`}>
            <Button size='xs' aria-label={`gm ${t.label}`} disabled>{t.label}</Button>
          </Tooltip>
        ))}
        <Tooltip text={cowardBar ?? 'nobody for the active character to insult or negotiate with: they default to coward'}>
          <Button size='xs' aria-label='default to coward' disabled={cowardBar !== null} onClick={defaultToCoward}>default to coward</Button>
        </Tooltip>
      </div>
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

// Everyone in the fight as a strip of chips by party: a click picks the
// active character, or aims the open action at a target.
function CharacterList(){
  const { parties, pick } = useCombatRoster()

  return(
    <div className='flex flex-row flex-wrap gap-x-3 gap-y-1 items-center'>
      {
        parties.map((party) =>
          <div key={party.id} className='flex flex-row flex-wrap gap-1 items-center'>
            {party.name ? <span className='text-[10px] text-muted whitespace-nowrap'>{party.name}</span> : null}
            {party.entries.map((entry) =>
              <Button key={entry.id} size='xs' aria-label={entry.name}
                variant={entry.targetable ? 'bad' : entry.isActive ? 'primary' : 'default'}
                className={entry.targetable ? 'animate-pulse' : entry.isActive ? 'bg-accent/15' : ''}
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
