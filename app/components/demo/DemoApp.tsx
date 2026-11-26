'use client'
import { useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { Check, Plus, RotateCw, X } from 'lucide-react'
import { useBoard } from '../../hooks/useBoard'
import { useBoardVeil, useLitCell } from '../../hooks/useBoardVeil'
import { useBoardCamera, useCellAt } from '../../hooks/useBoardCanvas'
import { useBoardLook } from '../../hooks/useBoardLook'
import { useBots, useBotsPaused } from '../../hooks/useBots'
import { useContestClock } from '../../hooks/useContest'
import { useSights } from '../../hooks/useSights'
import { TurnBanner } from '../TurnBanner'
import { useDemo, useDemoKept, useDemoPicker, useDemoStage } from '../../hooks/useDemo'
import { useHasActiveCharacter } from '../../hooks/useCharacterData'
import { useActiveFace, useCombatState, useRoundChange } from '../../hooks/useCombatState'
import { ActiveFace } from '../ActiveFace'
import { useTray } from '../../hooks/useTray'
import type { DemoFate, DemoOutcome } from '../../domain/scene/projections/demo'
import { BoardCanvas } from '../BoardCanvas'
import { ZoomButtons } from '../BoardPanel'
import { ClickMenuHost } from '../ClickMenu'
import { RoundChangePanel } from '../RoundChangePanel'
import { CharacterList, FightActions, FightButtons, SurgeTile } from '../ScenePanel'
import { AutoThrow, Status } from '../RunScreen'
import { ActionLog } from '../ActionPanel'
import { Button, IconButton, SectionLabel, Tooltip } from '../ui'
import { SPAWN_SWATCH } from '../spawnSwatch'
import { Basics, HelpButton, HintLine, Objective } from './DemoHelp'

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

// The party picker: the characters offered, the party's places, the
// line-up offered ready-made, and joining.
function DemoPicker({ offered }: { offered: string[] | null }) {
  const { view, add, remove, preselect, join } = useDemoPicker(offered)
  const empty = Array.from({ length: Math.max(0, view.slots - view.picks.length) })
  return (
    <div className='flex flex-col gap-6 max-w-5xl mx-auto px-4 py-6 text-sm text-left'>
      <div className='flex flex-row items-baseline gap-3'>
        <Home />
        <span className='text-muted'>demo</span>
        {view.scene ? <span className='text-muted'>· {view.scene}</span> : null}
      </div>
      <Objective />
      <section className='flex flex-col gap-3 rounded border border-line bg-surface p-4'>
        <div className='flex flex-row flex-wrap items-center gap-2'>
          <h2 className='text-lg font-medium grow'>Your party</h2>
          <Tooltip text={view.lineup.length === 0 ? 'the scene offers no ready-made party' : `fill the party with ${view.lineup.join(', ')}`}>
            <Button disabled={view.lineup.length === 0} onClick={preselect}>ready-made party</Button>
          </Tooltip>
          <Tooltip text={view.joinBar ?? 'into the fight'}>
            <Button weight='solid' tone='accent' disabled={view.joinBar !== null} onClick={join}>join</Button>
          </Tooltip>
        </div>
        <div className='flex flex-row flex-wrap gap-2'>
          {view.picks.map((p, i) => (
            <span key={`${p.key}-${i}`} className='inline-flex items-center gap-1 rounded border border-accent bg-accent/10 pl-3 pr-1 py-1.5'>
              {p.name}
              <IconButton icon={X} aria-label={`remove ${p.name}`} onClick={() => remove(i)} />
            </span>
          ))}
          {empty.map((_, i) => <span key={`empty-${i}`} className='rounded border border-dashed border-line px-3 py-1.5 text-muted'>empty</span>)}
        </div>
        {view.joinBar ? <span className='text-xs text-muted'>{view.joinBar}</span> : null}
      </section>
      <section className='flex flex-col gap-2'>
        <SectionLabel>characters</SectionLabel>
        {view.offered.length === 0 ? <span className='text-muted'>No characters are offered.</span> : null}
        <div className='grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2'>
          {view.offered.map((c) => (
            <button key={c.key} type='button' title={view.full ? 'the party is full' : undefined} aria-label={`add ${c.name} to the party`} disabled={view.full}
              onClick={() => add(c.key)}
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
// board in the middle, and along the bottom the active character's state,
// what they can do (or, before the fight, placing the party) and the log.
function DemoTable() {
  const { started, scene, back } = useDemoStage()
  const { view, seeHint } = useDemo()
  useBots({ auto: true, holdStart: !started })
  useContestClock()
  useSights()
  const hasActive = useHasActiveCharacter()
  const face = useActiveFace()
  const throwing = useTray().request !== null
  return (
    <div className='flex flex-col h-screen text-left text-sm'>
      <AutoThrow />
      <header className='flex flex-row flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 border-b border-line shrink-0'>
        <Home />
        <span className='text-muted'>{scene}</span>
        {started ? <Round /> : null}
        <CharacterList />
        <span className='grow' />
        <HelpButton />
        <Button size='xs' weight='ghost' title='back to picking the party' onClick={back}>restart game</Button>
      </header>
      <div className='relative flex-1 min-h-0 flex flex-col p-2'>
        <DemoSpace />
        <Result />
      </div>
      <div className='grid grid-cols-1 md:grid-cols-12 border-t border-line shrink-0 md:h-[30vh]'>
        <div className='md:col-span-3 p-2 flex flex-col gap-2 overflow-y-auto border-b md:border-b-0 md:border-r border-line'>
          {face ? <ActiveFace /> : hasActive ? <Status resourceEnd={<SurgeTile wide />} needs={false} bars /> : <span className='text-xs text-muted'>pick a character</span>}
        </div>
        <div className='md:col-span-5 p-2 flex flex-col gap-2 overflow-y-auto border-b md:border-b-0 md:border-r border-line'>
          {started ? <div className='flex flex-row flex-wrap gap-1 items-center'><FightButtons /></div> : null}
          {view.hint ? <HintLine hint={view.hint} onClose={() => { if (view.hint) seeHint(view.hint) }} /> : null}
          {started ? <FightActions /> : <Placing />}
        </div>
        <div className='md:col-span-4 p-2 flex flex-col gap-1 min-h-48 md:min-h-0'>
          {throwing ? <DiceTray /> : !started ? <Basics /> : <>
            <SectionLabel>Log</SectionLabel>
            <div className='flex-1 min-h-0 overflow-y-auto'><ActionLog /></div>
          </>}
        </div>
      </div>
    </div>
  )
}

function Round() {
  const { round } = useCombatState()
  return round > 0 ? <span className='text-xs text-muted whitespace-nowrap'>Round <span className='font-mono text-fg'>{round}</span></span> : null
}

// Before the fight: where the party goes, each member to pick and place, and
// the start, closed until everyone stands.
function Placing() {
  const { view, activeId, start, pick } = useDemo()
  const swatch = view.area === null ? null : SPAWN_SWATCH[view.area] ?? SPAWN_SWATCH[1]
  return (
    <div className='flex flex-col gap-3'>
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
      </div>
      <Tooltip text={view.startBar ?? 'the first round begins'} className='self-start'>
        <Button size='sm' weight='solid' tone='accent' disabled={view.startBar !== null} onClick={start} className='px-8 py-2 text-base'>START</Button>
      </Tooltip>
      {view.startBar ? <span className='text-xs text-muted'>{view.startBar}</span> : null}
    </div>
  )
}

// The round change while it runs, with the board in its place for as long as
// one of the visitor's characters takes the limit stress action they owe,
// opened from their card; the board otherwise.
function DemoSpace() {
  const { view } = useRoundChange()
  const [mapOf, setMapOf] = useState<number | null>(null)
  if (!view) return <><TurnBanner /><DemoBoard /></>
  if (view.stressTurn !== null && view.stressTurn.turn === mapOf) {
    return (
      <>
        <div><Button size='xs' onClick={() => setMapOf(null)}>back to the round change</Button></div>
        <TurnBanner />
        <DemoBoard />
      </>
    )
  }
  return <div className='flex-1 min-h-0 overflow-y-auto'><RoundChangePanel openMap={setMapOf} selfRun /></div>
}

const MODE_TEXT = {
  idle: 'click a token to pick it',
  path: 'click cells to walk the move',
  jump: 'click a cell to jump there',
  aim: 'click a cell to aim',
  locked: 'an action is open',
} as const

// The board with nothing but what a player of the fight clicks: cells,
// tokens and items, the turn of a move, the zoom and the view from the front.
function DemoBoard() {
  const look = useBoardLook()
  const { started } = useDemoStage()
  const { view, clickCell, clickToken, clickFloorItem, picked, turn } = useBoard(look, 'auto')
  const veil = useBoardVeil(view)
  const { setLit } = useLitCell(view, veil.setOver)
  const cellAt = useCellAt()
  const camera = useBoardCamera()
  const { space } = useBotsPaused()
  return (
    <div className='flex flex-col flex-1 min-h-0 gap-1'>
      <div className='flex flex-row flex-wrap items-center gap-1'>
        <span className={`text-xs ${view.mode === 'idle' ? 'text-muted' : 'text-accent'}`}>{started ? MODE_TEXT[view.mode] : 'click a cell to place the character picked'}</span>
        <span className='grow' />
        <IconButton icon={RotateCw} aria-label='turn' title='turn the move clockwise, or the character picked until the fight starts' onClick={() => turn(false)} />
        <Button size='xs' selected={look.front} aria-label='front view' title={look.front ? 'seen from the front. Click for the view from above' : 'seen from above. Click for the view from the front'} onClick={() => look.setFront(!look.front)}>{look.front ? 'front' : 'top'}</Button>
        <ZoomButtons camera={camera} />
      </div>
      <BoardCanvas className='w-full flex-1 min-h-0' label='board' view={view} veiled={veil.veiled} picked={picked} camera={camera} cellAt={cellAt} setLit={setLit} onSpace={started ? space : undefined}
        onCell={(cell) => clickCell(cell, null, false, 0)} onToken={clickToken} onFloorItem={clickFloorItem} />
      <ClickMenuHost />
    </div>
  )
}

const OUTCOME_TITLE: Record<DemoOutcome, string> = { won: 'Victory', lost: 'Defeat', draw: 'Nobody is left standing' }
const OUTCOME_TONE: Record<DemoOutcome, string> = { won: 'text-good', lost: 'text-bad', draw: 'text-muted' }
const FATE_TEXT: Record<DemoFate, string> = { standing: 'standing', surrendered: 'surrendered', down: 'collapsed', dead: 'dead' }

// How the fight ended, over the board: who won, how everyone came out of it,
// and the way back in.
function Result() {
  const { view, again, back } = useDemo()
  const [hidden, setHidden] = useState(false)
  if (!view.result) return null
  const { outcome, rows } = view.result
  if (hidden) return <Button className='absolute top-3 right-3 z-10' weight='solid' tone='accent' onClick={() => setHidden(false)}>{OUTCOME_TITLE[outcome]}: the result</Button>
  const side = (yours: boolean) => (
    <div className='flex flex-col gap-1 min-w-40'>
      <SectionLabel>{yours ? 'your party' : 'the foes'}</SectionLabel>
      {rows.filter((r) => r.yours === yours).map((r) => (
        <div key={r.id} className='flex flex-row gap-3 justify-between'>
          <span>{r.name}</span>
          <span className={r.fate === 'standing' ? 'text-good' : 'text-muted'}>{FATE_TEXT[r.fate]}</span>
        </div>
      ))}
    </div>
  )
  return (
    <div role='dialog' aria-label='result' className='absolute inset-0 z-10 flex items-center justify-center bg-bg/70'>
      <div className='flex flex-col gap-4 rounded border border-line bg-raised p-6 shadow-lg shadow-black/40 max-w-lg w-full mx-4'>
        <h2 className={`text-3xl font-semibold text-center ${OUTCOME_TONE[outcome]}`}>{OUTCOME_TITLE[outcome]}</h2>
        <div className='flex flex-row flex-wrap gap-6 justify-center'>
          {side(true)}
          {side(false)}
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
