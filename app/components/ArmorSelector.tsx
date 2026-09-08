'use client'
import armors from '../assets/armors.json'
import { Armor } from '../domain/types';
import { useArmorLens } from '../hooks/useArmorLens';

export function ArmorSelector(){
  const [, equipArmor] = useArmorLens()

  const handleEquipArmorClick = (armor: Armor) => {
    equipArmor(armor)
  };

  return(
    <div className='text-center w-full'>
      {
        Object.values(armors as Record<string, Armor>).map((el: Armor) => {
          return(
            <input type={'button'} key={el.name} className='text-center w-full hover:bg-gray-500 p-1 ' value={el.name} aria-label={el.name} onClick={() => handleEquipArmorClick(el)}/>
          )
        })
      }
    </div>
  )
}
