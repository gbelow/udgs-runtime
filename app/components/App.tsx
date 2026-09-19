'use client'
import { useState } from 'react'
import { useGameTab } from '../hooks/useGameTab';
import { PlayPanel } from './PlayPanel';
import { CharacterCreator } from './CharacterCreator';
import { BreakMe } from './BreakMe';
import { Sidebar } from './Sidebar';
import { CatalogEditor } from './catalog/CatalogEditor';

const TABS = [
  { tab: 'edit', label: 'Character', mobile: true },
  { tab: 'play', label: 'Run', mobile: false },
  { tab: 'break', label: 'Break Me', mobile: false },
  { tab: 'catalog', label: 'Catalog', mobile: false },
] as const

export function App(){

  const { tab: selectedGameTab, setTab: setSelectedGameTab } = useGameTab()

  const [open, setOpen] = useState(false)

  return(
    <>      
      <header className="w-full h-12 border-b border-line bg-surface px-2">
        <div className='flex flex-row justify-start items-stretch h-full gap-1'>
          {TABS.map(({ tab, label, mobile }) => (
            <button key={tab} type='button' aria-label={`head_${tab}`}
              className={`px-3 text-sm border-b-2 -mb-px ${mobile ? '' : 'hidden md:block '}${selectedGameTab === tab ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg'}`}
              onClick={() => setSelectedGameTab(tab)}>{label}</button>
          ))}
        </div>
      </header>

      <main className="grid grid-cols-12 w-full h-full">
      {selectedGameTab == 'catalog' ? (
        <div className="col-span-12 mx-2 text-sm md:text-md">
          <CatalogEditor />
        </div>
      ) : (
      <>
      <div className="hidden md:block col-span-2 border-r border-line pl-1 pr-2 h-full">
        <Sidebar />
      </div>

      {/* mobile top menu for sidebar */}
      <div className="md:hidden flex items-center justify-between p-2 h-8">
        <button
          type='button'
          onClick={() => setOpen((prev) => !prev)}
          className="focus:outline-none"
        >
          {/* Hamburger icon */}
          <div className="space-y-1">
            <span className="block w-6 h-0.5 bg-fg"></span>
            <span className="block w-6 h-0.5 bg-fg"></span>
            <span className="block w-6 h-0.5 bg-fg"></span>
          </div>
        </button>
      </div>

      {/* Mobile Sidebar */}
      {open && (
        <div className="md:hidden absolute top-0 left-0 w-64 h-full bg-surface border-r border-line shadow-lg z-50 px-2 overflow-y-auto">
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
