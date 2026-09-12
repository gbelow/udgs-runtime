'use client'
import { useState } from 'react'
import { ArmorSelector } from './ArmorSelector';
import { WeaponSelector } from './WeaponSelector';
import { CharacterSelector } from './CharacterSelector';
import { ContainerSelector } from './ContainerSelector';
import { ItemSelector } from './ItemSelector';

export function Sidebar(){

  const [selectedSidebar, setSelectedSidebar] = useState('') 

  return(
    <>
      <div className='flex flex-row flex-wrap items-start justify-between mb-2 text-xs'>
        <input className={'p-1 w-full hover:bg-gray-500 '+ (selectedSidebar == 'Armor' ? 'bg-white text-black' : '')} type={'button'} aria-label={'sbar_armor'} value={'Armor'} onClick={() => setSelectedSidebar('Armor')}/>
        <input className={'p-1 w-full hover:bg-gray-500 '+ (selectedSidebar == 'Weapon' ? 'bg-white text-black' : '')} type={'button'} aria-label={'sbar_weapon'} value={'Weapon'} onClick={() => setSelectedSidebar('Weapon')}/>
        <input className={'p-1 w-full hover:bg-gray-500 '+ (selectedSidebar == 'Container' ? 'bg-white text-black' : '')} type={'button'} aria-label={'sbar_container'} value={'Container'} onClick={() => setSelectedSidebar('Container')}/>
        <input className={'p-1 w-full hover:bg-gray-500 '+ (selectedSidebar == 'Item' ? 'bg-white text-black' : '')} type={'button'} aria-label={'sbar_item'} value={'Item'} onClick={() => setSelectedSidebar('Item')}/>
        <input className={'p-1 w-full hover:bg-gray-500 '+ (selectedSidebar == 'Character' ? 'bg-white text-black' : '')} type={'button'} aria-label={'sbar_char'} value={'Character'} onClick={() => setSelectedSidebar('Character')}/>
      </div>
      {
        selectedSidebar == 'Armor' ?
        <ArmorSelector /> :
        selectedSidebar == 'Weapon' ?
        <WeaponSelector /> :
        selectedSidebar == 'Container' ?
        <ContainerSelector /> :
        selectedSidebar == 'Item' ?
        <ItemSelector /> :
        selectedSidebar == 'Character' ?
        <CharacterSelector/>
        : null
      }
    </>
  )
}
