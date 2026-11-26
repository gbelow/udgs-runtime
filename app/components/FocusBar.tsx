'use client'
import { useState } from 'react'
import { Play } from 'lucide-react'
import type { Gauges } from '../domain/character/lenses/bars'
import type { TargetRow } from '../domain/scene/projections/focus'
import { useOwnChips, useTargetRows } from '../hooks/useFocusBar'
import { SHADE_BG, shadeOf, type GaugeKey } from '../gaugeShades'
import { Button, SectionLabel } from './ui'

const KEYS: readonly GaugeKey[] = ['AP', 'STA', 'IL']

// A face's three gauges stacked small, as the tokens' arcs show them.
function MiniGauges({ gauges }: { gauges: Gauges }){
  return (
    <span className='inline-flex flex-col gap-px shrink-0' title={KEYS.map((k) => `${k} ${gauges[k].label}`).join(' · ')}>
      {KEYS.map((k) => (
        <span key={k} className='block w-6 h-1 rounded-sm bg-raised overflow-hidden'>
          <span className={`block h-full ${SHADE_BG[shadeOf(k, gauges[k].level)]}`} style={{ width: `${gauges[k].fill}%` }} />
        </span>
      ))}
    </span>
  )
}

// The characters the screen plays, by party, to pick one quickly while none
// of them is in play; the board looks at whoever is picked.
export function OwnChips(){
  const { parties, pick } = useOwnChips()
  if (!parties || parties.length === 0) return null
  return (
    <div className='flex flex-col gap-1 max-h-28 overflow-y-auto pr-1 shrink-0' aria-label='your characters'>
      {parties.map((p) => (
        <div key={p.id} className='flex flex-row flex-wrap items-center gap-1 min-w-0'>
          {p.name ? <SectionLabel>{p.name}</SectionLabel> : null}
          {p.cards.map((c) => (
            <Button key={c.id} size='xs' selected={c.isActive} aria-label={`pick ${c.name}`} title={`pick ${c.name}`}
              className={`inline-flex items-center gap-1.5 ${c.dead ? 'opacity-50' : ''}`} onClick={() => pick(c)}>
              {c.isInTurn ? <Play size={10} aria-hidden /> : null}
              <span className='max-w-[9rem] truncate'>{c.name}</span>
              <MiniGauges gauges={c.gauges} />
            </Button>
          ))}
        </div>
      ))}
    </div>
  )
}

const rowNote = (r: TargetRow) => [
  r.cells !== null ? `${r.cells} ${r.cells === 1 ? 'cell' : 'cells'}` : null,
  r.heard ? 'out of sight' : null,
  r.elsewhere ? 'another floor' : null,
].filter((s) => s !== null).join(' · ')

function TargetChip({ row, onPick }: { row: TargetRow; onPick: (row: TargetRow) => void }){
  const note = rowNote(row)
  const said = row.aim ? `aim at ${row.name}` : `look at ${row.name}`
  return (
    <Button size='xs' weight={row.aim ? 'solid' : row.heard ? 'ghost' : 'outline'} tone={row.aim ? 'accent' : row.ally ? 'neutral' : 'bad'} aria-label={said} title={said}
      className='inline-flex items-center gap-1.5' onClick={() => onPick(row)}>
      <span className='max-w-[9rem] truncate'>{row.name}</span>
      <MiniGauges gauges={row.gauge} />
      {note ? <span className='text-[10px] text-muted'>{note}</span> : null}
    </Button>
  )
}

// On a turn of one of the screen's characters with nothing open, or while one
// of theirs aims what they declare, whom the one it looks through perceives,
// foes first and the nearest first, the allies folded away unless one may be
// aimed at; a click has the board look at them, and aims at one it may.
export function TargetList(){
  const { rows, pick } = useTargetRows()
  const [allies, setAllies] = useState(false)
  if (!rows || rows.length === 0) return null
  const foes = rows.filter((r) => !r.ally)
  const friends = rows.filter((r) => r.ally && !r.aim)
  const aimed = rows.filter((r) => r.ally && r.aim)
  return (
    <div className='flex flex-col gap-1 shrink-0'>
      <div className='flex flex-row items-center gap-2'>
        <SectionLabel>in sight</SectionLabel>
        {friends.length > 0 ? <Button size='xs' weight='ghost' aria-pressed={allies} onClick={() => setAllies(!allies)}>{allies ? 'hide allies' : `allies (${friends.length})`}</Button> : null}
      </div>
      <div className='flex flex-row flex-wrap gap-1 max-h-28 overflow-y-auto pr-1'>
        {foes.length === 0 ? <span className='text-xs text-muted'>no foe perceived</span> : null}
        {foes.map((r) => <TargetChip key={r.id} row={r} onPick={pick} />)}
        {aimed.map((r) => <TargetChip key={r.id} row={r} onPick={pick} />)}
        {allies ? friends.map((r) => <TargetChip key={r.id} row={r} onPick={pick} />) : null}
      </div>
    </div>
  )
}
