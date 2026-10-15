'use client'
import { useState } from 'react'
import { Button, CatalogList, CollectionSelect, ConfirmDelete, ListButton, SectionLabel, TextInput, Tooltip, selectClass } from './ui'
import { CampaignParties } from './CampaignParties'
import { CampaignJournal } from './Journal'
import { useCampaignFiles, useCampaignMaps } from '../hooks/useCampaign'
import { useCollectionFilter } from '../hooks/useCollections'

// The campaign tab: the saved campaigns listed on the left, the one in play
// on the right — its name, its maps, and its parties with who is in them,
// when each is and whether it is in play. The table always plays some campaign; one never
// saved is named here to be saved. Opening or beginning another replaces it.
export function CampaignEditor() {
  const { file, campaigns, saveBar, setName, create, open, save, remove } = useCampaignFiles()
  // the saved campaign about to replace the one in play, or '' for a new one
  const [replacing, setReplacing] = useState<string | null>(null)
  const saved = campaigns.some((c) => c.id === file.id)

  return (
    <div className='grid grid-cols-12 gap-2 py-2 text-left'>
      <div className='col-span-3 flex flex-col gap-1 border-r border-line pr-2 max-h-[85vh] overflow-y-auto'>
        <CatalogList label='Campaigns' groups={[{ label: null, rows: campaigns }]} nameOf={(c) => c.name}
          beside={<Button size='xs' variant='good' onClick={() => setReplacing('')}>+ new</Button>}
          render={(c) => <ListButton key={c.id} selected={c.id === file.id} onClick={() => setReplacing(c.id)}>{c.name || '—'}</ListButton>} />
        {replacing !== null ?
          <div className='flex flex-col gap-1 p-1 border border-accent rounded text-xs'>
            <span>{replacing ? 'opening' : 'beginning'} a campaign replaces the one in play and throws away any fight; what was not saved is lost</span>
            <div className='flex flex-row gap-1'>
              <Button size='xs' variant='primary' aria-label='confirm replace' onClick={() => { if (replacing) open(replacing); else create(); setReplacing(null) }}>{replacing ? 'open' : 'begin'}</Button>
              <Button size='xs' aria-label='cancel replace' onClick={() => setReplacing(null)}>cancel</Button>
            </div>
          </div>
          : null}
      </div>
      <div className='col-span-9 flex flex-col gap-3 max-h-[85vh] overflow-y-auto pr-2'>
        <div className='flex flex-row items-center gap-2'>
          <span className='text-xs text-muted'>name</span>
          <TextInput className='w-64' aria-label='campaign name' placeholder='name it to save it' value={file.name} onChange={(e) => setName(e.target.value)} />
          {saved ? null : <span className='text-xs text-muted'>not saved yet</span>}
          <span className='grow' />
          <Tooltip text={saveBar ?? 'save the campaign and its characters'}>
            <Button variant='primary' disabled={saveBar !== null} onClick={save}>save</Button>
          </Tooltip>
          {saved ? <ConfirmDelete remove={() => remove(file.id)} /> : null}
        </div>
        {saveBar ? <span className='text-xs text-muted'>{saveBar}</span> : null}
        <SectionLabel>Maps</SectionLabel>
        <CampaignMaps />
        <SectionLabel>Parties</SectionLabel>
        <CampaignParties />
        <SectionLabel>Journal</SectionLabel>
        <CampaignJournal />
      </div>
    </div>
  )
}

// The campaign's maps: each a copy of one from the catalog, so what play
// changes on it stays in the campaign. A map taken away leaves the parties on
// it off the map.
function CampaignMaps() {
  const { maps, templates, add, remove } = useCampaignMaps()
  const filter = useCollectionFilter('maps')
  return (
    <div className='flex flex-col gap-1'>
      <div className='flex flex-row gap-1 items-center'>
        <CollectionSelect label='map collection' filter={filter} />
        <select aria-label='add map' className={selectClass} value='' onChange={(e) => add(e.target.value)}>
          <option value=''>add a map from the catalog…</option>
          {filter.keep(templates).map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
      </div>
      {maps.length === 0 ? <span className='text-xs text-muted'>no maps: every party is off the map</span> : null}
      {maps.map((m) => (
        <div key={m.id} className='flex flex-row gap-2 items-center text-xs'>
          <span className='text-sm'>{m.name}</span>
          <span className='text-muted'>{m.nodes} nodes · {m.parties.length > 0 ? m.parties.join(', ') : 'no party on it'}</span>
          <Button size='xs' variant='ghost' aria-label={`remove map ${m.name}`} title={m.parties.length > 0 ? `take the map away: ${m.parties.join(', ')} end up off the map` : 'take the map away'} onClick={() => remove(m.id)}>×</Button>
        </div>
      ))}
    </div>
  )
}
