'use client'
import { useState } from 'react'
import { ActAs } from './ActAs';
import { resumeWalk } from '../hooks/useClickMenu';
import { ActionPanel } from './ActionPanel';
import { BoardPanel } from './BoardPanel';
import { ChasePanel, ChaseSaved, FollowPanel } from './ChasePanel';
import { Forfeits, RoundChangePanel } from './RoundChangePanel';
import { ChaseTrack } from './ChaseTrack';
import { Check, Dices, Play, Settings, Skull } from 'lucide-react'
import { ActionKey, Button, Dropdown, MenuConfirm, MenuItem, NumberInput, SectionLabel, Segment, Segmented, Tooltip } from './ui';
import { useEndScene, usePartyCommands, useTableParties } from '../hooks/useParty';
import { useActiveControlBar, useGmBar } from '../hooks/useControl';
import { ControlLocked, Locked } from './Locks';
import { useActiveFace, useBreakage, useCombatState, useSurgeViews, useMockery, useLeadership, useAgainstAllies, useHeldTests, useRoundChange, useTurnControls, useContestModes } from '../hooks/useCombatState';
import { useChase } from '../hooks/useChase';
import { useContestSeconds } from '../hooks/useContest';
import { useInjuryLens } from '../hooks/useinjuryLens';
import { useCharacterCommands } from '../hooks/useCharacterCommands';
import { useCombatCommands } from '../hooks/useCombatCommands';
import { useSustainedPanel } from '../hooks/useSustainedPanel';
import type { SurgeView } from '../domain/scene/projections/turn';
import { useBindingSurge, useHasActiveCharacter } from '../hooks/useCharacterData';
import { useSceneAnswer, useSceneCalls, useSceneDiceBar } from '../hooks/useSceneDice';
import { DieCalls, RollButtons } from './DieCalls';
import { useFollowOwing } from '../hooks/useFollowOwing';
import { BotsPause } from './BotsPause';
import { ContestBar } from './ContestBar';
import { EndRound } from './EndRound';
import { EndTurn } from './EndTurn';

// The scene's pieces of the run screen.

// The round and the turn and what moves them, kept to a strip so the middle
// has the height; who is in it is down the left of the board (`FacesColumn`).
export function SceneStrip(){
  return(
    <div className='flex flex-col'>
      <div className='flex flex-row flex-wrap gap-x-4 gap-y-1 items-center px-2 py-1.5'>
        <ActAs />
        <TableWaits />
        <Locked bar={useSceneDiceBar()} className='contents'>
          <FightEnd />
          <FightControls />
        </Locked>
        <TurnBar />
        <FightSettingsButton />
      </div>
    </div>
  )
}

function FightControls(){
  const { nextRound } = useCombatCommands()
  const { round, nextRoundBar, nextRoundClosing } = useCombatState()
  const forfeits = nextRoundBar === null && nextRoundClosing.length > 0

  return(
    <div className='flex flex-row flex-wrap gap-2 items-center'>
      <span className='text-xs text-muted whitespace-nowrap'>Round <span className='font-mono text-fg'>{round}</span></span>
      <Tooltip text={nextRoundBar ?? (round === 0 ? 'start the first round' : 'on to the next round')}>
        <Button aria-label='nextRound' tone={forfeits ? 'bad' : 'neutral'} disabled={nextRoundBar !== null} onClick={nextRound}>{round === 0 ? 'start combat' : 'next round'}</Button>
      </Tooltip>
      {nextRoundBar ? <span className='text-xs text-muted'>{nextRoundBar}</span> : null}
      {forfeits ? <Forfeits lines={nextRoundClosing} inline /> : null}
    </div>
  )
}

// Ending the scene, first in the strip.
function FightEnd(){
  return(
    <div className='flex flex-row gap-2 items-center'>
      <Dropdown label='end scene' text='end scene' title='end the rounds, send each party on, or throw the scene away'>
        {() => <EndSceneMenu />}
      </Dropdown>
    </div>
  )
}

function FightSettingsButton(){
  return(
    <div className='ml-auto'>
      <Dropdown label='fight settings' title='how the table plays this fight' icon={Settings}>
        {() => <FightSettings />}
      </Dropdown>
    </div>
  )
}

// What happens to the scene: the rounds end with everyone staying, each party
// that fought goes back to the campaign on its own (where exploring or
// downtime goes on), or the scene ends for everyone, keeping in the campaign
// only those made in it that the table picks.
function EndSceneMenu(){
  const { endCombat } = useCombatCommands()
  const { round, endCombatBar, returnBar } = useCombatState()
  const { parties, loose } = useTableParties()
  const { partyBack, back, endScene } = usePartyCommands()
  const { bar: endBar, made } = useEndScene()
  const gmBar = useGmBar()
  const [ets, setEts] = useState(0)
  const [keep, setKeep] = useState<string[]>([])
  const toggleKeep = (id: string) => setKeep(keep.includes(id) ? keep.filter((k) => k !== id) : [...keep, id])
  const leaving = parties.filter((p) => p.fighters.length > 0)
  const bar = returnBar ?? gmBar

  return(
    <div className='flex flex-col gap-1'>
      <SectionLabel>End scene</SectionLabel>
      {round > 0 ? <MenuItem bar={endCombatBar} hint='the rounds end; everyone stays in the scene' onClick={endCombat}>end combat, stay</MenuItem> : null}
      <SectionLabel>Back to the campaign</SectionLabel>
      {leaving.length === 0 && loose.fighters.length === 0 ? <span className='text-muted px-2'>nobody is in the scene</span> : null}
      {leaving.map((p) => (
        <MenuItem key={p.id} bar={bar} hint='the scene is over for the party' onClick={() => partyBack(p.id, ets)}>{p.name}</MenuItem>
      ))}
      {loose.fighters.map((card) => (
        <MenuItem key={card.id} bar={bar} hint='the scene is over for them' onClick={() => back(card.id, ets)}>{card.name}</MenuItem>
      ))}
      <label className='flex flex-row items-center gap-2 px-2 text-muted'>
        ETs the scene took
        <NumberInput className='w-10' aria-label='ETs taken' title='passed for each party when the last of it comes back' value={ets} onChange={(e) => setEts(parseInt(e.target.value) || 0)} />
      </label>
      <SectionLabel>End the scene</SectionLabel>
      {made.length > 0 ? <span className='text-muted px-2'>made in the scene: keep in the campaign?</span> : null}
      {made.map((m) => (
        <label key={m.id} className='flex flex-row items-center gap-2 px-2'>
          <input type='checkbox' aria-label={`keep ${m.name} in the campaign`} checked={keep.includes(m.id)} onChange={() => toggleKeep(m.id)} />{m.name}
        </label>
      ))}
      <MenuConfirm bar={gmBar ?? endBar} hint='everyone sent from the campaign goes back to it, with those kept; the rest made in the scene are gone' onConfirm={() => { endScene(keep.filter((id) => made.some((m) => m.id === id)), ets); setKeep([]) }}>end the scene</MenuConfirm>
    </div>
  )
}

// How the table plays this fight, apart from anything a character does.
function FightSettings(){
  const { toggleBreakage } = useCombatCommands()
  const breakage = useBreakage()
  const contest = useContestSeconds()

  return(
    <div className='flex flex-col gap-1'>
      <SectionLabel>Settings</SectionLabel>
      <Tooltip text={breakage ? 'gear can break: turn it off' : 'gear never breaks: turn it on'}>
        <Button size='xs' aria-label='breakage' aria-pressed={breakage} active={breakage} onClick={toggleBreakage}>
          equipment breakage: {breakage ? 'on' : 'off'}
        </Button>
      </Tooltip>
      <label className='flex flex-row items-center gap-2 text-xs' title='how long a turn just taken may be contested before anything is committed in it; 0 for no time: it may be contested until something is, and the GM rolls it'>
        seconds to contest a turn
        <NumberInput className='w-12' min={0} aria-label='seconds to contest' value={contest.seconds} onChange={(e) => contest.set(parseInt(e.target.value) || 0)} />
      </label>
      <label className='flex flex-row items-center gap-2 text-xs' title='how long after the first player asks to contest everyone has to say with whom; what is picked by then stands; 0 for no limit'>
        seconds to decide who contests
        <NumberInput className='w-12' min={0} aria-label='seconds to decide who contests' value={contest.decide} onChange={(e) => contest.setDecide(parseInt(e.target.value) || 0)} />
      </label>
    </div>
  )
}

// What the scene is played on: the round change while it runs, with the board
// in its place for as long as a character takes the limit stress action they
// owe, opened from their card and closed by the end of that turn; while a
// fight lives in the chase, the chase saved and frozen above the board the
// fight is played on; the chase's chain while it runs; the board otherwise;
// and whom the scene follows once a chase is over.
// At a table that runs itself (`selfRun`, the demo) the players say they are
// done with the round change's rest step, and the board carries only what a
// player of the fight clicks; `placing`: the party is still being put down.
export function SceneSpace({ selfRun = false, placing = false }: { selfRun?: boolean, placing?: boolean }){
  const chase = useChase()
  const { view } = useRoundChange()
  const [mapOf, setMapOf] = useState<number | null>(null)
  const board = <BoardPanel plain={selfRun} placing={placing} />
  if (view) {
    const onMap = chase.boardInPlay && view.stressTurn !== null && view.stressTurn.turn === mapOf
    return onMap ? (
      <>
        <div className='flex flex-row items-center gap-2 px-2 py-1'>
          <Button size='xs' onClick={() => setMapOf(null)}>back to the round change</Button>
        </div>
        {board}
      </>
    ) : <RoundChangePanel openMap={chase.boardInPlay ? setMapOf : null} selfRun={selfRun} />
  }
  return(
    <>
      <FollowPanel />
      {chase.saved ? <><ChaseSaved /><ChaseTrack /></> : chase.chasing ? <><ChaseTrack /><ChasePanel /></> : null}
      {chase.boardInPlay ? null : <BoardlessActions />}
      {chase.boardInPlay ? board : null}
    </>
  )
}

// The GM's button for killing the active character outright.
export function KillButton(){
  const { killCharacter } = useCombatCommands()
  const { isCharacterDead } = useInjuryLens()
  const { hasOpenAction } = useCombatState()
  return <Button tone='bad' icon={Skull} active={isCharacterDead} disabled={hasOpenAction} title={hasOpenAction ? 'an action is being played out' : undefined} onClick={killCharacter}>{isCharacterDead ? 'dead' : 'kill'}</Button>
}

// What a player presses on the turn, the round and the bots, whoever is picked.
export function FightButtons(){
  return <><EndTurn /><BotsPause /><EndRound /><ContestBar /></>
}

// What moves the turn, along the top bar: starting or contesting it for the
// character picked, with whose turn it is, ending it, the bots, the end of
// the round, the clock on a contest, and the way back to whoever the fight
// waits on, with the popover of what it waits on.
export function TurnBar(){
  const { waiting, pick } = useFollowOwing()
  const diceBar = useSceneDiceBar()
  const controlBar = useActiveControlBar()
  return(
    <div className='flex flex-row flex-wrap gap-2 items-center'>
      <Locked quiet bar={diceBar ?? controlBar} className='contents'>
        <TurnControl />
      </Locked>
      <FightButtons />
      {waiting ? <Button tone='accent' title={`pick ${waiting.name} and bring up what the fight waits on`} onClick={() => { pick(); resumeWalk() }}>the fight waits on {waiting.name}</Button> : null}
    </div>
  )
}

// What the character picked has to press beside their resources: a taunt
// for their mockery, a rally for their leadership, and whether they are
// offered reactions against their own party.
export function CharacterExtras(){
  return(
    <ControlLocked>
      <MockButton />
      <LeadershipButton />
      <AgainstAlliesSwitch />
    </ControlLocked>
  )
}

// With no board in play (a scene with no grid, a chase) there are no tokens
// to click: what the character picked declares, and whom at, is picked in
// the action panel.
function BoardlessActions(){
  const hasActive = useHasActiveCharacter()
  const face = useActiveFace()
  const diceBar = useSceneDiceBar()
  if (!hasActive || face) return null
  return <Locked bar={diceBar}><ControlLocked><ActionPanel /></ControlLocked></Locked>
}

// abilities.tex "Mockery": the active character mocks whoever their crit was
// against, or whoever just missed them, as a taunt, for its AP.
function MockButton(){
  const view = useMockery()
  const { mock } = useCombatCommands()
  if (!view) return null
  return (
    <div className='flex flex-row flex-wrap gap-1 items-center'>
      <Tooltip text={view.bar ?? `a taunt with +1, for ${view.AP} AP`}>
        <Button size='xs' aria-label='mock' disabled={view.bar !== null} onClick={mock}>{view.target ? `mock ${view.target}` : 'mock'}</Button>
      </Tooltip>
    </div>
  )
}

// Whether the active character is offered answers against their own party
// (an opportunity attack on an ally, guarding a foe from one) for the rest of
// the fight.
function AgainstAlliesSwitch(){
  const view = useAgainstAllies()
  const { againstAllies } = useCombatCommands()
  if (!view) return null
  return (
    <div className='flex flex-row flex-wrap gap-1 items-center'>
      <Tooltip text={view.bar ?? (view.on ? 'answers against their own party are offered: switch off to keep them from it' : 'answers against their own party are not offered: switch on to offer them for the rest of the fight')}>
        <Button size='xs' aria-label='against allies' aria-pressed={view.on} active={view.on} disabled={view.bar !== null} onClick={() => againstAllies(!view.on)}>
          against allies: {view.on ? 'on' : 'off'}
        </Button>
      </Tooltip>
    </div>
  )
}

// abilities.tex "Leadership": the active character rallies their team once
// everyone has rolled their morale test.
function LeadershipButton(){
  const view = useLeadership()
  const { leadershipRally } = useCombatCommands()
  if (!view) return null
  return (
    <div className='flex flex-row flex-wrap gap-1 items-center'>
      <Tooltip text={view.bar ?? `a rally for ${view.AP} AP`}>
        <Button size='xs' aria-label='leadership rally' disabled={view.bar !== null} onClick={leadershipRally}>rally</Button>
      </Tooltip>
    </div>
  )
}

// What the table waits on that no one action panel owns: the dice the scene
// has called for and the tests held for the round (combat.tex "Swimming"),
// behind one button in the top bar, lit while any is owed.
export function TableWaits(){
  const rows = useSceneCalls()
  const answer = useSceneAnswer()
  const held = useHeldTests()
  if (rows.length === 0 && held.length === 0) return null
  const owed = rows.some((r) => !r.result) || held.some((r) => !r.result)
  return (
    <Dropdown label='dice and held tests' text='rolls' lit={owed} title={owed ? 'dice or held tests are waiting to be rolled' : 'the dice and held tests of this round'}>
      {() => <div className='flex flex-col gap-2 max-w-[32rem]'><DieCalls rows={rows} answer={answer} /><HeldTestsPanel /></div>}
    </Dropdown>
  )
}

// spells.tex "Sustained Spells": what the character is holding, what it
// costs each round and to fire again, and who it links or binds them to.
export function SustainedPanel(){
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
  const { startTurn, toggleContest, contestMode, rollContest } = useCombatCommands()
  const { holder, inTurn, start, contesting, contest, contenders, contestMode: mode, roll, result, timed, stealth, duty } = useTurnControls()
  const modes = useContestModes()

  return(
    <div className='flex flex-col gap-0.5'>
      <div className='flex gap-1 items-center'>
        {
          inTurn ? null :
          <Tooltip text={start ?? 'start this turn for the active character'}>
            <ActionKey look='go' icon={Play} aria-label='startTurn' disabled={start !== null} onClick={startTurn}>start turn</ActionKey>
          </Tooltip>
        }
        {
          holder && !inTurn && !timed ?
          <Tooltip text={contesting ? 'stop contesting the turn' : contest ?? `contest ${holder}'s turn`}>
            <ActionKey look={contesting ? 'picked' : 'plain'} aria-label='contestTurn' aria-pressed={contesting} disabled={!contesting && contest !== null} onClick={toggleContest}>contest</ActionKey>
          </Tooltip> : null
        }
        {
          modes.length > 1 && (!timed || inTurn) ?
          <Segmented label='cunning mode for the contest'>
            {modes.map((m) => <Segment key={m} selected={m === mode} onClick={() => contestMode(m)}>{`cunning ${m}`}</Segment>)}
          </Segmented> : null
        }
        {
          contenders && !timed ?
          <Tooltip text={roll ?? 'everyone contesting and the holder roll cunning; the highest takes the turn'}>
            <ActionKey icon={Dices} aria-label='rollContest' disabled={roll !== null} onClick={rollContest}>roll contest</ActionKey>
          </Tooltip> : null
        }
        {holder ? <span className='text-sm font-semibold text-accent'>{holder}&apos;s turn{contenders ? <span className='font-normal text-fg'>, contested by {contenders}</span> : null}</span> : null}
      </div>
      {duty ? <span className='text-sm text-bad font-medium'>{duty}</span> : null}
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
            <RollButtons name={r.name} options={r.modes.map((mode) => ({ key: mode, label: `${r.kind} ${mode}` }))} onRoll={(mode, die) => rollHeld(r.id, r.kind, mode, die)} /> :
            <span className='text-xs text-muted'>{r.result}</span>
          }
        </div>
      ))}
    </div>
  )
}

// The action surge, one a round: a button for each, which opens what it does
// for the character before it is made; the one made stays lit until the round
// changes (combat.tex "Action surge": one per round).
export function SurgeTile({ wide = false }: { wide?: boolean }){
  const { endSurge } = useCharacterCommands()
  const options = useSurgeViews()
  const binding = useBindingSurge()

  return(
    <div role='group' aria-label='action surges' className={`flex flex-col items-start rounded border border-line bg-surface px-1.5 py-1 ${wide ? 'self-stretch' : 'max-w-80'}`}>
      <span className='text-[10px] text-muted'>surge</span>
      <div className='flex flex-row flex-wrap gap-1'>
        {options.map((option) => option.used
          ? <Button key={option.kind} size='xs' selected icon={Check} aria-label={option.kind + ' surge'} aria-pressed title={`${option.kind} surge used this round`} className='pointer-events-none'>{option.kind}</Button>
          : <Dropdown key={option.kind} label={option.kind + ' surge'} text={<span className={option.available ? '' : 'text-muted'}>{option.kind}</span>}>
              {(close) => <SurgeCard option={option} close={close} />}
            </Dropdown>)}
        {binding ? <Button size='xs' weight='subtle' aria-label='endSurge' title={`give up the ${binding} surge AP left, to do something it does not allow`} onClick={endSurge}>end surge</Button> : null}
      </div>
    </div>
  )
}

// What a surge does for the character, and the press that makes it.
function SurgeCard({ option, close }: { option: SurgeView, close: () => void }){
  const { actionSurge } = useCombatCommands()
  return (
    <div className='flex flex-col gap-1 max-w-72'>
      <span className='font-semibold'>{option.kind} surge{option.gives ? <span className='ml-2 font-mono font-normal'>{option.gives}</span> : null}</span>
      {option.rules.map((line) => <span key={line} className='text-muted'>{line}</span>)}
      <Tooltip text={option.bar}>
        <ActionKey look='go' aria-label={`make the ${option.kind} surge`} disabled={!option.available} onClick={() => { actionSurge(option.kind); close() }}>make the surge</ActionKey>
      </Tooltip>
    </div>
  )
}
