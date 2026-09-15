'use client'
import { useState } from 'react'
import { CatalogPanel } from './CatalogPanel'
import { CATALOGS, CATALOG_NAMES, CatalogName } from '../../forms/catalogs'

// The catalog tab: one editor per asset file under app/assets. Each edits the
// stored shape of its catalog through the schema-driven form and saves the
// whole file back, so what the app runs on and what the book is rendered
// from is one committed JSON.
export function CatalogEditor() {
  const [catalog, setCatalog] = useState<CatalogName>('abilities')
  return (
    <div className='flex flex-col gap-2'>
      <div className='flex flex-row gap-1 text-xs'>
        {CATALOG_NAMES.map((name) => (
          <input key={name} className={`py-1 rounded px-2 hover:bg-gray-500 ${catalog === name ? 'bg-white text-black' : ''}`}
            type='button' value={CATALOGS[name].label} onClick={() => setCatalog(name)} />
        ))}
      </div>
      <CatalogPanel key={catalog} catalog={catalog} />
    </div>
  )
}
