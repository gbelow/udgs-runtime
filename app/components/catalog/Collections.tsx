'use client'
import { useState } from 'react'
import { Button, CatalogList, ConfirmDelete, ListButton, SectionLabel, TextInput, Tooltip, selectClass } from '../ui'
import { useCollectionCommands, useCollectionEditor } from '../../hooks/useCollections'
import { useCampaignList } from '../../hooks/useCampaign'
import { getKindLabel } from '../../forms/catalogs'
import { CATALOG_KINDS, type CatalogKind } from '../../domain/campaign/types'
import type { CatalogRow, CollectionView } from '../../domain/campaign/projections/collections'

// The collections of one catalog's entries: the ones read off the catalog,
// whole and by category, and the curated ones the profile sees — their own,
// each filled by ticking entries and shared with whom they choose, and those
// shared with them or with the campaign in play.
export function CollectionsEditor() {
  const [kind, setKind] = useState<CatalogKind>('characters')
  const [picked, setPicked] = useState<string | null>(null)
  const { collections, groups } = useCollectionEditor(kind)
  const { create, ownerName, editable } = useCollectionCommands()
  const open = collections.find((c) => c.id === picked) ?? null
  const switchKind = (k: CatalogKind) => { setKind(k); setPicked(null) }

  return (
    <div className='grid grid-cols-12 gap-2 text-left'>
      <div className='col-span-3 flex flex-col gap-1 border-r border-line pr-2 max-h-[85vh] overflow-y-auto'>
        <select aria-label='catalog' className={selectClass} value={kind} onChange={(e) => switchKind(e.target.value as CatalogKind)}>
          {CATALOG_KINDS.map((k) => <option key={k} value={k}>{getKindLabel(k)}</option>)}
        </select>
        <CatalogList label='Collections' groups={[{ label: null, rows: collections }]} nameOf={(c) => c.name}
          beside={<Button size='xs' variant='good' onClick={() => setPicked(create(kind))}>+ new</Button>}
          render={(c) => (
            <ListButton key={c.id} selected={c.id === picked} onClick={() => setPicked(c.id)}>
              {c.name || '—'} <span className='text-muted'>· {c.keys.length}{c.curated ? (editable(c.id) ? '' : ` · ${ownerName(c.owner)}'s`) : ' · catalog'}</span>
            </ListButton>
          )} />
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
// click on an entry puts it in one of the profile's own or takes it out.
function Collection({ collection, groups, close }: { collection: CollectionView, groups: { label: string | null, rows: CatalogRow[] }[], close: () => void }) {
  const { rename, remove, set, editable, ownerName } = useCollectionCommands()
  const mine = editable(collection.id)
  const keys = new Set(collection.keys)

  return (
    <>
      <div className='flex flex-row items-center gap-2'>
        {mine ? (
          <>
            <TextInput className='w-64' aria-label='collection name' placeholder='name it' defaultValue={collection.name} onBlur={(e) => rename(collection.id, e.target.value)} />
            <span className='grow' />
            <ConfirmDelete remove={() => { remove(collection.id); close() }} />
          </>
        ) : (
          <span className='text-sm'>{collection.name} <span className='text-xs text-muted'>· {collection.curated ? `${ownerName(collection.owner)}'s, shared with you` : 'read off the catalog'}</span></span>
        )}
      </div>
      {mine ? <Sharing collection={collection} /> : null}
      <CatalogList wide label={collection.name} groups={groups} nameOf={(r) => r.name}
        render={(r) => (
          <ListButton key={r.key} aria-pressed={keys.has(r.key)} selected={keys.has(r.key)} disabled={!mine}
            onClick={() => set(collection.id, r.key, !keys.has(r.key))}>{r.name}</ListButton>
        )} />
    </>
  )
}

// Whom one of the profile's collections is shared with: other profiles by
// name, and every member of a campaign the profile plays.
function Sharing({ collection }: { collection: CollectionView }) {
  const { share, others, sharedWith } = useCollectionCommands()
  const { campaigns } = useCampaignList()
  const shared = sharedWith(collection.id)
  const toggle = (to: 'profiles' | 'campaigns', id: string, on: boolean, name: string) => (
    <Button key={id} size='xs' selected={on} aria-pressed={on} onClick={() => share(collection.id, to, id, !on)}>{name || '—'}</Button>
  )
  return (
    <div className='flex flex-col gap-1 text-xs'>
      <SectionLabel>shared with</SectionLabel>
      <div className='flex flex-row flex-wrap gap-1 items-center'>
        <span className='text-muted w-20'>profiles</span>
        {others.length ? others.map((p) => toggle('profiles', p.id, shared.profiles.includes(p.id), p.name)) : <span className='text-muted'>no other profiles</span>}
      </div>
      <div className='flex flex-row flex-wrap gap-1 items-center'>
        <Tooltip text='every member of the campaign reads it'><span className='text-muted w-20'>campaigns</span></Tooltip>
        {campaigns.length ? campaigns.map((c) => toggle('campaigns', c.id, shared.campaigns.includes(c.id), c.name)) : <span className='text-muted'>no saved campaigns</span>}
      </div>
    </div>
  )
}
