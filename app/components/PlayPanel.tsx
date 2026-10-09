'use client'
import { useState } from 'react'
import { WeaponPanel } from './WeaponPanel';
import { AbilityPanel } from './AbilityPanel';
import { SpellPanel } from './SpellPanel';
import { ActionPanel } from './ActionPanel';
import { BoardPanel } from './BoardPanel';
import { CharacterSheet, SimpleResource } from './CharacterSheet';
import { makeDieRoll } from './utils';
import { Button, NumberInput, SectionLabel, TextInput, Tooltip, selectClass } from './ui';
import { useCombatRoster, useCombatState, usePartyPicker, useCombatSurgeOptions, useHeldTests, useMorale, useSocial, useTablePressure, useTurnControls } from '../hooks/useCombatState';
import { ROLL_MODES } from '../domain/play/dice';
import { useInjuryLens } from '../hooks/useinjuryLens';
import { useCharacterCommands } from '../hooks/useCharacterCommands';
import { useCombatCommands } from '../hooks/useCombatCommands';
import { useSustainedPanel } from '../hooks/useSustainedPanel';
import { usePartyCommands } from '../hooks/useParty';
import { useActiveCharacterData, useBindingSurge } from '../hooks/useCharacterData';


export function PlayPanel(){

  const { nextRound, resetCombat, killCharacter } = useCombatCommands()
  const { returnFromFight } = usePartyCommands()
  const { isCharacterDead } = useInjuryLens()
  const { round, hasActiveCharacter: isThereActiveCharacter, hasOpenAction, nextRoundBar, returnBar } = useCombatState()
  const { fightName } = useActiveCharacterData()

  const [dice10, setDice10] = useState(1)
  const [dice6, setDice6] = useState(1)
  const [etsTaken, setEtsTaken] = useState(0)

  return(
    <div className='flex flex-col text-left'>
      <div className='flex flex-row gap-2 items-center py-2 border-b border-line'>
        <span className='text-xs text-muted'>Round <span className='font-mono text-fg'>{round}</span></span>
        <CharacterList />
        <Button aria-label='nextRound' disabled={nextRoundBar !== null} title={nextRoundBar ?? undefined} onClick={nextRound}>{round === 0 ? 'start combat' : 'next round'}</Button>
        <span className='text-xs text-muted'>ETs taken</span>
        <NumberInput className='w-10' aria-label='ETs taken' value={etsTaken} onChange={(e) => setEtsTaken(parseInt(e.target.value) || 0)} />
        <Button aria-label='endCombat' disabled={returnBar !== null} title={returnBar ?? 'everyone back to the party'} onClick={() => { returnFromFight(etsTaken); setEtsTaken(0) }}>{round > 0 ? 'end combat' : 'back to party'}</Button>
        <Button aria-label='resetGame' variant='ghost' onClick={resetCombat}>reset</Button>
      </div>
      <MoralePanel />
      <HeldTestsPanel />
      {isThereActiveCharacter ? <SocialPanel /> : null}
      {
        isThereActiveCharacter ?
        <CharacterSheet
          header={<>
            <div className='flex flex-row flex-wrap gap-1.5 items-center'>
              <span className='text-base font-medium mr-2'>{fightName}</span>
              <TurnControl />
              <Button aria-label='roll' onClick={() => setDice10(makeDieRoll(10))}>d10 <span className='font-mono text-fg'>{dice10}</span></Button>
              <Button aria-label='roll' onClick={() => setDice6(makeDieRoll(6))}>d6 <span className='font-mono text-fg'>{dice6}</span></Button>
              <SurgeControl />
              <PartyControl />
            </div>
            <ActionPanel />
          </>}
          resources={<>
            <SimpleResource rssName={'AP'} />
            <SimpleResource rssName={'surgeAP'} />
          </>}
          injuryAction={<Button variant='bad' active={isCharacterDead} disabled={hasOpenAction} title={hasOpenAction ? 'an action is being played out' : undefined} className={isCharacterDead ? 'bg-bad/20' : ''} onClick={killCharacter}>{isCharacterDead ? 'dead' : 'kill'}</Button>}
          injuryPanels={<SustainedPanel />}
          asideTop={<BoardPanel />}
          asideMid={<WeaponPanel />}
          asideEnd={<>
            <AbilityPanel />
            <SpellPanel />
          </>}
        />
        : null
      }
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
  const { startTurn, toggleContest, toggleAgreeToEnd, rollContest, endTurn, toggleBreakage } = useCombatCommands()
  const { holder, inTurn, start, contesting, contest, contenders, roll, end, result, agreed, breakage, breakageBar, stealth } = useTurnControls()

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
    <div className='flex flex-row gap-3 grow overflow-x-auto'>
      {
        parties.map((party) =>
          <div key={party.id} className='flex flex-row gap-1.5 items-center'>
            {party.name ? <span className='text-[10px] text-muted whitespace-nowrap'>{party.name}</span> : null}
            {party.entries.map((entry) =>
              <Button key={entry.id} aria-label={entry.name}
                variant={entry.targetable ? 'bad' : entry.isActive ? 'primary' : 'default'}
                className={entry.targetable ? 'animate-pulse' : entry.isActive ? 'bg-accent/15' : ''}
                onClick={() => pick(entry)}>
                {entry.name}
                {entry.usedSurge ? <span className={`ml-1.5 text-[10px] ${entry.isActive ? 'text-accent/80' : 'text-muted'}`}>✓ {entry.usedSurge}</span> : null}
                {entry.surrendered ? <span className={`ml-1.5 text-[10px] ${entry.isActive ? 'text-accent/80' : 'text-muted'}`}>surrendered</span> : null}
                {entry.role && entry.role !== 'none' ? <span className='ml-1.5 text-[10px] text-muted'>{entry.role}</span> : null}
              </Button>
            )}
          </div>
        )
      }
    </div>
  )
}
