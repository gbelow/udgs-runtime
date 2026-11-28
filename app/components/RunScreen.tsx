'use client'
import { useEffect, useState, type ReactNode } from 'react'
import dynamic from 'next/dynamic'
import { WeaponPanel } from './WeaponPanel';
import { AbilityPanel } from './AbilityPanel';
import { SpellPanel } from './SpellPanel';
import { ActionLog, SaveLogButton } from './ActionPanel';
import { FightReportButton } from './FightReport';
import { ArmorPanel } from './ArmorPanel';
import { HandsPanel } from './HandsPanel';
import { ContainerPanel } from './ContainerPanel';
import { TradePanel } from './TradePanel';
import { ItemSelector } from './ItemSelector';
import { AbilitySelector } from './AbilitySelector';
import { SpellSelector } from './SpellSelector';
import { ActiveConditions,AfflictionsPannel,CharacteristicTiles, CursePanel, InjuryDials, KnowledgesPanel, MovementTiles, NotesAndSave, PendingPanel, ResourceBars, ResourceTiles, SkillTiles, SpecificKnowledgesPanel, WoundPanel } from './CharacterSheet';
import { TableParties } from './TableParties';
import { TableLink, TableWait, ViewAs } from './RunParts';
import { useTableWaiting } from '../hooks/useTable';
import { CharacterExtras, KillButton, SceneSpace, SceneStrip, SurgeTile, SustainedPanel } from './ScenePanel';
import { ActAs } from './ActAs';
import { DockBox, ScreenCorner, SheetWindow } from './Docks';
import { useSheetWindow } from '../hooks/useSheetWindow';
import { ExplorationSection, ExplorationStrip, LastEtLog, PartyCards } from './ExplorationPanel';
import { DowntimeActions, DowntimeRoster, DowntimeStrip, LastDaysLog } from './DowntimePanel';
import { RecentJournal } from './Journal';
import { FacesColumn } from './FocusBar';
import { BoardGmTools } from './BoardPanel';
import { useBoardTools } from '../hooks/useBoard';
import { Backpack, BookOpen, HeartPulse, ScrollText, Sparkles, Sword, WandSparkles, X, type LucideIcon } from 'lucide-react'
import { IconButton, SectionLabel, Segment, Segmented } from './ui';
import { ControlLocked, GearLocked, GmLocked } from './Locks';
import { useGameTab } from '../hooks/useGameTab';
import { useFighterCount } from '../hooks/useCombatState';
import { useActiveCharacterData, useHasActiveCharacter } from '../hooks/useCharacterData';
import { ActiveFace } from './ActiveFace'
import { useActiveFace } from '../hooks/useCombatState'
import { useRole } from '../hooks/useRole';
import { useActiveControlBar } from '../hooks/useControl';
import { useTray } from '../hooks/useTray';
import { useSceneAutoThrow } from '../hooks/useSceneDice';
import { useFollowTurn } from '../hooks/useFollowTurn';
import { useETAutoThrow } from '../hooks/useParty';
import { useDowntimeAutoThrow } from '../hooks/useDowntime';
import type { RunTab } from '../stores/useAppStore';

// What a player of a mode has along the bottom, at any table: the run screen's
// and the demo's.
export type PlayerSlots = {
  status: {
    // what the active character spends beside the tiles every mode has
    resource?: ReactNode
    // what sits beside the stamina tile
    resourceEnd?: ReactNode
    // whether exhaustion, hunger and thirst show among the tiles
    needs: boolean
    // whether AP, STA and IL show as bars, with what sits beside the stamina under them
    bars?: boolean
    // what the active character presses beside their state
    extra?: ReactNode
  }
  // what is pressed for no one character, beside who acts
  buttons?: ReactNode
  // what the active character can do, which says so itself where nobody is
  // picked; a mode with none has the bottom as its state and its log alone
  actions?: ReactNode
  log: { label: string, node: ReactNode, action?: ReactNode }
}

type Mode = PlayerSlots & {
  // what moves time and who is in play, along the top
  strip: ReactNode
  // who is in play, in a popover over the middle
  parties: ReactNode
  // the mode's own space in the middle
  space: ReactNode
  // who is in play, a face each, down the left of the middle
  faces?: ReactNode
  // the GM's tools for the mode, a tab beside the catalogs
  gm?: ReactNode
  // the GM's button beside the active character's injuries
  injuryAction?: ReactNode
  log: { action?: ReactNode }
}

// The fight's slots for a player of it.
export const FIGHT_SLOTS: PlayerSlots = {
  status: { resourceEnd: <SurgeTile wide />, needs: false, bars: true, extra: <CharacterExtras /> },
  log: { label: 'Log', node: <ActionLog />, action: <FightReportButton /> },
}

const MODES: Record<RunTab, Mode> = {
  scene: {
    strip: <SceneStrip />,
    parties: <TableParties />,
    space: <SceneSpace />,
    faces: <FacesColumn />,
    gm: <><ViewAs /><BoardGmTools /></>,
    ...FIGHT_SLOTS,
    injuryAction: <KillButton />,
    log: { ...FIGHT_SLOTS.log, action: <div className='flex flex-row gap-1'><FightReportButton /><SaveLogButton /></div> },
  },
  exploration: {
    strip: <ExplorationStrip />,
    parties: <TableParties sequence='exploration' />,
    space: <PartyCards />,
    status: { needs: true },
    actions: <Picked><ControlLocked><ExplorationSection /></ControlLocked></Picked>,
    log: { label: 'Last ET', node: <div className='flex flex-col gap-2'><LastEtLog /><RecentJournal /></div> },
  },
  downtime: {
    strip: <DowntimeStrip />,
    parties: <TableParties sequence='downtime' />,
    space: <DowntimeRoster />,
    status: { needs: true },
    actions: <Picked><ControlLocked><DowntimeActions /></ControlLocked></Picked>,
    log: { label: 'Last days', node: <div className='flex flex-col gap-2'><LastDaysLog /><RecentJournal /></div> },
  },
}

const CATALOGS = {
  items: <ItemSelector wide />,
  abilities: <AbilitySelector wide />,
  spells: <SpellSelector wide />,
}
type CatalogView = keyof typeof CATALOGS
type OverlayView = 'parties' | CatalogView | 'GM'
const OVERLAYS = ['parties', ...Object.keys(CATALOGS) as CatalogView[], 'GM'] as const satisfies readonly OverlayView[]
const isCatalog = (v: OverlayView): v is CatalogView => v in CATALOGS

const PICK = <span className='text-xs text-muted'>pick a character</span>

function Picked({ children }: { children: ReactNode }){
  return useHasActiveCharacter() ? children : PICK
}

const DiceTray = dynamic(() => import('./DiceTray'), { ssr: false })

// The run screen, in one of its modes, one per sequence that moves time: the
// scene, exploration and downtime. Each lays out the same way — what moves
// time and who is in play along the top, the middle for the mode's own space
// or whatever catalog the GM opened, the active character's sheet on the
// right, and along the bottom what they have, what they can do and what just
// happened. Everything the GM has that a player does not opens from the GM
// drawer. The catalogs opened stay open from one mode to the next, and the
// middle falls back to the mode's first view when the one shown is not the
// mode's.
export function RunScreen(){
  const { tab } = useGameTab()
  const { strip, parties, space, faces, gm, status, injuryAction, buttons, actions, log } = MODES[tab as RunTab] ?? MODES.scene
  const { gmTools: hasGmTools } = useRole()
  const hasActiveCharacter = useHasActiveCharacter()
  const face = useActiveFace()
  const ownSheet = useActiveControlBar() === null
  const throwing = useTray().request !== null
  const waiting = useTableWaiting()
  const [opened, setOpened] = useState<CatalogView[]>([])
  const [over, setOver] = useState<OverlayView | null>(null)
  const toggle = (v: OverlayView) => {
    if (isCatalog(v)) setOpened((o) => (o.includes(v) ? o : [...o, v]))
    setOver(over === v ? null : v)
  }
  const { setOpen: setBoardTools } = useBoardTools()
  const gmOpen = over === 'GM' && gm !== undefined
  useEffect(() => setBoardTools(gmOpen), [gmOpen, setBoardTools])

  // a mode with nothing in the action column has its state and its log in
  // boxes on the bottom corners of the screen, the sheet in a window opened
  // over them, and the middle the whole screen
  const docked = actions === undefined
  const state = tab === 'scene' && face ? <ActiveFace /> : hasActiveCharacter ? <Status {...status} injuryAction={injuryAction} /> : PICK
  const logSide = throwing ? <DiceTray /> : <>
    <div className='flex flex-row items-center justify-between gap-2'>
      <SectionLabel>{log.label}</SectionLabel>
      {log.action}
    </div>
    <div className='flex-1 min-h-0 overflow-y-auto'>{log.node}</div>
  </>

  return(
    <div className='flex flex-col md:h-[calc(100vh-3rem)] text-left text-sm'>
      <AutoThrow />
      <div className='flex flex-row gap-3 items-start px-2 py-1.5 border-b border-line shrink-0'>
        <ModeSwitch />
        <div className='flex-1 min-w-0'>{waiting ? null : strip}</div>
        <TableLink />
      </div>
      {waiting ? <TableWait /> : <>
      <div className='flex flex-col md:flex-row flex-1 min-h-0'>
        {faces}
        <section className='relative flex-1 min-w-0 min-h-0 p-2 flex flex-col gap-2'>
          <Segmented label='open beside' className='self-start'>
            {OVERLAYS.filter((v) => (v === 'GM' ? gm !== undefined && hasGmTools : !isCatalog(v) || hasGmTools)).map((v) =>
              <Segment key={v} aria-label={isCatalog(v) ? `open ${v}` : v} selected={over === v} onClick={() => toggle(v)}>{v}</Segment>)}
          </Segmented>
          <div className='flex-1 min-h-0 overflow-y-auto flex flex-col'>{space}</div>
          <Overlay title='parties' shown={over === 'parties'} close={() => setOver(null)}>{parties}</Overlay>
          {gm && hasGmTools ? <Overlay title='GM' wide fit shown={gmOpen} close={() => setOver(null)}>{gm}</Overlay> : null}
          {opened.map((v) => <Overlay key={v} title={v} wide shown={over === v} close={() => setOver(null)}>{v === 'items' || hasActiveCharacter ? CATALOGS[v] : PICK}</Overlay>)}
        </section>
        {hasActiveCharacter && !docked ? (
          <aside className='md:w-[32rem] shrink-0 p-2 border-t md:border-t-0 md:border-l border-line min-h-0 overflow-y-auto'>
            <SheetTabs own={ownSheet} />
          </aside>
        ) : null}
      </div>
      {docked ? <>
        <ScreenCorner side='left'><DockBox side='left'>{state}</DockBox></ScreenCorner>
        {hasActiveCharacter ? <SheetBar own={ownSheet} /> : null}
        <ScreenCorner side='right'>
          {hasActiveCharacter ? <SheetWindow>{(t) => <SheetTabs own={ownSheet} at={t} />}</SheetWindow> : null}
          <DockBox side='right'>{logSide}</DockBox>
        </ScreenCorner>
      </> : (
      <div className='grid grid-cols-1 md:grid-cols-12 border-t border-line shrink-0 md:h-[30vh]'>
        <div className='md:col-span-3 p-2 flex flex-col gap-2 overflow-y-auto border-b md:border-b-0 md:border-r border-line'>
          {state}
        </div>
        <div className='md:col-span-5 p-2 flex flex-col gap-2 overflow-y-auto border-b md:border-b-0 md:border-r border-line'>
          <ActionColumn buttons={buttons}>{actions}</ActionColumn>
        </div>
        <div className='md:col-span-4 p-2 flex flex-col gap-1 min-h-48 md:min-h-0'>
          {logSide}
        </div>
      </div>
      )}
      </>}
    </div>
  )
}

// A panel docked to the left of the middle, over the mode's space, opaque. The
// catalogs are a fixed width; the parties grow across with their columns, up
// to the width of the middle; one that `fit`s is as tall as what it holds. It stays mounted while closed, so what was
// half done in it is still there when it opens again.
function Overlay({ title, wide = false, fit = false, shown, close, children }: { title: string, wide?: boolean, fit?: boolean, shown: boolean, close: () => void, children: ReactNode }){
  return(
    <div role='dialog' aria-label={title} hidden={!shown}
      className={`absolute z-10 left-2 top-10 ${fit ? 'max-h-[calc(100%-3rem)]' : 'bottom-2'} ${wide ? 'w-[40rem]' : 'w-max min-w-96'} max-w-[calc(100%-1rem)] overflow-y-auto p-2 rounded border border-line bg-raised shadow-lg shadow-black/40 flex-col gap-2 ${shown ? 'flex' : ''}`}>
      <div className='flex flex-row items-center justify-between'>
        <SectionLabel>{title}</SectionLabel>
        <IconButton icon={X} aria-label={`close ${title}`} onClick={close} />
      </div>
      {children}
    </div>
  )
}

// The dice tray opened by itself for every die called for from someone the
// screen plays, whichever sequence calls for it, and the turn followed.
export function AutoThrow(){
  useFollowTurn()
  useSceneAutoThrow()
  useETAutoThrow()
  useDowntimeAutoThrow()
  return null
}

// Which sequence the table is playing; the scene shows how many are in a
// fight, so one waiting is seen from the others.
function ModeSwitch(){
  const { tab, runTabs, setTab } = useGameTab()
  const fighters = useFighterCount()

  return(
    <Segmented label='mode' className='shrink-0'>
      {runTabs.map((t) => (
        <Segment key={t} aria-label={`mode ${t}`} selected={tab === t} onClick={() => setTab(t)}>
          {t}{t === 'scene' && fighters > 0 ? <span className='ml-1.5 text-[10px] text-muted'>{fighters}</span> : null}
        </Segment>
      ))}
    </Segmented>
  )
}

const SHEET_TABS = ['sheet', 'knowledge', 'inventory', 'gear', 'abilities', 'spells', 'body'] as const
type SheetTab = typeof SHEET_TABS[number]
const LOOKER_TABS: readonly SheetTab[] = ['gear']
const TAB_ICONS: Record<SheetTab, LucideIcon> = { sheet: ScrollText, knowledge: BookOpen, inventory: Backpack, gear: Sword, abilities: Sparkles, spells: WandSparkles, body: HeartPulse }

// The sheet's tabs as buttons along the bottom of the screen, between the
// corners: each opens the sheet's window at it, and closes it once open there.
export function SheetBar({ own }: { own: boolean }){
  const { tab: open, setTab } = useSheetWindow()
  const tabs = own ? SHEET_TABS : LOOKER_TABS
  return(
    <nav aria-label='sheet tabs' className='fixed z-20 bottom-2 left-1/2 -translate-x-1/2 flex flex-row gap-1 p-1 rounded-lg border border-line bg-bg/90 shadow-lg shadow-black/40 backdrop-blur-sm'>
      {tabs.map((t) => {
        const Icon = TAB_ICONS[t]
        const on = open === t
        return (
          <button key={t} type='button' aria-label={`sheet ${t}`} aria-pressed={on} title={on ? `close the ${t}` : `open the ${t}`} onClick={() => setTab(on ? null : t)}
            className={`flex flex-col items-center gap-0.5 w-16 py-1.5 rounded-md text-[10px] cursor-pointer transition-colors ${on ? 'bg-accent/20 text-accent ring-1 ring-accent/60' : 'text-muted hover:bg-raised hover:text-fg'}`}>
            <Icon size={18} aria-hidden />
            {t}
          </button>
        )
      })}
    </nav>
  )
}

// The sheet of the active character: all of it to whoever plays them, only
// their gear, closed, to everyone else.
// The inventory holds what an item is taken into — the hands, the worn
// armor, the containers, the trade — so it stays short beside a catalog;
// what the gear does in a fight is under gear. `opening` is the tab shown
// first, and `copy` whether the screen has a library to copy the character
// into.
export function SheetTabs({ own, opening = 'inventory', copy = true, at }: { own: boolean, opening?: SheetTab, copy?: boolean, at?: string }){
  const [picked, setTab] = useState<SheetTab>(opening)
  const tabs = own ? SHEET_TABS : LOOKER_TABS
  const tab = tabs.find((t) => t === (at ?? picked)) ?? tabs[0]
  const { tableName } = useActiveCharacterData()

  return(
    <div className='flex flex-col gap-2'>
      <span className='text-base font-medium'>{tableName}</span>
      {at === undefined ? (
        <Segmented label='sheet' className='self-start'>
          {tabs.map((t) =>
            <Segment key={t} aria-label={`sheet ${t}`} selected={t === tab} onClick={() => setTab(t)}>{t}</Segment>)}
        </Segmented>
      ) : null}
      <ControlLocked>
        {tab === 'sheet' ? <><MovementTiles /><CharacteristicTiles /><SkillTiles /><NotesAndSave copy={copy} /></> : null}
        {tab === 'knowledge' ? <><KnowledgesPanel /><SpecificKnowledgesPanel /></> : null}
        {tab === 'inventory' ? <GearLocked><HandsPanel /><ArmorPanel tiers={false} /><ContainerPanel /><TradePanel /></GearLocked> : null}
        {tab === 'gear' ? <GearLocked><WeaponPanel /><ArmorPanel /></GearLocked> : null}
        {tab === 'abilities' ? <AbilityPanel /> : null}
        {tab === 'spells' ? <><SustainedPanel /><SpellPanel /></> : null}
        {tab === 'body' ? <GmLocked><AfflictionsPannel /><WoundPanel /><CursePanel /></GmLocked> : null}
      </ControlLocked>
    </div>
  )
}

// What the active character has to spend and what weighs on them; the
// resources, the injury dials and the pending tests are the character's,
// edited and rolled by whoever plays them, while the kill button, the wounds
// and the afflictions are the GM's.
export function Status({ resource, resourceEnd, needs, bars = false, extra, injuryAction }: { resource?: ReactNode, resourceEnd?: ReactNode, needs: boolean, bars?: boolean, extra?: ReactNode, injuryAction?: ReactNode }){
  return(
    <>
      <ControlLocked>{bars ? <ResourceBars after={resourceEnd} /> : <ResourceTiles needs={needs} after={resourceEnd}>{resource}</ResourceTiles>}</ControlLocked>
      <ControlLocked><InjuryDials level={!bars} action={injuryAction ? <GmLocked>{injuryAction}</GmLocked> : undefined} /></ControlLocked>
      <ActiveConditions />
      <ControlLocked><PendingPanel /></ControlLocked>
      {extra}
    </>
  )
}

// Who acts from the bar: the active character, or — for the GM and the
// developer — the GM, who opens the catalogs and does to the mode what no
// character does. Each mode locks what is not the screen's to press.
function ActionColumn({ buttons, children }: { buttons: ReactNode, children: ReactNode }){
  const { gm } = useRole()

  return(
    <>
      <div className='flex flex-row flex-wrap gap-1 items-center'>
        <ActAs />
        {buttons}
      </div>
      {gm ? (
        <ViewAs />
      ) : children}
    </>
  )
}
