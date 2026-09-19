'use client'
import { useState } from 'react'
import { CatalogPanel } from './CatalogPanel'
import { CATALOGS, CATALOG_NAMES, CatalogName } from '../../forms/catalogs'
import { Button } from '../ui'

// The catalog tab: one editor per asset file under app/assets. Each edits the
// stored shape of its catalog through the schema-driven form and saves the
// whole file back, so what the app runs on and what the book is rendered
// from is one committed JSON.
export function CatalogEditor() {
  const [catalog, setCatalog] = useState<CatalogName>('abilities')
  return (
    <div className='flex flex-col gap-2 py-2'>
      <div className='flex flex-row gap-1 text-xs'>
        {CATALOG_NAMES.map((name) => (
          <Button key={name} variant={catalog === name ? 'primary' : 'default'} active={catalog === name} onClick={() => setCatalog(name)}>{CATALOGS[name].label}</Button>
        ))}
      </div>
      <CatalogPanel key={catalog} catalog={catalog} />
    </div>
  )
}
