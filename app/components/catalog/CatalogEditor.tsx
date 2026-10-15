'use client'
import { useState } from 'react'
import { CatalogPanel } from './CatalogPanel'
import { CollectionsEditor } from './Collections'
import { RaceCreator } from '../RaceCreator'
import { MapEditor } from '../MapEditor'
import { CATALOGS, CATALOG_NAMES, CatalogName } from '../../forms/catalogs'
import { useGameTab } from '../../hooks/useGameTab'
import { Button } from '../ui'

// The catalog tab: everything the GM authors, and the curated lists of it
// the campaign in play keeps. The
// races and the maps have editors of their own, each a tab of its own; every
// other catalog is one asset file under app/assets, edited in its stored
// shape through the schema-driven form and saved whole, so what the app runs
// on and what the book is rendered from is one committed JSON.
export function CatalogEditor() {
  const { tab, setTab } = useGameTab()
  const [catalog, setCatalog] = useState<CatalogName>('abilities')
  const openAsset = (name: CatalogName) => { setCatalog(name); setTab('catalog') }
  return (
    <div className='flex flex-col gap-2 py-2'>
      <div className='flex flex-row gap-1 text-xs'>
        <Button selected={tab === 'collections'} onClick={() => setTab('collections')}>Collections</Button>
        <Button selected={tab === 'race'} onClick={() => setTab('race')}>Races</Button>
        <Button selected={tab === 'map'} onClick={() => setTab('map')}>Maps</Button>
        {CATALOG_NAMES.map((name) => (
          <Button key={name} selected={tab === 'catalog' && catalog === name} onClick={() => openAsset(name)}>{CATALOGS[name].label}</Button>
        ))}
      </div>
      {tab === 'race' ? <RaceCreator /> : tab === 'map' ? <MapEditor /> : tab === 'collections' ? <CollectionsEditor /> : <CatalogPanel key={catalog} catalog={catalog} />}
    </div>
  )
}
