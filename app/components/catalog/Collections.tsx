'use client'
import { useState } from 'react'
import { Button, CatalogList, ConfirmDelete, ListButton, TextInput, selectClass } from '../ui'
import { useCollectionCommands, useCollectionEditor } from '../../hooks/useCollections'
import { getKindLabel } from '../../forms/catalogs'
import { CATALOG_KINDS, type CatalogKind } from '../../domain/campaign/types'
import type { CatalogRow, CollectionView } from '../../domain/campaign/projections/collections'

// The collections of one catalog's entries: the ones read off the catalog,
// whole and by category, and the GM's own, each filled by ticking entries.
// The GM's are the campaign in play's and saved with it.
export function CollectionsEditor() {
  const [kind, setKind] = useState<CatalogKind>('characters')
  const [picked, setPicked] = useState<string | null>(null)
  const { collections, groups } = useCollectionEditor(kind)
  const { campaign, create } = useCollectionCommands()
  const open = collections.find((c) => c.id === picked) ?? null
  const switchKind = (k: CatalogKind) => { setKind(k); setPicked(null) }

  return (
    <div className='grid grid-cols-12 gap-2 text-left'>
      <div className='col-span-3 flex flex-col gap-1 border-r border-line pr-2 max-h-[85vh] overflow-y-auto'>
        <select aria-label='catalog' className={selectClass} value={kind} onChange={(e) => switchKind(e.target.value as CatalogKind)}>
          {CATALOG_KINDS.map((k) => <option key={k} value={k}>{getKindLabel(k)}</option>)}
        </select>
        <span className='text-xs text-muted'>kept in {campaign ? `the campaign ${campaign}` : 'the campaign in play, not saved yet'}</span>
        <CatalogList label='Collections' groups={[{ label: null, rows: collections }]} nameOf={(c) => c.name}
          beside={<Button size='xs' variant='good' onClick={() => setPicked(create(kind))}>+ new</Button>}
          render={(c) => <ListButton key={c.id} selected={c.id === picked} onClick={() => setPicked(c.id)}>{c.name || '—'} <span className='text-muted'>· {c.keys.length}{c.curated ? '' : ' · catalog'}</span></ListButton>} />
      </div>
      <div className='col-span-9 flex flex-col gap-2 max-h-[85vh] overflow-y-auto pr-2'>
        {open ? <Collection key={open.id} collection={open} groups={groups} close={() => setPicked(null)} /> : (
          <span className='text-sm text-muted'>Pick a collection to see what is in it, or make a new one.</span>
        )}
      </div>
    </div>
  )
}

// One collection and every entry of its catalog, the ones in it marked; a
// click on an entry puts it in a curated one or takes it out.
function Collection({ collection, groups, close }: { collection: CollectionView, groups: { label: string | null, rows: CatalogRow[] }[], close: () => void }) {
  const { rename, remove, set } = useCollectionCommands()
  const keys = new Set(collection.keys)

  return (
    <>
      <div className='flex flex-row items-center gap-2'>
        {collection.curated ? (
          <>
            <TextInput className='w-64' aria-label='collection name' placeholder='name it' value={collection.name} onChange={(e) => rename(collection.id, e.target.value)} />
            <span className='grow' />
            <ConfirmDelete remove={() => { remove(collection.id); close() }} />
          </>
        ) : (
          <span className='text-sm'>{collection.name} <span className='text-xs text-muted'>· read off the catalog</span></span>
        )}
      </div>
      <CatalogList wide label={collection.name} groups={groups} nameOf={(r) => r.name}
        render={(r) => (
          <ListButton key={r.key} aria-pressed={keys.has(r.key)} selected={keys.has(r.key)} disabled={!collection.curated}
            onClick={() => set(collection.id, r.key, !keys.has(r.key))}>{r.name}</ListButton>
        )} />
    </>
  )
}
