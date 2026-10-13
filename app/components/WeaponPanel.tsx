'use client'

import { useWeaponLens } from "../hooks/useWeaponLens";
import { Fragment } from "react";
import { Panel } from "./ui";

const th = 'font-medium px-1 pb-1 border-b border-line'

// The weapons in hand as a table of their attacks and properties; attacks
// are declared from the action panel.
export function WeaponPanel(){
  const { panels } = useWeaponLens()

  return(
    <Panel title='Weapons'>
      {
        panels.map((panel) => (
          <div key={panel.key} className='flex flex-col gap-1'>
            <div className='flex flex-row flex-wrap gap-x-3 gap-y-0.5 items-baseline text-xs'>
              <span className='text-sm'>{panel.name}</span>
              <span className='text-muted'>size {panel.scale}{!panel.wieldable ? <span className='text-bad'> · too large to wield</span> : panel.oversize ? <span className='text-bad'> · oversize: +1 AP, STR−5</span> : ''}</span>
              {panel.shield && <span className='text-muted'>{panel.shield.body ? 'body shield' : 'shield'} · cover +{panel.shield.cover}</span>}
              <span className='text-muted'>{panel.natural ? `${panel.grip} free` : `${panel.grip}h`}</span>
            </div>
            <div>
              <table className='w-full text-xs'>
                <thead>
                  <tr className='text-[10px] uppercase tracking-wider text-muted text-left'>
                    <th className={th}>attack</th>
                    <th className={th}>hands</th>
                    <th className={`${th} text-right`}>RES</th>
                    <th className={`${th} text-right`}>blunt</th>
                    <th className={`${th} text-right`}>cut</th>
                    <th className={`${th} text-right`}>AP</th>
                    <th className={th}>reach</th>
                    <th className={`${th} text-right`}>DEF</th>
                  </tr>
                </thead>
                <tbody>
                  {
                    panel.rows.map((row, index) =>
                      <Fragment key={panel.name+index.toString()}>
                      <tr className={row.usable && !row.needsFocus ? '' : 'text-muted'}>
                        <td className='px-1 py-0.5'>{row.name}</td>
                        <td className='px-1 py-0.5'>{row.handed}</td>
                        <td className='px-1 py-0.5 text-right font-mono'>{row.RES}</td>
                        <td className='px-1 py-0.5 text-right font-mono'>{row.blunt}</td>
                        <td className='px-1 py-0.5 text-right font-mono'>{row.cut}</td>
                        <td className='px-1 py-0.5 text-right font-mono'>{row.AP + (row.reload ? '+' + row.reload : '')}</td>
                        <td className='px-1 py-0.5'>{row.range}</td>
                        <td className='px-1 py-0.5 text-right font-mono'>{row.block ?? '–'}</td>
                      </tr>
                      <tr className='border-b border-line/50'>
                        <td colSpan={8} className='px-1 pb-1'>
                          <div className='flex flex-row flex-wrap gap-x-2 gap-y-1 items-center'>
                            {row.needsFocus ? <span className='text-muted'>needs focus surge</span> : null}
                            {row.properties.length > 0 ? <span className='text-muted'>{row.properties.join(', ')}</span> : null}
                          </div>
                        </td>
                      </tr>
                      </Fragment>
                    )
                  }
                </tbody>
              </table>
            </div>
          </div>
        ))
      }
    </Panel>
  )
}
