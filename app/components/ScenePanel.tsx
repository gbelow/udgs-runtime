'use client'
import { useState } from 'react'
import { ActionPanel } from './ActionPanel';
import { BoardPanel } from './BoardPanel';
import { ChasePanel } from './ChasePanel';
import { RoundChangePanel } from './RoundChangePanel';
import { Button, Dropdown, NumberInput, SectionLabel, Tooltip, selectClass } from './ui';
import { useImpose } from '../hooks/useImpose';
import { ControlLocked, Locked } from './Locks';
import { useBreakage, useCombatRoster, useCombatState, useCombatSurgeOptions, useCowardBar, useFollowControls, useHeldTests, useRoundChange, useTurnControls } from '../hooks/useCombatState';
import { useChase } from '../hooks/useChase';
import { useInjuryLens } from '../hooks/useinjuryLens';
import { useCharacterCommands } from '../hooks/useCharacterCommands';
import { useCombatCommands } from '../hooks/useCombatCommands';
import { useSustainedPanel } from '../hooks/useSustainedPanel';
import { useBindingSurge } from '../hooks/useCharacterData';
import { useSceneAnswer, useSceneCalls, useSceneDiceBar } from '../hooks/useSceneDice';
import { DieCalls, RollButtons } from './DieCalls';

// The scene's pieces of the run screen.

// The round and who is in it, kept to a strip so the middle has the height.
export function SceneStrip(){
  return(
    <div className='flex flex-col'>
      <div className='flex flex-row flex-wrap gap-x-4 gap-y-1 items-center px-2 py-1.5'>
        <Locked bar={useSceneDiceBar()} className='contents'>
          <FightControls />
          <CharacterList />
          <FightEnd />
        </Locked>
      </div>
    </div>
  )
}

function FightControls(){
  const { nextRound } = useCombatCommands()
  const { round, nextRoundBar } = useCombatState()

  return(
    <div className='flex flex-row gap-2 items-center'>
      <span className='text-xs text-muted whitespace-nowrap'>Round <span className='font-mono text-fg'>{round}</span></span>
      <Tooltip text={nextRoundBar ?? (round === 0 ? 'start the first round' : 'on to the next round')}>
        <Button aria-label='nextRound' disabled={nextRoundBar !== null} onClick={nextRound}>{round === 0 ? 'start combat' : 'next round'}</Button>
      </Tooltip>
      {nextRoundBar ? <span className='text-xs text-muted'>{nextRoundBar}</span> : null}
    </div>
  )
}

// Ending the fight, starting it over and how the table plays it, at the far
// right of the strip.
function FightEnd(){
  const { endCombat, resetCombat } = useCombatCommands()
  const { round, endCombatBar } = useCombatState()

  return(
    <div className='ml-auto flex flex-row gap-2 items-center'>
      {round > 0
        ? <Button aria-label='endCombat' disabled={endCombatBar !== null} title={endCombatBar ?? 'the rounds end; everyone stays'} onClick={endCombat}>end combat</Button>
        : null}
      <Button aria-label='resetGame' variant='ghost' onClick={resetCombat}>reset</Button>
      <Dropdown label='fight settings' variant='ghost' title='how the table plays this fight' text='⚙'>
        {() => <FightSettings />}
      </Dropdown>
    </div>
  )
}

// How the table plays this fight, apart from anything a character does.
function FightSettings(){
  const { toggleBreakage } = useCombatCommands()
  const breakage = useBreakage()

  return(
    <div className='flex flex-col gap-1'>
      <SectionLabel>Settings</SectionLabel>
      <Tooltip text={breakage ? 'gear can break: turn it off' : 'gear never breaks: turn it on'}>
        <Button size='xs' aria-label='breakage' aria-pressed={breakage} active={breakage} onClick={toggleBreakage}>
          equipment breakage: {breakage ? 'on' : 'off'}
        </Button>
      </Tooltip>
    </div>
  )
}

// What the scene is played on: the round change while it runs, the chase's
// chain while there is a chase, the board otherwise.
export function SceneSpace(){
  const chase = useChase([], 'combat')
  const { view } = useRoundChange()
  if (view) return <RoundChangePanel />
  if (chase.chasing) return <ChasePanel />
  return <BoardPanel />
}

// The GM's button for killing the active character outright.
export function KillButton(){
  const { killCharacter } = useCombatCommands()
  const { isCharacterDead } = useInjuryLens()
  const { hasOpenAction } = useCombatState()
  return <Button variant='bad' active={isCharacterDead} disabled={hasOpenAction} title={hasOpenAction ? 'an action is being played out' : undefined} className={isCharacterDead ? 'bg-bad/20' : ''} onClick={killCharacter}>{isCharacterDead ? 'dead' : 'kill'}</Button>
}

// The turn, the surges and the actions; the tests held for the round wait
// behind their own button until wanted, lit while one is owed. Morale and
// starting a chase belong to the round change.
export function SceneActions(){
  const [heldOpen, setHeldOpen] = useState(false)
  const held = useHeldTests()
  const due = held.some((r) => !r.result)
  const diceBar = useSceneDiceBar()

  return(
    <>
      <SceneCalls />
      <Locked bar={diceBar}>
      <ControlLocked>
        <TurnControl />
        <div className='flex flex-row flex-wrap gap-1 items-center'>
          <SectionLabel>surge</SectionLabel>
          <SurgeControl />
        </div>
        <FollowControl />
      </ControlLocked>
      {held.length > 0 ? (
        <div className='flex flex-row flex-wrap gap-1 items-center'>
          <Button size='xs' aria-label='drawer held tests' variant={due ? 'bad' : 'default'} selected={heldOpen} onClick={() => setHeldOpen(!heldOpen)}>
            held tests{due ? ' !' : ''}
          </Button>
        </div>
      ) : null}
      {heldOpen ? <HeldTestsPanel /> : null}
      <ActionPanel />
      </Locked>
    </>
  )
}

// The dice the scene has called for, waiting on the table.
function SceneCalls(){
  const rows = useSceneCalls()
  const answer = useSceneAnswer()
  return <DieCalls rows={rows} answer={answer} />
}

// What the GM does to the scene that no character does, each starting a
// declaration aimed on the board or the roster like a character's action.
const GM_TOOLS = [
  { label: 'explosion', title: 'an explosion where the GM aims it' },
  { label: 'triggers', title: "fire one of the scene's triggers" },
] as const

export function GmSceneTools(){
  const [testOpen, setTestOpen] = useState(false)
  const cowardBar = useCowardBar()
  const { defaultToCoward } = useCombatCommands()

  return(
    <div className='flex flex-col gap-1'>
      <div className='flex flex-row flex-wrap gap-1 items-center'>
        <SectionLabel>scene</SectionLabel>
        <Tooltip text='a test the GM asks of the characters picked, with what rides on it'>
          <Button size='xs' aria-label='gm test' selected={testOpen} onClick={() => setTestOpen(!testOpen)}>test</Button>
        </Tooltip>
        {GM_TOOLS.map((t) => (
          <Tooltip key={t.label} text={`${t.title} — not built yet`}>
            <Button size='xs' aria-label={`gm ${t.label}`} disabled>{t.label}</Button>
          </Tooltip>
        ))}
        <Tooltip text={cowardBar ?? 'nobody for the active character to insult or negotiate with: they default to coward'}>
          <Button size='xs' aria-label='default to coward' disabled={cowardBar !== null} onClick={defaultToCoward}>default to coward</Button>
        </Tooltip>
      </div>
      {testOpen ? <ImposePanel /> : null}
    </div>
  )
}

// The GM asks the characters picked for a test and says what rides on it
// first; each rolls their own die, and the degree decides how hard it lands.
function ImposePanel(){
  const { options, parties, picked, toggle, toggleParty, draft, set, DL, bar, impose } = useImpose()
  const fall = draft.effect === 'fall'

  return(
    <div className='flex flex-col gap-1 text-xs'>
      <div className='flex flex-row flex-wrap gap-x-3 gap-y-1 items-center'>
        {parties.map((p) => (
          <div key={p.id} className='flex flex-row flex-wrap gap-x-2 items-center'>
            {p.name ? <Button size='xs' aria-label={`pick party ${p.name}`} onClick={() => toggleParty(p)}>{p.name}</Button> : null}
            {p.entries.map((e) => (
              <label key={e.id} className='flex gap-1 items-center'>
                <input type='checkbox' aria-label={`pick ${e.name}`} checked={picked.includes(e.id)} onChange={() => toggle(e.id)} />
                {e.name}
              </label>
            ))}
          </div>
        ))}
      </div>
      <div className='flex flex-row flex-wrap gap-x-2 gap-y-1 items-center'>
        <select className={selectClass} aria-label='effect' value={draft.effect} onChange={(e) => set({ effect: e.target.value as typeof draft.effect })}>
          {options.effects.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        {draft.effect === 'damage' ? (
          <>
            <NumberInput className='w-10' aria-label='damage' value={draft.amount} onChange={(e) => set({ amount: Number(e.target.value) })} />
            <select className={selectClass} aria-label='damage kind' value={draft.damageKind} onChange={(e) => set({ damageKind: e.target.value as typeof draft.damageKind })}>
              {options.damageKinds.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </>
        ) : null}
        {draft.effect === 'affliction' ? (
          <select className={selectClass} aria-label='affliction' value={draft.affliction} onChange={(e) => set({ affliction: e.target.value as typeof draft.affliction })}>
            {options.afflictions.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        ) : null}
        {draft.effect === 'cost' ? (
          <>
            AP <NumberInput className='w-10' aria-label='AP lost' value={draft.AP} onChange={(e) => set({ AP: Number(e.target.value) })} />
            STA <NumberInput className='w-10' aria-label='STA lost' value={draft.STA} onChange={(e) => set({ STA: Number(e.target.value) })} />
          </>
        ) : null}
        {fall ? <>height <NumberInput className='w-10' aria-label='fall height' value={draft.height} onChange={(e) => set({ height: Number(e.target.value) })} /> m</> : null}
        {fall ? <span className='text-muted'>Balance test vs DL {DL}</span> : (
          <>
            <select className={selectClass} aria-label='test skill' value={draft.skill ?? ''} onChange={(e) => set({ skill: (e.target.value || null) as typeof draft.skill })}>
              <option value=''>no test</option>
              {options.skills.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            {DL !== null ? <>DL <NumberInput className='w-10' aria-label='test DL' value={draft.DL} onChange={(e) => set({ DL: Number(e.target.value) })} /></> : null}
          </>
        )}
        <Tooltip text={bar ?? 'lay it on the characters picked'}>
          <Button size='xs' aria-label='impose' disabled={bar !== null} onClick={impose}>ask</Button>
        </Tooltip>
      </div>
    </div>
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
          <Button aria-label='agreeToEnd' aria-pressed={agreed} selected={agreed} onClick={toggleAgreeToEnd}>
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
            <RollButtons name={r.name} options={r.modes.map((mode) => ({ key: mode, label: `${r.kind} ${mode}` }))} onRoll={(mode, die) => rollHeld(r.id, r.kind, mode, die)} /> :
            <span className='text-xs text-muted'>{r.result}</span>
          }
        </div>
      ))}
    </div>
  )
}

// combat.tex "Follow": whom the active character follows this round, marked in
// their own turn.
function FollowControl(){
  const { follow } = useCombatCommands()
  const { marked, options } = useFollowControls()
  if (options.length === 0) return null

  return(
    <div className='flex flex-row flex-wrap gap-1 items-center'>
      <SectionLabel>follow</SectionLabel>
      {options.map((o) => (
        <Tooltip key={o.id} text={o.bar ?? (marked === o.id ? `stop following ${o.name}` : `follow ${o.name} when they move`)}>
          <Button size='xs' aria-label={`follow ${o.name}`} aria-pressed={marked === o.id} active={marked === o.id}
            disabled={marked !== o.id && o.bar !== null} onClick={() => follow(marked === o.id ? null : o.id)}>{o.name}</Button>
        </Tooltip>
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
              <Button aria-label={option.kind + ' surge'} aria-pressed selected className='pointer-events-none'>
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
                variant={entry.targetable ? 'bad' : 'default'} selected={!entry.targetable && entry.isActive}
                className={entry.targetable ? 'animate-pulse' : ''}
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
