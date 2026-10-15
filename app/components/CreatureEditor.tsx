'use client'

import { useState } from 'react'
import { Button, Combobox, NumberInput, Panel, Row, SectionLabel, StatTile, TextInput, Tiles, selectClass } from './ui'
import { useNaturalWeapons } from '../hooks/useRace'
import { useBodyEditor, useBodyView, useFootprintEditor } from '../hooks/useBodyEditor'
import { useActiveCharacterDataLens } from '../hooks/useCharacterDataLens'
import { AfflictionKeySchema, type AfflictionKey, type BodyPart, type HitLocation, type Material, type PartFlag, type WoundEffect } from '../domain/types'
import { FOOTPRINT_PRESETS, HIT_LOCATIONS, MATERIALS, PART_FLAGS, WOUND_EFFECTS } from '../domain/lists'

// What a race sets on a creature, edited the same way while the race is being
// made and, in free creation, on the character afterwards.
function DataDial({ stat }: { stat: Parameters<typeof useActiveCharacterDataLens>[0] }) {
  const [value, setValue] = useActiveCharacterDataLens(stat)
  return <StatTile label={stat} value={value} onChange={setValue} />
}

export function Creature() {
  const view = useBodyView()
  const { editStance } = useBodyEditor()
  if (!view) return null
  return (
    <div className='flex flex-col gap-1'>
      <SectionLabel>Creature</SectionLabel>
      <div className='flex flex-row flex-wrap gap-3 items-end'>
        <Tiles>
          <DataDial stat='size' />
          <DataDial stat='height' />
          <DataDial stat='TGH' />
          <StatTile label='lame at' title='legs lost or broken before lame' value={view.stance.lameAt} onChange={(v) => editStance({ lameAt: v })} />
          <StatTile label='prone at' title='legs lost or broken before unable to stand' value={view.stance.proneAt} onChange={(v) => editStance({ proneAt: v })} />
        </Tiles>
      </div>
      <p className='text-xs text-muted'>
        Legs lost or broken: lame from {view.stance.lameAt}, prone (unable to stand) from {view.stance.proneAt}.
      </p>
      <Footprint />
    </div>
  )
}

// creating.tex "Size and Space Occupation": the cells the creature covers,
// drawn facing right. A click on a cell adds it or takes it off; with a part
// picked, a click on a covered cell pins the part there, and "whole body"
// spreads it over every cell.
function Footprint() {
  const view = useFootprintEditor()
  const { toggleCell, setPreset, placePart } = useBodyEditor()
  const [placing, setPlacing] = useState<string | null>(null)
  if (!view) return null
  return (
    <div className='flex flex-row flex-wrap gap-3 items-start'>
      <svg viewBox={view.viewBox} className='w-48 select-none' role='img' aria-label='footprint'>
        {view.cells.map((cell) => {
          const clickable = placing ? cell.covered : cell.toggles
          const onClick = placing ? () => { placePart(placing, cell.cell); setPlacing(null) } : () => toggleCell(cell.cell)
          return (
            <g key={cell.key} transform={`translate(${cell.x} ${cell.y})`} className={clickable ? 'cursor-pointer' : undefined} onClick={clickable ? onClick : undefined}>
              <title>{[cell.anchor ? 'anchor' : null, ...cell.parts.map((p) => p.name)].filter((s) => s !== null).join(' · ') || cell.key}</title>
              <polygon points={view.hex} strokeWidth={cell.anchor ? 0.12 : 0.06}
                className={`${cell.covered ? 'fill-accent/25' : 'fill-transparent'} ${cell.anchor ? 'stroke-accent' : 'stroke-line'} ${clickable ? 'hover:stroke-fg' : ''}`} />
              {cell.parts.map((p, i) => (
                <text key={p.id} y={(i - (cell.parts.length - 1) / 2) * 0.38} textAnchor='middle' dominantBaseline='central' className='fill-fg pointer-events-none' fontSize={0.3}>{p.name}</text>
              ))}
            </g>
          )
        })}
      </svg>
      <div className='flex flex-col gap-1 text-xs'>
        <div className='text-muted'>faces → · size suggests {view.suggested} {view.suggested === 1 ? 'cell' : 'cells'} · has {view.count}</div>
        <div className='flex flex-row gap-1 items-center'>
          <span className='text-muted'>reset to</span>
          {FOOTPRINT_PRESETS.map((preset) => <Button key={preset} size='xs' onClick={() => setPreset(preset)}>{preset}</Button>)}
        </div>
        <div className='text-muted'>whole body: {view.spread.map((p) => p.name).join(', ') || 'nothing'}</div>
        <div className='flex flex-row flex-wrap gap-1 items-center'>
          <span className='text-muted'>place</span>
          {view.parts.map((p) => (
            <Button key={p.id} size='xs' variant='ghost' active={placing === p.id} aria-pressed={placing === p.id} title={`${p.name} at ${p.cell ?? 'the whole body'}`}
              onClick={() => setPlacing(placing === p.id ? null : p.id)}>{p.name}</Button>
          ))}
          {placing ? <Button size='xs' onClick={() => { placePart(placing, null); setPlacing(null) }}>whole body</Button> : null}
        </div>
      </div>
    </div>
  )
}

function ArmorNumber({ field, value, onChange }: { field: string, value: number, onChange: (v: number) => void }) {
  return (
    <label className='flex flex-col gap-px text-[10px] text-muted'>
      {field}
      <NumberInput className='w-14 py-0.5 text-sm' aria-label={`natural armor ${field}`} value={value} onChange={(e) => onChange(parseInt(e.target.value) || 0)} />
    </label>
  )
}

// gear.tex "Armors": what the creature is under anything it wears.
export function NaturalArmor() {
  const view = useBodyView()
  const { editArmor } = useBodyEditor()
  if (!view) return null
  const { armor } = view
  return (
    <Panel title='Natural armor'>
      <div className='flex flex-row flex-wrap gap-2 items-end'>
        <TextInput className='w-28' aria-label='natural armor name' value={armor.name} onChange={(e) => editArmor({ name: e.target.value })} />
        <select aria-label='natural armor material' className={selectClass} value={armor.material} onChange={(e) => editArmor({ material: e.target.value as Material })}>
          {MATERIALS.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <ArmorNumber field='PROT' value={armor.protection} onChange={(v) => editArmor({ protection: v })} />
        <ArmorNumber field='RES' value={armor.RES} onChange={(v) => editArmor({ RES: v })} />
        <ArmorNumber field='INS' value={armor.INS} onChange={(v) => editArmor({ INS: v })} />
        <ArmorNumber field='deflection' value={armor.deflection} onChange={(v) => editArmor({ deflection: v })} />
      </div>
    </Panel>
  )
}

// combat.tex "Localized damage": each place of the body, what aiming at it
// does and the wounds it takes.
export function BodyEditor() {
  const view = useBodyView()
  const { addPart } = useBodyEditor()
  const [location, setLocation] = useState<HitLocation>('other')
  if (!view) return null
  return (
    <Panel title='Body' actions={
      <>
        <select aria-label='new part kind' className={selectClass} value={location} onChange={(e) => setLocation(e.target.value as HitLocation)}>
          {HIT_LOCATIONS.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <Button size='xs' onClick={() => addPart(location)}>+ part</Button>
      </>
    }>
      {view.body.map((part) => <PartEditor key={part.id} part={part} />)}
    </Panel>
  )
}

function PartEditor({ part }: { part: BodyPart }) {
  const { editPart, removePart, addWound } = useBodyEditor()
  const naturalWeapons = useNaturalWeapons()
  const toggleFlag = (flag: PartFlag, on: boolean) =>
    editPart(part.id, { flags: on ? [...part.flags, flag] : part.flags.filter((f) => f !== flag) })
  return (
    <div className='flex flex-col gap-1 rounded border border-line p-1.5 text-xs'>
      <div className='flex flex-row flex-wrap gap-2 items-center'>
        <TextInput className='w-28' aria-label='part name' value={part.name} onChange={(e) => editPart(part.id, { name: e.target.value })} />
        <select aria-label={`${part.name} kind`} className={selectClass} value={part.location} onChange={(e) => editPart(part.id, { location: e.target.value as HitLocation })}>
          {HIT_LOCATIONS.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <label className='flex flex-row items-center gap-1 text-muted'>
          <input type='checkbox' className='accent-accent' checked={part.grip} onChange={(e) => editPart(part.id, { grip: e.target.checked })} />grips
        </label>
        <select aria-label={`${part.name} climbs`} className={selectClass} value={part.climbs === undefined ? '' : String(part.climbs)}
          onChange={(e) => editPart(part.id, { climbs: e.target.value === '' ? undefined : e.target.value === 'true' })}>
          <option value=''>climbs if a hand</option>
          <option value='true'>climbs</option>
          <option value='false'>does not climb</option>
        </select>
        <Combobox aria-label={`${part.name} natural weapon`} placeholder='natural weapon' className='w-28 text-xs'
          value={part.naturalWeapon} options={naturalWeapons} onChange={(naturalWeapon) => editPart(part.id, { naturalWeapon })} />
        <span className='ml-auto' />
        <Button size='xs' variant='ghost' aria-label={`remove ${part.name}`} onClick={() => removePart(part.id)}>remove</Button>
      </div>
      <div className='flex flex-row flex-wrap gap-2 items-center'>
        <label className='flex flex-row items-center gap-1 text-muted'>aim −
          <NumberInput className='w-12 py-0.5' aria-label={`${part.name} aim penalty`} value={part.aimPenalty} onChange={(e) => editPart(part.id, { aimPenalty: parseInt(e.target.value) || 0 })} />
        </label>
        <label className='flex flex-row items-center gap-1 text-muted'>max tier
          <NumberInput className='w-12 py-0.5' aria-label={`${part.name} max tier`} placeholder='—' value={part.maxTier ?? ''}
            onChange={(e) => editPart(part.id, { maxTier: e.target.value === '' ? null : parseInt(e.target.value) || 0 })} />
        </label>
        {PART_FLAGS.map((flag) => (
          <label key={flag} className='flex flex-row items-center gap-1 text-muted'>
            <input type='checkbox' className='accent-accent' checked={part.flags.includes(flag)} onChange={(e) => toggleFlag(flag, e.target.checked)} />{flag}
          </label>
        ))}
      </div>
      {part.wounds.map((wound, i) => <WoundEditor key={i} part={part} index={i} />)}
      <div><Button size='xs' variant='ghost' onClick={() => addWound(part.id)}>+ wound</Button></div>
    </div>
  )
}

// combat.tex "Wounds": a wound the part takes and the tier that causes it.
function WoundEditor({ part, index }: { part: BodyPart, index: number }) {
  const { editWound, removeWound } = useBodyEditor()
  const wound = part.wounds[index]
  const label = `${part.name} wound ${wound.name}`
  return (
    <Row>
      <TextInput className='w-28' aria-label={`${label} name`} value={wound.name} onChange={(e) => editWound(part.id, index, { name: e.target.value })} />
      <label className='flex flex-row items-center gap-1 text-muted'>T
        <NumberInput className='w-10 py-0.5' aria-label={`${label} tier`} min={0} value={wound.tier} onChange={(e) => editWound(part.id, index, { tier: Math.max(0, parseInt(e.target.value) || 0) })} />
      </label>
      <label className='flex flex-row items-center gap-1 text-muted'>
        <input type='checkbox' className='accent-accent' checked={wound.smash} onChange={(e) => editWound(part.id, index, { smash: e.target.checked })} />smash
      </label>
      <select aria-label={`${label} effect`} className={selectClass} value={wound.effect} onChange={(e) => editWound(part.id, index, { effect: e.target.value as WoundEffect })}>
        {WOUND_EFFECTS.map((effect) => <option key={effect} value={effect}>{effect}</option>)}
      </select>
      {wound.effect === 'disable' ?
        <>
          <label className='flex flex-row items-center gap-1 text-muted'>heal
            <NumberInput className='w-12 py-0.5' aria-label={`${label} heal`} value={wound.heal} onChange={(e) => editWound(part.id, index, { heal: parseInt(e.target.value) || 0 })} />
          </label>
          <select aria-label={`${label} affliction`} className={selectClass} value={wound.affliction ?? ''}
            onChange={(e) => editWound(part.id, index, { affliction: (e.target.value || null) as AfflictionKey | null })}>
            <option value=''>no affliction</option>
            {AfflictionKeySchema.options.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </> : null}
      <TextInput className='w-28' aria-label={`${label} consequence`} placeholder='consequence' value={wound.consequence} onChange={(e) => editWound(part.id, index, { consequence: e.target.value })} />
      <button type='button' aria-label={`remove ${label}`} className='ml-auto text-muted hover:text-bad cursor-pointer' onClick={() => removeWound(part.id, index)}>×</button>
    </Row>
  )
}
