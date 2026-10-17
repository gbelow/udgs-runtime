'use client'
import { useState } from 'react'
import { useJournal, usePlacement, useTimelineChart } from '../hooks/useCampaign'
import { useRole } from '../hooks/useRole'
import { Button, inputClass, selectClass } from './ui'
import { Entry } from './Journal'
import type { TimelineChart, TimelineLane } from '../domain/campaign/projections/timelineChart'

// A moment of a lane, picked to read what happened there and to write to it.
type Moment = { party: string | null, name: string, clock: number, when: string }

// The timelines of the parties on one: those in it run to their now, a frozen
// one stops where it was. What was recorded or written is a dot where it
// happened; pressing one, or a party's now, opens that moment, where a note
// can be attached to it. The GM places a party on the timeline at a moment.
export function CampaignTimeline() {
  const chart = useTimelineChart()
  const { gmTools } = useRole()
  const [moment, setMoment] = useState<Moment | null>(null)
  const [adding, setAdding] = useState(false)

  return (
    <div className='flex flex-col gap-2'>
      <div className='flex flex-row gap-2 items-center'>
        <span className='text-xs text-muted'>
          {chart.running.length > 0 ? <>time is passing for <span className='text-good'>{chart.running.join(', ')}</span></> : 'no party is in the timeline: no time is passing'}
        </span>
        {gmTools && chart.parties.length > 0 ? <Button size='xs' className='ml-auto' selected={adding} aria-pressed={adding} onClick={() => setAdding(!adding)}>add a party</Button> : null}
      </div>
      {chart.started ? null : <StartTimeline chart={chart} />}
      {adding ? <PlaceParty chart={chart} done={() => setAdding(false)} /> : null}
      <div className='flex flex-col gap-1 overflow-x-auto'>
        <div className='flex flex-row gap-2 items-end min-w-[32rem]'>
          <span className='w-36 shrink-0' />
          <div className='relative grow h-4'>
            {chart.ticks.map((t) => <span key={t.label} className='absolute -translate-x-1/2 text-[10px] text-muted' style={{ left: `${t.at}%` }}>{t.label}</span>)}
          </div>
        </div>
        {chart.lanes.map((lane) => <Lane key={lane.id ?? ''} lane={lane} ticks={chart.ticks} moment={moment} pick={setMoment} />)}
        {chart.lanes.length === 0 ? <span className='text-xs text-muted'>no party is on a timeline yet</span> : null}
      </div>
      {moment ? <MomentPanel key={`${moment.party}:${moment.clock}`} moment={moment} close={() => setMoment(null)} /> : null}
    </div>
  )
}

function Lane({ lane, ticks, moment, pick }: { lane: TimelineLane, ticks: { at: number, label: string }[], moment: Moment | null, pick: (m: Moment | null) => void }) {
  const here = (clock: number) => moment?.party === lane.id && moment.clock === clock
  const line = lane.status === 'running' ? 'bg-good' : 'border-t-2 border-dashed border-muted'
  const tone = lane.status === 'running' ? 'text-good' : 'text-muted'
  return (
    <div className='flex flex-row gap-2 items-center min-w-[32rem]'>
      <div className='w-36 shrink-0 flex flex-col leading-tight'>
        <span className='text-sm truncate'>{lane.name}</span>
        {lane.status ? <span className={`text-[10px] ${tone}`}>{lane.status === 'running' ? 'in the timeline' : 'frozen'} · {lane.nowLabel}</span> : null}
      </div>
      <div className='relative grow h-8 bg-surface rounded'>
        {ticks.map((t) => <span key={t.label} className='absolute top-0 bottom-0 border-l border-line' style={{ left: `${t.at}%` }} />)}
        {lane.lived ? <span className={`absolute top-1/2 h-0.5 ${line}`} style={{ left: `${lane.lived.from}%`, width: `${lane.lived.width}%` }} /> : null}
        {lane.marks.map((m) => {
          const picked = here(m.clock)
          return (
            <button key={m.clock} type='button' aria-label={`${lane.name} ${m.when}`}
              title={`${m.when}: ${m.entries.map((e) => e.title || e.kind).join(', ')}`}
              className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 min-w-3 h-3 px-0.5 rounded-full border text-[8px] leading-none cursor-pointer ${picked ? 'bg-accent border-accent text-bg' : m.entries.some((e) => e.note) ? 'bg-bg border-accent' : 'bg-bg border-muted'}`}
              style={{ left: `${m.at}%` }}
              onClick={() => pick(picked ? null : { party: lane.id, name: lane.name, clock: m.clock, when: m.when })}>
              {m.entries.length > 1 ? m.entries.length : ''}
            </button>
          )
        })}
        {lane.now !== null && lane.nowClock !== null ? (
          <button type='button' aria-label={`${lane.name} now`} title={`${lane.name}: ${lane.nowLabel}, press to write a note here`}
            className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 text-xs cursor-pointer ${here(lane.nowClock) ? 'text-accent' : tone}`} style={{ left: `${lane.now}%` }}
            onClick={() => lane.nowClock !== null && pick(here(lane.nowClock) ? null : { party: lane.id, name: lane.name, clock: lane.nowClock, when: lane.nowLabel })}>
            {lane.status === 'running' ? '▶' : '❚❚'}
          </button>
        ) : null}
      </div>
    </div>
  )
}

// What happened at a moment of a lane, and a note to attach to it.
function MomentPanel({ moment, close }: { moment: Moment, close: () => void }) {
  const { view, edit, remove, write } = useJournal('all')
  const { gmTools } = useRole()
  const [text, setText] = useState('')
  const [gmOnly, setGmOnly] = useState(false)
  const shown = view.flatMap((g) => g.entries).filter((e) => e.party === moment.party && e.clock === moment.clock)
  const attach = () => { write(moment.party, text, gmOnly, moment.clock); setText('') }
  return (
    <div className='flex flex-col gap-1 border border-line rounded p-2'>
      <div className='flex flex-row items-center gap-2 text-xs'>
        <span className='text-sm'>{moment.name}</span>
        <span className='text-muted'>{moment.when}</span>
        <Button size='xs' variant='ghost' className='ml-auto' aria-label='close moment' onClick={close}>×</Button>
      </div>
      {shown.length === 0 ? <span className='text-xs text-muted'>nothing written here yet</span> : null}
      {shown.map((e) => <Entry key={e.id} entry={e} gmTools={gmTools} edit={edit} remove={remove} />)}
      <textarea aria-label='note at this moment' rows={2} className={`${inputClass} text-sm`} placeholder='attach a note to this moment' value={text} onChange={(e) => setText(e.target.value)} />
      <div className='flex flex-row gap-2 items-center'>
        {gmTools ? (
          <label className='text-xs text-muted flex items-center gap-1'>
            <input type='checkbox' aria-label='GM only' checked={gmOnly} onChange={(e) => setGmOnly(e.target.checked)} />GM only
          </label>
        ) : null}
        <Button size='xs' variant='primary' className='ml-auto' disabled={text.trim() === ''} onClick={attach}>attach</Button>
      </div>
    </div>
  )
}

// Before any party is on the timeline the campaign has not started: the GM
// starts it from the Parties tab by clicking the party to start it with.
function StartTimeline({ chart }: { chart: TimelineChart }) {
  return (
    <div className='flex flex-row flex-wrap gap-2 items-center'>
      <span className='text-xs text-bad'>The campaign has not started: no party is in the timeline.</span>
      <span className='text-xs text-muted'>{chart.parties.length === 0 ? 'create a party in the Parties tab to start it with' : 'start it from the Parties tab'}</span>
    </div>
  )
}

// Placing a party on the timeline at a day and ET: one outside time joins it
// there, one on it moves forward, placed or living the time between, each
// read for what it does first.
function PlaceParty({ chart, done }: { chart: TimelineChart, done: () => void }) {
  const [party, setParty] = useState(chart.parties[0]?.id ?? '')
  const [day, setDay] = useState(1)
  const [et, setEt] = useState(1)
  const { placement, place } = usePlacement(party, day, et)
  return (
    <div className='flex flex-col gap-1 border border-line rounded p-2 text-xs'>
      <div className='flex flex-row flex-wrap gap-2 items-center'>
        <select aria-label='party to place' className={selectClass} value={party} onChange={(e) => setParty(e.target.value)}>
          {chart.parties.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.when}</option>)}
        </select>
        <span className='text-muted'>at day</span>
        <input type='number' min={1} aria-label='placement day' className={`${inputClass} w-16`} value={day} onChange={(e) => setDay(Number(e.target.value) || 1)} />
        <span className='text-muted'>ET</span>
        <select aria-label='placement ET' className={selectClass} value={et} onChange={(e) => setEt(Number(e.target.value))}>
          {Array.from({ length: chart.etsPerDay }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}
        </select>
      </div>
      {placement.bar ? <span className='text-muted'>{placement.bar}</span> : null}
      {placement.options.map((o) => (
        <div key={o.how} className='flex flex-row flex-wrap gap-1.5 items-center'>
          <span className='text-fg'>{o.warning}</span>
          <Button size='xs' variant='primary' aria-label={`${o.how} party`} onClick={() => { place(o.how); done() }}>{o.label}</Button>
        </div>
      ))}
    </div>
  )
}
