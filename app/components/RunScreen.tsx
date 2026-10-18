'use client'
import { useState, type ReactNode } from 'react'
import dynamic from 'next/dynamic'
import { WeaponPanel } from './WeaponPanel';
import { AbilityPanel } from './AbilityPanel';
import { SpellPanel } from './SpellPanel';
import { ActionLog, SaveLogButton } from './ActionPanel';
import { ArmorPanel } from './ArmorPanel';
import { HandsPanel } from './HandsPanel';
import { ContainerPanel } from './ContainerPanel';
import { TradePanel } from './TradePanel';
import { ItemSelector } from './ItemSelector';
import { AbilitySelector } from './AbilitySelector';
import { SpellSelector } from './SpellSelector';
import { ActiveConditions,AfflictionsPannel,CharacteristicTiles, CursePanel, InjuryDials, KnowledgesPanel, MovementTiles, NotesAndSave, PendingPanel, ResourceTiles, SimpleResource, SkillTiles, SpecificKnowledgesPanel, WoundPanel } from './CharacterSheet';
import { PartiesView } from './PartiesView';
import { TableLink, TableWait, ViewAs } from './RunParts';
import { useTableWaiting } from '../hooks/useTable';
import { CampaignParties } from './CampaignParties';
import { GmSceneTools, KillButton, SceneActions, SceneSpace, SceneStrip, SustainedPanel } from './ScenePanel';
import { ExplorationSection, ExplorationStrip, LastEtLog, PartyCards } from './ExplorationPanel';
import { DowntimeActions, DowntimeRoster, DowntimeStrip, LastDaysLog } from './DowntimePanel';
import { RecentJournal } from './Journal';
import { Button, SectionLabel } from './ui';
import { ControlLocked, GearLocked, GmLocked } from './Locks';
import { useGameTab } from '../hooks/useGameTab';
import { useFighterCount } from '../hooks/useCombatState';
import { useActiveCharacterData, useHasActiveCharacter } from '../hooks/useCharacterData';
import { useRole } from '../hooks/useRole';
import { useActiveControlBar } from '../hooks/useControl';
import { useTray } from '../hooks/useTray';
import { useSceneAutoThrow } from '../hooks/useSceneDice';
import { useETAutoThrow } from '../hooks/useParty';
import { useDowntimeAutoThrow } from '../hooks/useDowntime';
import type { RunTab } from '../stores/useAppStore';

type Mode = {
  // what moves time and who is in play, along the top
  strip: ReactNode
  // who is in play, in a popover over the middle
  parties: ReactNode
  // the mode's own space in the middle
  space: ReactNode
  // what the active character spends beside the tiles every mode has, and
  // the button beside their injuries
  resource?: ReactNode
  // whether exhaustion, hunger and thirst show among the tiles
  needs: boolean
  injuryAction?: ReactNode
  actions: ReactNode
  // what the GM does to the mode that no character does
  gmTools?: ReactNode
  log: { label: string, node: ReactNode, action?: ReactNode }
}

const MODES: Record<RunTab, Mode> = {
  scene: {
    strip: <SceneStrip />,
    parties: <PartiesView />,
    space: <SceneSpace />,
    resource: <SimpleResource rssName={'AP'} />,
    needs: false,
    injuryAction: <KillButton />,
    actions: <SceneActions />,
    gmTools: <GmSceneTools />,
    log: { label: 'Log', node: <ActionLog />, action: <SaveLogButton /> },
  },
  exploration: {
    strip: <ExplorationStrip />,
    parties: <CampaignParties sequence='exploration' />,
    space: <PartyCards />,
    needs: true,
    actions: <ControlLocked><ExplorationSection /></ControlLocked>,
    log: { label: 'Last ET', node: <div className='flex flex-col gap-2'><LastEtLog /><RecentJournal /></div> },
  },
  downtime: {
    strip: <DowntimeStrip />,
    parties: <CampaignParties sequence='downtime' />,
    space: <DowntimeRoster />,
    needs: true,
    actions: <ControlLocked><DowntimeActions /></ControlLocked>,
    log: { label: 'Last days', node: <div className='flex flex-col gap-2'><LastDaysLog /><RecentJournal /></div> },
  },
}

const CATALOGS = {
  items: <ItemSelector wide />,
  abilities: <AbilitySelector wide />,
  spells: <SpellSelector wide />,
}
type CatalogView = keyof typeof CATALOGS
const OVERLAYS = ['parties', ...Object.keys(CATALOGS) as CatalogView[]] as const

const PICK = <span className='text-xs text-muted'>pick a character</span>

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
  const { strip, parties, space, resource, needs, injuryAction, actions, gmTools, log } = MODES[tab as RunTab] ?? MODES.scene
  const { gmTools: hasGmTools } = useRole()
  const hasActiveCharacter = useHasActiveCharacter()
  const ownSheet = useActiveControlBar() === null
  const throwing = useTray().request !== null
  const waiting = useTableWaiting()
  const [opened, setOpened] = useState<CatalogView[]>([])
  const [over, setOver] = useState<'parties' | CatalogView | null>(null)
  const toggle = (v: 'parties' | CatalogView) => {
    if (v !== 'parties') setOpened((o) => (o.includes(v) ? o : [...o, v]))
    setOver(over === v ? null : v)
  }

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
        <section className='relative flex-1 min-w-0 min-h-0 p-2 flex flex-col gap-2'>
          <div className='flex flex-row flex-wrap gap-1 items-center'>
            {OVERLAYS.filter((v) => v === 'parties' || hasGmTools).map((v) =>
              <Button key={v} size='xs' aria-label={v === 'parties' ? v : `open ${v}`} aria-pressed={over === v} selected={over === v} onClick={() => toggle(v)}>{v}</Button>)}
          </div>
          <div className='flex-1 min-h-0 overflow-y-auto flex flex-col'>{space}</div>
          <Overlay title='parties' shown={over === 'parties'} close={() => setOver(null)}>{parties}</Overlay>
          {opened.map((v) => <Overlay key={v} title={v} wide shown={over === v} close={() => setOver(null)}>{v === 'items' || hasActiveCharacter ? CATALOGS[v] : PICK}</Overlay>)}
        </section>
        {hasActiveCharacter ? (
          <aside className='md:w-[32rem] shrink-0 p-2 border-t md:border-t-0 md:border-l border-line min-h-0 overflow-y-auto'>
            <SheetTabs own={ownSheet} />
          </aside>
        ) : null}
      </div>
      <div className='grid grid-cols-1 md:grid-cols-12 border-t border-line shrink-0 md:h-[30vh]'>
        <div className='md:col-span-3 p-2 flex flex-col gap-2 overflow-y-auto border-b md:border-b-0 md:border-r border-line'>
          {hasActiveCharacter ? <Status resource={resource} needs={needs} injuryAction={injuryAction} /> : PICK}
        </div>
        <div className='md:col-span-5 p-2 flex flex-col gap-2 overflow-y-auto border-b md:border-b-0 md:border-r border-line'>
          <ActionColumn gmTools={gmTools}>{hasActiveCharacter ? actions : PICK}</ActionColumn>
        </div>
        <div className='md:col-span-4 p-2 flex flex-col gap-1 min-h-48 md:min-h-0'>
          {throwing ? <DiceTray /> : <>
            <div className='flex flex-row items-center justify-between gap-2'>
              <SectionLabel>{log.label}</SectionLabel>
              {log.action}
            </div>
            <div className='flex-1 min-h-0 overflow-y-auto'>{log.node}</div>
          </>}
        </div>
      </div>
      </>}
    </div>
  )
}

// A panel docked to the left of the middle, over the mode's space, the full
// height of it and see-through. It stays mounted while closed, so what was
// half done in it is still there when it opens again.
function Overlay({ title, wide = false, shown, close, children }: { title: string, wide?: boolean, shown: boolean, close: () => void, children: ReactNode }){
  return(
    <div role='dialog' aria-label={title} hidden={!shown}
      className={`absolute z-10 left-2 top-10 bottom-2 ${wide ? 'w-[40rem]' : 'w-96'} max-w-[calc(100%-1rem)] overflow-y-auto p-2 rounded border border-line bg-raised/25 shadow-lg shadow-black/40 flex-col gap-2 ${shown ? 'flex' : ''}`}>
      <div className='flex flex-row items-center justify-between'>
        <SectionLabel>{title}</SectionLabel>
        <Button size='xs' variant='ghost' aria-label={`close ${title}`} onClick={close}>×</Button>
      </div>
      {children}
    </div>
  )
}

// The dice tray opened by itself for every die called for from someone the
// screen plays, whichever sequence calls for it.
function AutoThrow(){
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
    <div className='flex flex-row gap-1 items-center shrink-0'>
      {runTabs.map((t) => (
        <Button key={t} size='xs' aria-label={`mode ${t}`} aria-pressed={tab === t} selected={tab === t} onClick={() => setTab(t)}>
          {t}{t === 'scene' && fighters > 0 ? <span className='ml-1.5 text-[10px] text-muted'>{fighters}</span> : null}
        </Button>
      ))}
    </div>
  )
}

const SHEET_TABS = ['sheet', 'knowledge', 'inventory', 'gear', 'abilities', 'spells', 'body'] as const
type SheetTab = typeof SHEET_TABS[number]
const LOOKER_TABS: readonly SheetTab[] = ['gear']

// The sheet of the active character: all of it to whoever plays them, only
// their gear, closed, to everyone else.
// The inventory holds what an item is taken into — the hands, the worn
// armor, the containers, the trade — so it stays short beside a catalog;
// what the gear does in a fight is under gear.
function SheetTabs({ own }: { own: boolean }){
  const [picked, setTab] = useState<SheetTab>('inventory')
  const tabs = own ? SHEET_TABS : LOOKER_TABS
  const tab = tabs.find((t) => t === picked) ?? tabs[0]
  const { tableName } = useActiveCharacterData()

  return(
    <div className='flex flex-col gap-2'>
      <span className='text-base font-medium'>{tableName}</span>
      <div className='flex flex-row flex-wrap gap-1'>
        {tabs.map((t) =>
          <Button key={t} size='xs' aria-label={`sheet ${t}`} selected={t === tab} onClick={() => setTab(t)}>{t}</Button>)}
      </div>
      <ControlLocked>
        {tab === 'sheet' ? <><MovementTiles /><CharacteristicTiles /><SkillTiles /><NotesAndSave /></> : null}
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
// resources, the injuries and the afflictions are the GM's to edit, and the
// pending tests the character's to roll, by whoever plays them.
function Status({ resource, needs, injuryAction }: { resource?: ReactNode, needs: boolean, injuryAction?: ReactNode }){
  return(
    <>
      <GmLocked>
        <ResourceTiles needs={needs}>{resource}</ResourceTiles>
        <InjuryDials action={injuryAction} />
      </GmLocked>
      <ActiveConditions />
      <ControlLocked><PendingPanel /></ControlLocked>
    </>
  )
}

// Who acts from the bar: the active character, or — for the GM and the
// developer — the GM, who opens the catalogs and does to the mode what no
// character does. Each mode locks what is not the screen's to press.
function ActionColumn({ gmTools, children }: { gmTools: ReactNode, children: ReactNode }){
  const { gmTools: hasGmTools, gm, setGmMode } = useRole()

  return(
    <>
      <div className='flex flex-row flex-wrap gap-1 items-center'>
        {hasGmTools ? <>
          <Button size='xs' aria-label='act as character' aria-pressed={!gm} selected={!gm} onClick={() => setGmMode(false)}>character</Button>
          <Button size='xs' aria-label='act as GM' aria-pressed={gm} selected={gm} onClick={() => setGmMode(true)}>GM</Button>
        </> : null}
      </div>
      {gm ? (
        <div className='flex flex-col gap-1'>
          {gmTools}
          <ViewAs />
        </div>
      ) : children}
    </>
  )
}
