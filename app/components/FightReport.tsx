import { Fragment, type ReactNode } from 'react'
import type { Degree } from '../domain/types'
import type { Figures, FightReportRow, Tally } from '../domain/scene/projections/report'
import { useFightReport } from '../hooks/useFightReport'
import { Dropdown } from './ui'

const DEGREE_TONE: Record<Degree, string> = { miss: 'text-muted', graze: 'text-fg', hit: 'text-good', critical: 'text-accent' }

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
      {() => <div className='max-h-[70vh] w-[42rem] max-w-[90vw] overflow-y-auto'><FightReport /></div>}
    </Dropdown>
  )
}

const TH = 'px-1.5 font-normal text-muted text-right align-bottom leading-tight'
const TD = 'px-1.5 font-mono text-right tabular-nums'
const LABEL = 'pr-3 text-left whitespace-nowrap overflow-hidden text-ellipsis'

function ReportCard({ row }: { row: FightReportRow }) {
  const tallies: [string, Tally][] = [
    ['attacks made', row.attacks],
    ['of them met by the SD', row.attacksUnanswered],
    ['defenses made', row.defenses],
    ['attacks taken undefended', row.takenUndefended],
  ]
  const shown = tallies.filter(([, t]) => t.total > 0)
  return (
    <div className='flex flex-col gap-1.5 border-b border-line/50 pb-2'>
      <div className='flex flex-row gap-2 items-baseline'>
        <span className='text-sm font-semibold'>{row.name}</span>
        {row.party ? <span className='text-muted'>{row.party}</span> : null}
      </div>
      <table className='w-full table-fixed'>
        <colgroup><col className='w-[42%]' /><col /><col /><col /><col /><col /><col /></colgroup>
        <thead>
          <tr>
            <th />
            <th className={TH} title='damage past the armor it was measured against'>past armor</th>
            <th className={TH} title='damage that reached them, the degree and the defense counted'>damage</th>
            <th className={TH}>IL</th>
            <th className={TH} title='IL bled from the bleeds this character put on, or that were put on them'>bled IL</th>
            <th className={TH}>wounds</th>
            <th className={TH}>kills</th>
          </tr>
        </thead>
        <tbody>
          <FigureRow label='dealt' figures={row.dealt} strong extra={[row.dealt.wounds, row.dealt.kills]} />
          {row.dealtTo.map((l) => <FigureRow key={l.id} label={`to ${l.name}`} figures={l} />)}
          <FigureRow label='taken' figures={row.taken} strong />
          {row.takenFrom.map((l) => <FigureRow key={l.id} label={`from ${l.name}`} figures={l} />)}
          {row.taken.other > 0 ? (
            <tr className='text-muted' title='fire, falls, edits and anything else no attack or bleed put on'>
              <td className={`${LABEL} pl-3`}>otherwise</td><td /><td /><td className={TD}>{row.taken.other}</td><td /><td /><td />
            </tr>
          ) : null}
        </tbody>
      </table>
      {shown.length > 0 ? (
        <table className='w-full table-fixed'>
          <colgroup><col className='w-[42%]' /><col className='w-[8%]' />{row.attacks.shares.map((s) => <Fragment key={s.degree}><col className='w-[5%]' /><col className='w-[8.5%]' /></Fragment>)}</colgroup>
          <thead>
            <tr>
              <th />
              <th className={TH}>total</th>
              {row.attacks.shares.map((s) => <th key={s.degree} colSpan={2} className={`px-1.5 font-normal text-center whitespace-nowrap ${DEGREE_TONE[s.degree]}`}>{s.degree}</th>)}
            </tr>
          </thead>
          <tbody>
            {shown.map(([label, t]) => (
              <tr key={label}>
                <td className={LABEL}>{label}</td>
                <td className={TD}>{t.total}</td>
                {t.shares.map((s) => (
                  <Pair key={s.degree} count={s.count} percent={<>{s.percent}%</>} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  )
}

function FigureRow({ label, figures, strong = false, extra }: { label: string; figures: Figures; strong?: boolean; extra?: [number, number] }) {
  return (
    <tr className={strong ? 'font-semibold' : 'text-muted'}>
      <td className={strong ? LABEL : `${LABEL} pl-3`}>{label}</td>
      <td className={TD}>{figures.pastArmor}</td>
      <td className={TD}>{figures.damage}</td>
      <td className={TD}>{figures.IL}</td>
      <td className={TD}>{figures.bleed}</td>
      <td className={TD}>{extra ? extra[0] : null}</td>
      <td className={TD}>{extra ? extra[1] : null}</td>
    </tr>
  )
}

function Pair({ count, percent }: { count: number; percent: ReactNode }) {
  return (
    <>
      <td className={TD}>{count}</td>
      <td className={`${TD} text-muted`}>{percent}</td>
    </>
  )
}
