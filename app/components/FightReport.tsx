import type { DamageLine, FightReportRow, Tally } from '../domain/scene/projections/report'
import { useFightReport } from '../hooks/useFightReport'
import { Dropdown, SectionLabel } from './ui'

const DEGREE_TONE: Record<string, string> = { miss: 'text-muted', graze: 'text-fg', hit: 'text-good', critical: 'text-accent' }

// What the fight came to for each who was in it: damage dealt and taken, the
// bleeding each put on, attacks, defenses and attacks taken undefended.
export function FightReport() {
  const rows = useFightReport()
  if (rows.length === 0) return <span className='text-xs text-muted'>nobody has fought yet</span>
  return (
    <div className='flex flex-col gap-3 text-xs'>
      {rows.map((r) => <ReportCard key={r.id} row={r} />)}
    </div>
  )
}

// The report, opened from beside the log.
export function FightReportButton() {
  return (
    <Dropdown label='fight report' text='report' title='damage, bleeding, attacks and defenses of everyone in the fight'>
      {() => <div className='max-h-[70vh] w-[28rem] max-w-[90vw] overflow-y-auto'><FightReport /></div>}
    </Dropdown>
  )
}

function ReportCard({ row }: { row: FightReportRow }) {
  return (
    <div className='flex flex-col gap-1 border-b border-line/50 pb-2'>
      <div className='flex flex-row gap-2 items-baseline'>
        <span className='text-sm font-semibold'>{row.name}</span>
        {row.party ? <span className='text-muted'>{row.party}</span> : null}
      </div>
      <div className='grid grid-cols-2 gap-x-4 gap-y-1'>
        <div className='flex flex-col gap-0.5'>
          <SectionLabel>dealt</SectionLabel>
          <Figures damage={row.dealt.damage} IL={row.dealt.IL} bleed={row.dealt.bleed} />
          <span className='text-muted'>{row.dealt.wounds} wounds · {row.dealt.kills} kills</span>
          <Lines lines={row.dealtTo} word='to' />
        </div>
        <div className='flex flex-col gap-0.5'>
          <SectionLabel>taken</SectionLabel>
          <Figures damage={row.taken.damage} IL={row.taken.IL} bleed={row.taken.bleed} />
          {row.taken.other > 0 ? <span className='text-muted' title='fire, falls, edits and anything else no attack or bleed put on'>{row.taken.other} IL otherwise</span> : null}
          <Lines lines={row.takenFrom} word='from' />
        </div>
      </div>
      <TallyLine label='attacks' tally={row.attacks} />
      <TallyLine label='of them met by the SD' tally={row.attacksUnanswered} />
      <TallyLine label='defenses' tally={row.defenses} hint='by the degree the attack defended came to' />
      <TallyLine label='attacks taken without a defense' tally={row.takenUndefended} />
    </div>
  )
}

function Figures({ damage, IL, bleed }: { damage: number; IL: number; bleed: number }) {
  return (
    <span>
      <span className='font-mono'>{damage}</span> damage · <span className='font-mono'>{IL}</span> IL · <span className='font-mono'>{bleed}</span> IL bled
    </span>
  )
}

function Lines({ lines, word }: { lines: DamageLine[]; word: string }) {
  return (
    <>
      {lines.map((l) => (
        <span key={l.id} className='text-muted'>
          {word} {l.name}: <span className='font-mono'>{l.damage}</span> dmg, <span className='font-mono'>{l.IL}</span> IL{l.bleed > 0 ? <>, <span className='font-mono'>{l.bleed}</span> bled</> : null}
        </span>
      ))}
    </>
  )
}

function TallyLine({ label, tally, hint }: { label: string; tally: Tally; hint?: string }) {
  if (tally.total === 0) return null
  return (
    <div className='flex flex-row flex-wrap gap-x-2' title={hint}>
      <span>{label} <span className='font-mono'>{tally.total}</span>:</span>
      {tally.shares.map((s) => (
        <span key={s.degree} className={DEGREE_TONE[s.degree]}>{s.degree} {s.count} ({s.percent}%)</span>
      ))}
    </div>
  )
}
