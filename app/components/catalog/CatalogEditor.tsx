'use client'
import { useState } from 'react'
import { AbilityEditor } from './AbilityEditor'

type Catalog = 'abilities'

// The catalog tab: one editor per asset file under app/assets. Each edits the
// stored shape of its catalog through the schema-driven form and saves the
// whole file back, so what the app runs on and what the book is rendered
// from is one committed JSON.
export function CatalogEditor() {
  const [catalog, setCatalog] = useState<Catalog>('abilities')
  return (
    <div className='flex flex-col gap-2'>
      <div className='flex flex-row gap-1 text-xs'>
        <input className={`py-1 rounded px-2 hover:bg-gray-500 ${catalog === 'abilities' ? 'bg-white text-black' : ''}`} type='button' value='Abilities' onClick={() => setCatalog('abilities')} />
      </div>
      {catalog === 'abilities' ? <AbilityEditor /> : null}
    </div>
  )
}
