'use client'

import { useState } from "react";
import { useWeaponLens } from "../hooks/useWeaponLens";
import type { AttackVariant } from "../domain/character/lenses/gear";

export function WeaponPanel(){
  const { panels, attack } = useWeaponLens()

  const [lastAtk, setLastAtk] = useState({atk:0, type: '', weapon: '', blunt: 0, cut: 0})

  const AttackButtons = ({variants, weaponName} : {variants: AttackVariant[], weaponName: string }) =>{
    return(
      <>
        {
          variants.map(el => {
            const handleClick = () => {
              const result = attack(el, el.type, weaponName)
              if (result) {
                setLastAtk(result)
              }
            }
            return <input className="bg-gray-500 border rounded px-1" type='button' key={el.name} value={`${el.name} ${el.blunt}/${el.cut}`} title={`blunt ${el.blunt} · cut ${el.cut} · ${el.AP} AP${el.STA ? ` · ${el.STA} STA` : ''}${el.penalty ? ` · ${-el.penalty} to hit` : ''}`} onClick={handleClick} />
          })
        }
      </>
    )
  }

  return(
    <div className='flex flex-col justify-center w-84 md:w-full'>
      <span className="pb-1"> Weapon: {lastAtk.weapon} /  type: {lastAtk.type} / ROLL: {lastAtk.atk}  </span>
      {
        panels.map((panel) => (
          <div key={panel.key} className='flex flex-col justify-center border rounded p-1'>
            <div className='flex flex-row gap-3' >
              <span>Weapon: {panel.name} </span>
              <span>Size: {panel.scale}{panel.oversize ? ' (oversize: +1 AP, STR-5)' : ''}</span>
              {panel.shield && <span>{panel.shield.body ? 'Body shield' : 'Shield'} · Cover +{panel.shield.cover}</span>}
              <span className='text-xs text-gray-400'>{panel.natural ? `${panel.grip} free` : `${panel.grip}h`}</span>
            </div>
            <table className='md:w-full text-center text-xs'>
              <thead>
                <tr>
                  <td>attack</td>
                  <td>hands</td>
                  <td>RES</td>
                  <td>blunt</td>
                  <td>cutting</td>
                  <td>AP</td>
                  <td>reach</td>
                  <td>DEF</td>
                  <td>properties</td>
                  <td>attacks</td>
                </tr>
              </thead>
              <tbody>
                {
                  panel.rows.map((row, index) =>
                    <tr key={panel.name+index.toString()} className={row.usable && !row.needsFocus ? '' : 'text-gray-500'}>
                      <td className='text-left'>{row.name}</td>
                      <td>{row.handed}</td>
                      <td>{row.RES}</td>
                      <td>{row.blunt}</td>
                      <td>{row.cut}</td>
                      <td>{row.AP + (row.reload ? '+' + row.reload : '')}</td>
                      <td>{row.range}</td>
                      <td>{row.block ?? '-'}</td>
                      <td>{[...row.properties, ...(row.STRreq !== null ? [`STR ${row.STRreq}`] : [])].join(', ')}</td>
                      <td>{row.needsFocus ? <span className='text-xs'>needs focus surge</span> : <AttackButtons variants={row.variants} weaponName={panel.name} />}</td>
                    </tr>
                  )
                }
              </tbody>
            </table>
          </div>
        ))
      }
    </div>
  )
}
