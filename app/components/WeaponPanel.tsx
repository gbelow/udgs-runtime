'use client'

import { useState } from "react";
import { makeFullRoll } from "./utils";
import { dmgArr } from "../domain/tables";
import { useSkillLens } from "../hooks/useSkillLens";
import { useCharacteristicLens } from "../hooks/useCharacteristicLens";
import { useActiveCharacter } from "../hooks/useActiveCharacter";
import { useWeaponLens } from "../hooks/useWeaponLens";

export function WeaponPanel(){
  const {weapons, equip, unequip} = useWeaponLens()

  const [lastAtk, setLastAtk] = useState({atk:0, properties: '', weapon: ''})
  const [strike] = useSkillLens('strike')
  const [accuracy] = useSkillLens('accuracy')
  const [STR] = useCharacteristicLens('STR') ?? 10

  const pressAtk = (range: string, heavyMod:number, properties:string, weapon: string) => {
    const roll = makeFullRoll()
    let atk = 0
    if(heavyMod == 1) atk -= 2 
    if(heavyMod >= 1.5) atk -= 3 
    if(range=='ranged') atk += roll + accuracy
    if(range=='melee') atk += roll + strike
    setLastAtk({atk, properties, weapon})
  }

  return(
    <div className='flex flex-col justify-center w-84 md:w-full'>
      <span className="pb-1"> Weapon: {lastAtk.weapon} /  properties: {lastAtk.properties} / ROLL: {lastAtk.atk}  </span>
      {
        Object.entries(weapons).map(([key, el]) => {
          
          return(
            <div key={key} className='flex flex-col justify-center border rounded p-1'>
              <div className='flex flex-row gap-3' >
                <span>Weapon: {key} </span>
                {
                  <>
                    <span>Size: {el.scale}</span>
                    <input type='button' value='unequip' onClick={() => unequip(el.name)} className='border rounded p-1' />                    
                  </>
                }
              </div>
              <table className='md:w-full text-center text-xs'>
                <thead>
                  <tr>
                    <td>RES</td>
                    <td>TGH</td>
                    <td>impact/PEN</td>
                    <td>AP</td>
                    <td>reach</td>
                    <td>DEF</td>
                    <td>properties</td>
                    <td>atk</td>
                    <td>heav atk</td>
                  </tr>
                </thead>
                <tbody>
                  {
                    el.attacks.map((atk, index) => 
                      <tr key={el+index.toString()}>
                        <td>{atk.RES}</td>
                        <td>{atk.TGH}</td>
                        <td>{atk.impact+(atk.heavyMod ? '+' + (atk.type == 'melee' ? Math.floor(atk.heavyMod*STR*dmgArr[el.scale-1])  : atk.heavyMod*dmgArr[el.scale-1]) : '' ) + '/' +Math.floor(atk.impact*atk.penMod)+(atk.heavyMod ? '+'+(atk.type == 'melee' ? Math.floor(atk.heavyMod*atk.penMod*STR*dmgArr[el.scale-1]) : atk.heavyMod*atk.penMod*dmgArr[el.scale-1]) : '')}</td>
                        <td>{atk.AP}</td>
                        <td>{atk.range}</td>
                        <td>{atk.deflection}</td>
                        <td>{atk.props}</td>
                        <td><input className="bg-gray-500 border rounded px-1" type='button' value={'atk'} onClick={() => pressAtk(atk.type, 0, atk.props, el.name)} /></td>
                        <td>{atk.heavyMod > 0 ? <input className="bg-gray-500 border rounded px-1" type='button' value={'atk'} onClick={() => pressAtk(atk.type, atk.heavyMod, atk.props, el.name)}  /> : null}</td>
                      </tr>
                    )
                  }
                </tbody>
              </table>
            </div>
          )
        })
      }
    </div>
  )
}
