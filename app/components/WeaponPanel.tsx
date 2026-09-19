'use client'

import { useState } from "react";
import { useWeaponLens } from "../hooks/useWeaponLens";
import type { AttackVariant } from "../domain/character/lenses/gear";
import { Button, Panel } from "./ui";

const th = 'font-medium px-1 pb-1 border-b border-line'

export function WeaponPanel(){
  const { panels, attack } = useWeaponLens()

  const [lastAtk, setLastAtk] = useState({atk:0, type: '', weapon: '', blunt: 0, cut: 0})

  const AttackButtons = ({variants, weaponName} : {variants: AttackVariant[], weaponName: string }) =>{
    return(
      <span className='flex flex-row flex-wrap gap-1'>
        {
          variants.map(el => {
            const handleClick = () => {
              const result = attack(el, el.type, weaponName)
              if (result) {
                setLastAtk(result)
              }
            }
            return <Button size='xs' key={el.name} title={`blunt ${el.blunt} · cut ${el.cut} · ${el.AP} AP${el.STA ? ` · ${el.STA} STA` : ''}${el.penalty ? ` · ${-el.penalty} to hit` : ''}`} onClick={handleClick}>{el.name} <span className='font-mono'>{el.blunt}/{el.cut}</span></Button>
          })
        }
      </span>
    )
  }

  return(
    <Panel title='Weapons' meta={lastAtk.weapon ? <>last attack · {lastAtk.weapon} {lastAtk.type} · <span className='font-mono text-fg'>{lastAtk.atk}</span></> : null}>
      {
        panels.map((panel) => (
          <div key={panel.key} className='flex flex-col gap-1'>
            <div className='flex flex-row flex-wrap gap-x-3 gap-y-0.5 items-baseline text-xs'>
              <span className='text-sm'>{panel.name}</span>
              <span className='text-muted'>size {panel.scale}{!panel.wieldable ? <span className='text-bad'> · too large to wield</span> : panel.oversize ? <span className='text-bad'> · oversize: +1 AP, STR−5</span> : ''}</span>
              {panel.shield && <span className='text-muted'>{panel.shield.body ? 'body shield' : 'shield'} · cover +{panel.shield.cover}</span>}
              <span className='text-muted'>{panel.natural ? `${panel.grip} free` : `${panel.grip}h`}</span>
            </div>
            <div className='overflow-x-auto'>
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
                    <th className={th}>properties</th>
                    <th className={th}></th>
                  </tr>
                </thead>
                <tbody>
                  {
                    panel.rows.map((row, index) =>
                      <tr key={panel.name+index.toString()} className={`hover:bg-raised ${row.usable && !row.needsFocus ? '' : 'text-muted'}`}>
                        <td className='px-1 py-0.5'>{row.name}</td>
                        <td className='px-1 py-0.5'>{row.handed}</td>
                        <td className='px-1 py-0.5 text-right font-mono'>{row.RES}</td>
                        <td className='px-1 py-0.5 text-right font-mono'>{row.blunt}</td>
                        <td className='px-1 py-0.5 text-right font-mono'>{row.cut}</td>
                        <td className='px-1 py-0.5 text-right font-mono'>{row.AP + (row.reload ? '+' + row.reload : '')}</td>
                        <td className='px-1 py-0.5'>{row.range}</td>
                        <td className='px-1 py-0.5 text-right font-mono'>{row.block ?? '–'}</td>
                        <td className='px-1 py-0.5 text-muted'>{row.properties.join(', ')}</td>
                        <td className='px-1 py-0.5'>{row.needsFocus ? <span className='text-muted'>needs focus surge</span> : <AttackButtons variants={row.variants} weaponName={panel.name} />}</td>
                      </tr>
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
