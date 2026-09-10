'use client'

import { useState } from "react";
import { useWeaponLens } from "../hooks/useWeaponLens";
import type { AttackVariant } from "../domain/character/lenses/gear";

export function WeaponPanel(){
  const { panels, unequip, attack } = useWeaponLens()

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
            return <input className="bg-gray-500 border rounded px-1" type='button' key={el.name} value={el.name} onClick={handleClick} />
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
              <span>Weapon: {panel.key} </span>
              <span>Size: {panel.scale}</span>
              <input type='button' value='unequip' onClick={() => unequip(panel.name)} className='border rounded p-1' />
            </div>
            <table className='md:w-full text-center text-xs'>
              <thead>
                <tr>
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
                    <tr key={panel.name+index.toString()}>
                      <td>{row.RES}</td>
                      <td>{row.blunt}</td>
                      <td>{row.cut}</td>
                      <td>{row.AP + (row.reload ? '+' + row.reload : '')}</td>
                      <td>{row.range}</td>
                      <td>{row.deflection}</td>
                      <td>{row.properties}</td>
                      <td><AttackButtons variants={row.variants} weaponName={panel.name} /></td>
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
