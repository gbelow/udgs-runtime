'use client'
import { useState } from 'react'
import baseWeapons from '../assets/weapons.json'
import { Weapon, WeaponSchema } from '../domain/types';
import { useWeaponLens } from '../hooks/useWeaponLens';

export function WeaponSelector(){

  const { equip: equipWeapon } = useWeaponLens()

  const handleEquipWeaponClick = (weapon: Weapon) => {
    equipWeapon(weapon)
  };  

  const typedBaseWeapons : Record<string, Weapon> = Object.entries(baseWeapons).reduce((acc, w) => ({...acc, [w[0]]: (WeaponSchema.parse(w[1]))}), {});

  const [weapons, setWeapons] = useState(typedBaseWeapons)

  return(
    <div className='text-center w-full'>
      {
        Object.values(weapons).map((el:Weapon) => {
          return(
            <div className='flex flex-row justify-around text-center w-full  ' key={el.name}>
              <input type={'button'}  className='text-center  hover:bg-gray-500 p-1 w-32' value={el.name} aria-label={el.name} 
                onClick={() => el ? handleEquipWeaponClick(el) : null}
              />
              <input className='w-8' type='number' inputMode="numeric" aria-label={el.name} value={el.scale} 
                onChange={(val) => setWeapons({...weapons, [el.name]: {...el, scale: parseInt(val.target.value)}})} 
              />
            </div>
          )
        })
      }
    </div>
  )
}
