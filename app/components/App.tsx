'use client'
import { useState } from 'react'
import { useGameTab } from '../hooks/useGameTab';
import { PlayPanel } from './PlayPanel';
import { CharacterCreator } from './CharacterCreator';
import { BreakMe } from './BreakMe';
import { Sidebar } from './Sidebar';
import { CatalogEditor } from './catalog/CatalogEditor';

export function App(){

  const { tab: selectedGameTab, setTab: setSelectedGameTab } = useGameTab()

  const [open, setOpen] = useState(false)

  return(
    <>      
      <header className="py-4 h-12">
        <div className='flex flex-row justify-start items-start text-start gap-2'>
          {/* <input className={'p-1 w-full hover:bg-gray-500 '+ (selectedPage == 'Select' ? 'bg-white text-black' : '')} type={'button'} aria-label={'head_select'} value={'Select'} onClick={() => setSelectedPage('Select')}/> */}
          <input className={'py-1 rounded px-2 hover:bg-gray-500 '+ (selectedGameTab == 'edit' ? 'bg-white text-black' : '')} type={'button'} aria-label={'head_char'} value={'Character'} onClick={() => setSelectedGameTab('edit')}/>
          {/* <input className={'py-1 rounded px-2 hover:bg-gray-500 '+ (selectedPage == 'Play' ? 'bg-white text-black' : '')} type={'button'} aria-label={'head_play'} value={'Play'} onClick={() => setSelectedPage('Play')}/> */}
          <input className={'py-1 rounded px-2 hover:bg-gray-500 hidden md:block '+ (selectedGameTab == 'play' ? 'bg-white text-black' : '')} type={'button'} aria-label={'head_play'} value={'Run'} onClick={() => setSelectedGameTab('play')}/>
          <input className={'py-1 rounded px-2 hover:bg-gray-500 hidden md:block '+ (selectedGameTab == 'break' ? 'bg-white text-black' : '')} type={'button'} aria-label={'head_break'} value={'Break Me'} onClick={() => setSelectedGameTab('break')}/>
          <input className={'py-1 rounded px-2 hover:bg-gray-500 hidden md:block '+ (selectedGameTab == 'catalog' ? 'bg-white text-black' : '')} type={'button'} aria-label={'head_catalog'} value={'Catalog'} onClick={() => setSelectedGameTab('catalog')}/>
        </div>
      </header>

      <main className="grid grid-cols-12 w-full h-full">
      {selectedGameTab == 'catalog' ? (
        <div className="col-span-12 mx-2 text-sm md:text-md">
          <CatalogEditor />
        </div>
      ) : (
      <>
      <div className="hidden md:block col-span-2 border-r border-gray-700 pl-1 pr-2 h-full">
        <Sidebar />
      </div>

      {/* mobile top menu for sidebar */}
      <div className="md:hidden flex items-center justify-between text-white p-2 h-8">
        <button
          type='button'
          onClick={() => setOpen((prev) => !prev)}
          className="focus:outline-none"
        >
          {/* Hamburger icon */}
          <div className="space-y-1">
            <span className="block w-6 h-0.5 bg-white"></span>
            <span className="block w-6 h-0.5 bg-white"></span>
            <span className="block w-6 h-0.5 bg-white"></span>
          </div>
        </button>
      </div>

      {/* Mobile Sidebar */}
      {open && (
        <div className="md:hidden absolute top-0 left-0 w-64 h-full bg-gray-900 text-white shadow-lg z-50 px-2 overflow-y-auto">
          <button
            onClick={() => setOpen(false)}
            className="p-2 text-right w-full"
          >
            ✕ Close
          </button>
          <Sidebar />
        </div>
      )}


      <div className="col-span-12 md:col-span-10 mr-2 md:ml-2 text-sm md:text-md justify-center text-center">
        {
          selectedGameTab == 'edit' ?
            <CharacterCreator /> :
            selectedGameTab == 'play' ?
            <PlayPanel/> :
            selectedGameTab == 'break' ?
            <BreakMe/> :
            null
        }
      </div>
      </>
      )}
      </main>
    </>
  )
}
