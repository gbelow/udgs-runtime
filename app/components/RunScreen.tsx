'use client'
import { useState, type ReactNode } from 'react'
import { WeaponPanel } from './WeaponPanel';
import { AbilityPanel } from './AbilityPanel';
import { SpellPanel } from './SpellPanel';
import { ActionLog } from './ActionPanel';
import { ArmorPanel } from './ArmorPanel';
import { HandsPanel } from './HandsPanel';
import { ContainerPanel } from './ContainerPanel';
import { TradePanel } from './TradePanel';
import { ItemSelector } from './ItemSelector';
import { AbilitySelector } from './AbilitySelector';
import { SpellSelector } from './SpellSelector';
import { AfflictionsPannel, CharacteristicTiles, CursePanel, InjuryDials, KnowledgesPanel, MovementTiles, NotesAndSave, PendingPanel, ResourceTiles, SimpleResource, SkillTiles, SpecificKnowledgesPanel, WoundPanel } from './CharacterSheet';
import { PartiesView } from './PartiesView';
import { CampaignParties } from './CampaignParties';
import { GmSceneTools, KillButton, SceneActions, SceneSpace, SceneStrip, SustainedPanel } from './ScenePanel';
import { ExplorationSection, ExplorationStrip, LastEtLog, PartyCards } from './ExplorationPanel';
import { DowntimeActions, DowntimeRoster, DowntimeStrip, LastDaysLog } from './DowntimePanel';
import { makeDieRoll } from './utils';
import { Button, SectionLabel } from './ui';
import { ControlLocked, GearLocked, GmLocked } from './Locks';
import { useGameTab } from '../hooks/useGameTab';
import { useFighterCount } from '../hooks/useCombatState';
import { useActiveCharacterData, useHasActiveCharacter } from '../hooks/useCharacterData';
import { useRole } from '../hooks/useRole';
import type { RunTab } from '../stores/useAppStore';

type Mode = {
  // what moves time and who is in play, along the top
  strip: ReactNode
  // the mode's own spaces in the middle, the first shown by default
  views: { key: string, node: ReactNode }[]
  // what the active character spends beside the tiles every mode has, and
  // the button beside their injuries
  resource?: ReactNode
  injuryAction?: ReactNode
  actions: ReactNode
  // what the GM does to the mode that no character does
  gmTools?: ReactNode
  log: { label: string, node: ReactNode }
}

const MODES: Record<RunTab, Mode> = {
  scene: {
    strip: <SceneStrip />,
    views: [{ key: 'parties', node: <PartiesView /> }, { key: 'scene', node: <SceneSpace /> }],
    resource: <SimpleResource rssName={'AP'} />,
    injuryAction: <KillButton />,
    actions: <SceneActions />,
    gmTools: <GmSceneTools />,
    log: { label: 'Log', node: <ActionLog /> },
  },
  exploration: {
    strip: <ExplorationStrip />,
    views: [{ key: 'parties', node: <CampaignParties /> }, { key: 'plans', node: <PartyCards /> }],
    actions: <ExplorationSection />,
    log: { label: 'Last ET', node: <LastEtLog /> },
  },
  downtime: {
    strip: <DowntimeStrip />,
    views: [{ key: 'parties', node: <CampaignParties /> }, { key: 'roster', node: <DowntimeRoster /> }],
    actions: <DowntimeActions />,
    log: { label: 'Last days', node: <LastDaysLog /> },
  },
}

const CATALOGS = {
  items: <ItemSelector wide />,
  abilities: <AbilitySelector wide />,
  spells: <SpellSelector wide />,
}
type CatalogView = keyof typeof CATALOGS
const CATALOG_VIEWS = Object.keys(CATALOGS) as CatalogView[]

const PICK = <span className='text-xs text-muted'>pick a character</span>

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
  const { strip, views, resource, injuryAction, actions, gmTools, log } = MODES[tab as RunTab] ?? MODES.scene
  const hasActiveCharacter = useHasActiveCharacter()
  const [opened, setOpened] = useState<CatalogView[]>([])
  const [center, setCenter] = useState<string>(views[0].key)
  const middle = [...views.map((v) => ({ ...v, catalog: false })), ...opened.map((v) => ({ key: v, node: CATALOGS[v], catalog: true }))]
  const shown = middle.find((v) => v.key === center) ?? middle[0]
  const open = (v: CatalogView) => { setOpened((o) => (o.includes(v) ? o : [...o, v])); setCenter(v) }
  const close = (v: CatalogView) => setOpened((o) => o.filter((x) => x !== v))

  return(
    <div className='flex flex-col md:h-[calc(100vh-3rem)] text-left text-sm'>
      <div className='flex flex-row gap-3 items-start px-2 py-1.5 border-b border-line shrink-0'>
        <ModeSwitch />
        <div className='flex-1 min-w-0'>{strip}</div>
      </div>
      <div className='flex flex-col md:flex-row flex-1 min-h-0'>
        <section className='flex-1 min-w-0 min-h-0 p-2 flex flex-col gap-2'>
          <div className='flex flex-row flex-wrap gap-1 items-center'>
            {middle.map((v) => (
              <span key={v.key} className='inline-flex items-center'>
                <Button size='xs' aria-label={`view ${v.key}`} selected={v === shown} onClick={() => setCenter(v.key)}>{v.key}</Button>
                {v.catalog ? <Button size='xs' variant='ghost' aria-label={`close ${v.key}`} title={`close the ${v.key} catalog`} onClick={() => close(v.key as CatalogView)}>×</Button> : null}
              </span>
            ))}
          </div>
          <div className='flex-1 min-h-0 overflow-y-auto flex flex-col'>{shown.node}</div>
        </section>
        {hasActiveCharacter ? (
          <aside className='md:w-[32rem] shrink-0 p-2 border-t md:border-t-0 md:border-l border-line min-h-0 overflow-y-auto'>
            <SheetTabs />
          </aside>
        ) : null}
      </div>
      <div className='grid grid-cols-1 md:grid-cols-12 border-t border-line shrink-0 md:h-[30vh]'>
        <div className='md:col-span-3 p-2 flex flex-col gap-2 overflow-y-auto border-b md:border-b-0 md:border-r border-line'>
          {hasActiveCharacter ? <Status resource={resource} injuryAction={injuryAction} /> : PICK}
        </div>
        <div className='md:col-span-5 p-2 flex flex-col gap-2 overflow-y-auto border-b md:border-b-0 md:border-r border-line'>
          <ActionColumn open={open} gmTools={gmTools}>{hasActiveCharacter ? actions : PICK}</ActionColumn>
        </div>
        <div className='md:col-span-4 p-2 flex flex-col gap-1 min-h-0'>
          <SectionLabel>{log.label}</SectionLabel>
          <div className='flex-1 min-h-0 overflow-y-auto'>{log.node}</div>
        </div>
      </div>
    </div>
  )
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

// The inventory holds what an item is taken into — the hands, the worn
// armor, the containers, the trade — so it stays short beside a catalog;
// what the gear does in a fight is under gear.
function SheetTabs(){
  const [tab, setTab] = useState<SheetTab>('inventory')
  const { tableName } = useActiveCharacterData()

  return(
    <div className='flex flex-col gap-2'>
      <span className='text-base font-medium'>{tableName}</span>
      <div className='flex flex-row flex-wrap gap-1'>
        {SHEET_TABS.map((t) =>
          <Button key={t} size='xs' aria-label={`sheet ${t}`} selected={t === tab} onClick={() => setTab(t)}>{t}</Button>)}
      </div>
      <ControlLocked>
        {tab === 'sheet' ? <><MovementTiles /><CharacteristicTiles /><SkillTiles /><NotesAndSave /></> : null}
        {tab === 'knowledge' ? <><KnowledgesPanel /><SpecificKnowledgesPanel /></> : null}
        {tab === 'inventory' ? <GearLocked><HandsPanel /><ArmorPanel tiers={false} /><ContainerPanel /><TradePanel /></GearLocked> : null}
        {tab === 'gear' ? <GearLocked><WeaponPanel /><ArmorPanel /></GearLocked> : null}
        {tab === 'abilities' ? <AbilityPanel /> : null}
        {tab === 'spells' ? <><SustainedPanel /><SpellPanel /></> : null}
        {tab === 'body' ? <GmLocked><WoundPanel /><CursePanel /></GmLocked> : null}
      </ControlLocked>
    </div>
  )
}

// What the active character has to spend and what weighs on them; the
// resources, the injuries and the afflictions are the GM's to edit, and the
// pending tests the character's to roll, by whoever plays them.
function Status({ resource, injuryAction }: { resource?: ReactNode, injuryAction?: ReactNode }){
  return(
    <>
      <GmLocked>
        <ResourceTiles>{resource}</ResourceTiles>
        <InjuryDials action={injuryAction} />
        <AfflictionsPannel />
      </GmLocked>
      <ControlLocked><PendingPanel /></ControlLocked>
    </>
  )
}

// Who acts from the bar: the active character, by whoever plays them, or —
// for the GM and the developer — the GM, who opens the catalogs and does to
// the mode what no character does.
function ActionColumn({ open, gmTools, children }: { open: (v: CatalogView) => void, gmTools: ReactNode, children: ReactNode }){
  const { gmTools: hasGmTools, gm, setGmMode } = useRole()

  return(
    <>
      <div className='flex flex-row flex-wrap gap-1 items-center'>
        {hasGmTools ? <>
          <Button size='xs' aria-label='act as character' aria-pressed={!gm} selected={!gm} onClick={() => setGmMode(false)}>character</Button>
          <Button size='xs' aria-label='act as GM' aria-pressed={gm} selected={gm} onClick={() => setGmMode(true)}>GM</Button>
        </> : null}
        <span className='ml-auto flex flex-row gap-1'>
          <DieButton sides={10} />
          <DieButton sides={6} />
        </span>
      </div>
      {gm ? (
        <div className='flex flex-col gap-1'>
          <div className='flex flex-row flex-wrap gap-1 items-center'>
            <SectionLabel>catalog</SectionLabel>
            {CATALOG_VIEWS.map((v) => <Button key={v} size='xs' aria-label={`open ${v}`} onClick={() => open(v)}>{v}</Button>)}
          </div>
          {gmTools}
        </div>
      ) : <ControlLocked>{children}</ControlLocked>}
    </>
  )
}

function DieButton({ sides }: { sides: number }){
  const [roll, setRoll] = useState(1)
  return <Button size='xs' aria-label='roll' onClick={() => setRoll(makeDieRoll(sides))}>d{sides} <span className='font-mono text-fg'>{roll}</span></Button>
}
