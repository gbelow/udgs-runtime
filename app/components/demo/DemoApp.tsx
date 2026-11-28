'use client'
import { useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { Check, Plus, X } from 'lucide-react'
import { useBots } from '../../hooks/useBots'
import { useContestClock } from '../../hooks/useContest'
import { useSights } from '../../hooks/useSights'
import { useDemo, useDemoKept, useDemoPicker, useDemoStage } from '../../hooks/useDemo'
import { useHasActiveCharacter } from '../../hooks/useCharacterData'
import { useActiveFace, useCombatState } from '../../hooks/useCombatState'
import { ActiveFace } from '../ActiveFace'
import { useTray } from '../../hooks/useTray'
import type { DemoFate, DemoOutcome } from '../../domain/scene/projections/demo'
import { SceneSpace, TableWaits, TurnBar } from '../ScenePanel'
import { DockBox, ScreenCorner, SheetToggle, SheetWindow } from '../Docks'
import { FacesColumn } from '../FocusBar'
import { AutoThrow, FIGHT_SLOTS, SheetTabs, Status } from '../RunScreen'
import { useActiveControlBar } from '../../hooks/useControl'
import { Button, IconButton, SectionLabel, Segment, Segmented, Tooltip } from '../ui'
import { SPAWN_SWATCH } from '../spawnSwatch'
import { Basics, HelpButton, HintLine, HowToPlay } from './DemoHelp'

const DiceTray = dynamic(() => import('../DiceTray'), { ssr: false })


// The demo: the visitor picks a party, then plays the scene against the bots
// with nothing on the screen but what a player of the fight needs.
export function DemoApp({ offered }: { offered: string[] | null }) {
  const { stage } = useDemoStage()
  useDemoKept()
  return stage === 'pick' ? <DemoPicker offered={offered} /> : <DemoTable />
}

function Home() {
  return <Link href='/' className='text-base font-semibold tracking-wide text-fg hover:text-accent'>fallow</Link>
}

// The party picker: the characters offered, each of the scene's parties
// with its picks and who plays it (the one picked is the one filled), the
// line-ups offered ready-made, and joining, or watching when the visitor
// plays none.
function DemoPicker({ offered }: { offered: string[] | null }) {
  const { view, add, remove, play, preselect, join } = useDemoPicker(offered)
  const [filling, setFilling] = useState(() => Math.max(0, view.sides.findIndex((s) => s.you)))
  const at = Math.min(filling, Math.max(0, view.sides.length - 1))
  const target = view.sides[at]
  const fullBar = target ? target.fullBar : 'the scene has no parties'
  return (
    <div className='flex flex-col gap-6 max-w-5xl mx-auto px-4 py-6 text-sm text-left'>
      <div className='flex flex-row items-baseline gap-3'>
        <Home />
        <span className='text-muted'>demo</span>
        {view.scene ? <span className='text-muted'>· {view.scene}</span> : null}
      </div>
      <HowToPlay />
      <section className='flex flex-col gap-3'>
        <div className='flex flex-row flex-wrap items-center gap-2'>
          <h2 className='text-lg font-medium grow'>Parties</h2>
          <Tooltip text={view.sides.every((s) => s.lineup.length === 0) ? 'the scene offers no ready-made parties' : "fill every party with the scene's line-up"}>
            <Button disabled={view.sides.every((s) => s.lineup.length === 0)} onClick={preselect}>ready-made parties</Button>
          </Tooltip>
          <Tooltip text={view.joinBar ?? (view.watching ? 'watch the bots play every party' : 'into the fight')}>
            <Button weight='solid' tone='accent' disabled={view.joinBar !== null} onClick={join}>{view.watching ? 'watch' : 'join'}</Button>
          </Tooltip>
        </div>
        {view.joinBar ? <span className='text-xs text-muted'>{view.joinBar}</span> : null}
        <div className='grid grid-cols-1 md:grid-cols-2 gap-2'>
          {view.sides.map((s, i) => {
            const swatch = s.area === null ? null : SPAWN_SWATCH[s.area] ?? SPAWN_SWATCH[1]
            return (
              <div key={i} role='group' aria-label={s.name} onClick={() => setFilling(i)}
                className={`flex flex-col gap-2 rounded border bg-surface p-3 cursor-pointer ${i === at ? 'border-accent' : 'border-line'}`}>
                <div className='flex flex-row flex-wrap items-center gap-2'>
                  {swatch ? <span className={`inline-block w-4 h-4 rounded-sm border ${swatch}`} /> : null}
                  <span className='font-medium grow'>{s.name}</span>
                  <span className='text-xs text-muted font-mono'>{s.picks.length}</span>
                  <Segmented label={`who plays ${s.name}`}>
                    <Segment selected={s.you} aria-label={`you play ${s.name}`} onClick={(e) => { e.stopPropagation(); play(i, true) }}>you</Segment>
                    <Segment selected={!s.you} aria-label={`the bot plays ${s.name}`} onClick={(e) => { e.stopPropagation(); play(i, false) }}>bot</Segment>
                  </Segmented>
                </div>
                <div className='flex flex-row flex-wrap gap-1'>
                  {s.picks.map((p, n) => (
                    <span key={`${p.key}-${n}`} className='inline-flex items-center gap-1 rounded border border-accent bg-accent/10 pl-2 pr-1 py-0.5'>
                      {p.name}
                      <IconButton icon={X} aria-label={`remove ${p.name} from ${s.name}`} onClick={(e) => { e.stopPropagation(); remove(i, n) }} />
                    </span>
                  ))}
                  {s.picks.length === 0 ? <span className='text-xs text-muted'>{i === at ? 'pick characters below' : 'empty: stays out of the fight'}</span> : null}
                </div>
              </div>
            )
          })}
        </div>
      </section>
      <section className='flex flex-col gap-2'>
        <SectionLabel>{target ? `characters for ${target.name}` : 'characters'}</SectionLabel>
        {view.offered.length === 0 ? <span className='text-muted'>No characters are offered.</span> : null}
        <div className='grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2'>
          {view.offered.map((c) => (
            <button key={c.key} type='button' title={fullBar ?? undefined} aria-label={`add ${c.name} to ${target?.name ?? 'the party'}`} disabled={fullBar !== null}
              onClick={() => add(at, c.key)}
              className='flex flex-row items-center gap-2 rounded border border-line bg-surface px-3 py-2 text-left hover:border-accent disabled:opacity-40 disabled:hover:border-line'>
              <span className='flex flex-col grow min-w-0'>
                <span className='font-medium truncate'>{c.name}</span>
                {c.tags.length > 0 ? <span className='text-xs text-muted truncate'>{c.tags.join(' · ')}</span> : null}
                {c.description ? <span className='text-xs'>{c.description}</span> : null}
              </span>
              <Plus className='w-4 h-4 text-muted shrink-0' />
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}

// The fight: the round, everyone in it and the start along the top, the
// board in the middle with the sheet of the visitor's character picked beside
// it, and along the bottom the active character's state,
// what they can do (or, before the fight, placing the party) and the log.
function DemoTable() {
  const { started, scene, back } = useDemoStage()
  const { view, seeHint, watching } = useDemo()
  useBots({ auto: true, holdStart: !started })
  useContestClock()
  useSights()
  const hasActive = useHasActiveCharacter()
  const face = useActiveFace()
  const own = useActiveControlBar() === null
  const throwing = useTray().request !== null
  return (
    <div className='flex flex-col h-screen text-left text-sm'>
      <AutoThrow />
      <header className='flex flex-row flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 border-b border-line shrink-0'>
        <Home />
        <span className='text-muted'>{scene}</span>
        {started ? <><Round /><TableWaits /><TurnBar /></> : null}
        <span className='grow' />
        <HelpButton />
        <Button size='xs' weight='ghost' title='back to picking the party' onClick={back}>restart game</Button>
      </header>
      <div className='flex flex-col md:flex-row flex-1 min-h-0'>
        <FacesColumn />
        <div className='relative flex-1 min-w-0 min-h-0 flex flex-col p-2'>
          <div className='flex-1 min-h-0 overflow-y-auto flex flex-col'><SceneSpace selfRun placing={!started} /></div>
          <Result />
        </div>
      </div>
      <ScreenCorner side='left'>
        <DockBox side='left'>
          {view.hint ? <HintLine hint={view.hint} onClose={() => { if (view.hint) seeHint(view.hint) }} /> : null}
          {started && hasActive && !face && (own || watching) ? <SheetToggle /> : null}
          {!started ? <Placing /> : face ? <ActiveFace /> : hasActive ? <Status {...FIGHT_SLOTS.status} /> : <span className='text-xs text-muted'>pick a character</span>}
        </DockBox>
      </ScreenCorner>
      <ScreenCorner side='right'>
        {hasActive && !face && (own || watching) ? <SheetWindow title='sheet'><SheetTabs own={own} opening='sheet' copy={false} /></SheetWindow> : null}
        <DockBox side='right'>
          {throwing ? <DiceTray /> : !started ? <Basics /> : <>
            <SectionLabel>{FIGHT_SLOTS.log.label}</SectionLabel>
            <div className='flex-1 min-h-0 overflow-y-auto'>{FIGHT_SLOTS.log.node}</div>
          </>}
        </DockBox>
      </ScreenCorner>
    </div>
  )
}

function Round() {
  const { round } = useCombatState()
  return round > 0 ? <span className='text-xs text-muted whitespace-nowrap'>Round <span className='font-mono text-fg'>{round}</span></span> : null
}

// Before the fight: where the party goes, each member to pick and place, the
// rest placed where there is room, and the start, closed until everyone
// stands; for one who only watches, the start alone.
function Placing() {
  const { view, activeId, start, pick, placeRest, watching } = useDemo()
  const swatch = view.area === null ? null : SPAWN_SWATCH[view.area] ?? SPAWN_SWATCH[1]
  const unplaced = view.members.some((m) => !m.placed)
  return (
    <div className='flex flex-col gap-3'>
      {watching ? <>
        <span className='text-base'>The bots play every party.</span>
        <span className='text-xs text-muted'>Pick a character to follow them. &ldquo;their eyes&rdquo; over the board shows only what they see.</span>
      </> : <>
        {swatch ? (
          <div className='flex flex-row items-center gap-2 text-base'>
            <span>Place your party in the</span>
            <span className={`inline-block w-5 h-5 rounded-sm border ${swatch}`} />
            <span>area.</span>
          </div>
        ) : <span className='text-base'>Place your party anywhere on the board.</span>}
        <span className='text-xs text-muted'>Pick a character, then click a cell. Until the fight starts you may place them again.</span>
        <div className='flex flex-row flex-wrap gap-2'>
          {view.members.map((m) => (
            <Button key={m.id} selected={m.id === activeId} aria-pressed={m.id === activeId} icon={m.placed ? Check : undefined} tone={m.placed ? 'good' : 'neutral'} onClick={() => pick(m.id)}>{m.name}</Button>
          ))}
          <Tooltip text={unplaced ? 'put everyone not yet placed down where there is room' : 'everyone is placed'}>
            <Button weight='subtle' disabled={!unplaced} onClick={placeRest}>place the rest</Button>
          </Tooltip>
        </div>
      </>}
      <Tooltip text={view.startBar ?? 'the first round begins'} className='self-start'>
        <Button size='sm' weight='solid' tone='accent' disabled={view.startBar !== null} onClick={start} className='px-8 py-2 text-base'>START</Button>
      </Tooltip>
      {view.startBar ? <span className='text-xs text-muted'>{view.startBar}</span> : null}
    </div>
  )
}

const OUTCOME_TITLE: Record<DemoOutcome, string> = { won: 'Victory', lost: 'Defeat', draw: 'Nobody is left standing', over: 'The fight is over' }
const OUTCOME_TONE: Record<DemoOutcome, string> = { won: 'text-good', lost: 'text-bad', draw: 'text-muted', over: 'text-accent' }
const FATE_TEXT: Record<DemoFate, string> = { standing: 'standing', surrendered: 'surrendered', down: 'collapsed', dead: 'dead' }

// How the fight ended, over the board: who won, how everyone of each party
// came out of it, and the way back in.
function Result() {
  const { view, again, back } = useDemo()
  const [hidden, setHidden] = useState(false)
  if (!view.result) return null
  const { outcome, winner, parties } = view.result
  const title = outcome === 'over' && winner !== null ? `${winner} wins` : OUTCOME_TITLE[outcome]
  if (hidden) return <Button className='absolute top-3 right-3 z-10' weight='solid' tone='accent' onClick={() => setHidden(false)}>{title}: the result</Button>
  return (
    <div role='dialog' aria-label='result' className='absolute inset-0 z-10 flex items-center justify-center bg-bg/70'>
      <div className='flex flex-col gap-4 rounded border border-line bg-raised p-6 shadow-lg shadow-black/40 max-w-lg w-full mx-4'>
        <h2 className={`text-3xl font-semibold text-center ${OUTCOME_TONE[outcome]}`}>{title}</h2>
        <div className='flex flex-row flex-wrap gap-6 justify-center max-h-[50vh] overflow-y-auto'>
          {parties.map((p) => (
            <div key={p.id} className='flex flex-col gap-1 min-w-40'>
              <SectionLabel>{p.yours ? `${p.name} (yours)` : p.name}</SectionLabel>
              {p.rows.map((r) => (
                <div key={r.id} className='flex flex-row gap-3 justify-between'>
                  <span>{r.name}</span>
                  <span className={r.fate === 'standing' ? 'text-good' : 'text-muted'}>{FATE_TEXT[r.fate]}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className='flex flex-row flex-wrap gap-2 justify-center'>
          <Button weight='solid' tone='accent' onClick={() => { setHidden(false); again() }}>play again</Button>
          <Button title='back to picking the party' onClick={back}>restart game</Button>
          <Button weight='ghost' onClick={() => setHidden(true)}>look at the board</Button>
        </div>
      </div>
    </div>
  )
}
