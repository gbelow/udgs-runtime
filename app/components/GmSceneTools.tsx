'use client'
import { useState } from 'react'
import { Button, NumberInput, SectionLabel, Tooltip, selectClass } from './ui'
import { useKeyMap } from '../hooks/useKeyMap'
import { keyLabel } from '../keys'
import { useBotsPauseSetting } from '../hooks/useBots'
import { useImpose } from '../hooks/useImpose'
import { useBreakFreeBar, useCowardBar } from '../hooks/useCombatState'
import { useChase } from '../hooks/useChase'
import { useGmFloorTools } from '../hooks/useBoard'
import { useCombatCommands } from '../hooks/useCombatCommands'
import { ExplosionFields } from './ExplosionFields'

// What the GM does to the scene that no character does, each starting a
// declaration aimed on the board or the roster like a character's action.
export function GmSceneTools(){
  const [testOpen, setTestOpen] = useState(false)
  const [triggersOpen, setTriggersOpen] = useState(false)
  const cowardBar = useCowardBar()
  const breakFreeBar = useBreakFreeBar()
  const { defaultToCoward, breakFree } = useCombatCommands()
  const pause = useBotsPauseSetting()
  const pauseKey = keyLabel(useKeyMap(), 'bots.pause')

  return(
    <div className='flex flex-col gap-1'>
      <div className='flex flex-row flex-wrap gap-1 items-center'>
        <SectionLabel>scene</SectionLabel>
        <Tooltip text='a test the GM asks of the characters picked, with what rides on it'>
          <Button size='xs' aria-label='gm test' selected={testOpen} onClick={() => setTestOpen(!testOpen)}>test</Button>
        </Tooltip>
        <Tooltip text="explosions and the items on the floor: pick one, then click the board">
          <Button size='xs' aria-label='gm triggers' selected={triggersOpen} onClick={() => setTriggersOpen(!triggersOpen)}>triggers</Button>
        </Tooltip>
        <Tooltip text={cowardBar ?? 'nobody for the active character to insult or negotiate with: they default to coward'}>
          <Button size='xs' aria-label='default to coward' disabled={cowardBar !== null} onClick={defaultToCoward}>default to coward</Button>
        </Tooltip>
        <Tooltip text={breakFreeBar ?? 'a command to the active character is a severe compulsion: they test insight or cunning against the DL that dominated them'}>
          <Button size='xs' aria-label='break free' disabled={breakFreeBar !== null} onClick={breakFree}>break free</Button>
        </Tooltip>
        <Tooltip text={pause.bar ?? (pause.open ? `anyone at the table may pause the bots: ${pauseKey} over the board, or the action bar` : 'only the GM may pause the bots, from the action bar')}>
          <Button size='xs' aria-label={`${pauseKey} pauses bots`} aria-pressed={pause.open} active={pause.open} disabled={pause.bar !== null} onClick={pause.toggle}>
            {pauseKey} pauses bots: {pause.open ? 'on' : 'off'}
          </Button>
        </Tooltip>
      </div>
      {testOpen ? <ImposePanel /> : null}
      {triggersOpen ? <FloorTriggers /> : null}
    </div>
  )
}

// The GM's tools for the floor of the board: an explosion set off at a cell,
// items laid on the floor, charged with an explosion, set off or taken away,
// each used by clicking the board once picked.
function FloorTriggers(){
  const { boardInPlay } = useChase()
  const { floorTool, setFloorTool, explosion, setExplosion, explosionOptions, item } = useGmFloorTools()
  const bar = boardInPlay ? null : 'no board: simulate a grid first'
  const tools = [
    { tool: 'put', label: 'item to ground', aria: 'gm item to ground', text: item ? 'put the item picked in the item catalog on each clicked cell' : 'pick an item in the item catalog first', off: !item },
    { tool: 'explode', label: 'explosion', aria: 'gm explosion', text: 'describe an explosion, then click the cell it goes off at; everyone it reaches may avoid it against the DL', off: false },
    { tool: 'charge', label: 'charge item', aria: 'gm charge item', text: 'describe an explosion, then click an item lying on the floor to charge it with it', off: false },
    { tool: 'setoff', label: 'set item off', aria: 'gm set item off', text: 'click a charged item lying on the floor to set its charge off where it lies', off: false },
    { tool: 'remove', label: 'item off ground', aria: 'gm item off ground', text: 'click an item lying on the floor to take it off the board', off: false },
  ] as const

  return(
    <div className='flex flex-col gap-1'>
      <div className='flex flex-row flex-wrap gap-1 items-center'>
        <SectionLabel>floor</SectionLabel>
        {tools.map((t) => (
          <Tooltip key={t.tool} text={bar ?? t.text}>
            <Button size='xs' aria-label={t.aria} selected={floorTool === t.tool} disabled={bar !== null || t.off}
              onClick={() => setFloorTool(floorTool === t.tool ? null : t.tool)}>{t.label}</Button>
          </Tooltip>
        ))}
      </div>
      {floorTool === 'explode' || floorTool === 'charge' ? <ExplosionFields draft={{ explosion, setExplosion, explosionOptions }} /> : null}
    </div>
  )
}

// The GM asks the characters picked for a test and says what rides on it
// first; each rolls their own die, and the degree decides how hard it lands.
function ImposePanel(){
  const { options, parties, picked, toggleParty, draft, set, DL, bar, impose } = useImpose()
  const names = parties.flatMap((p) => p.entries).filter((e) => picked.includes(e.id)).map((e) => e.name)
  const fall = draft.effect === 'fall'

  return(
    <div className='flex flex-col gap-1 text-xs'>
      <div className='flex flex-row flex-wrap gap-x-3 gap-y-1 items-center'>
        <span className='text-muted'>{names.length === 0 ? 'click who it falls on, down the faces or on the board' : `falls on ${names.join(', ')}`}</span>
        {parties.filter((p) => p.name).map((p) => (
          <Button key={p.id} size='xs' aria-label={`pick party ${p.name}`} onClick={() => toggleParty(p)}>{p.name}</Button>
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
