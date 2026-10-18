'use client'
import { useState, type ReactNode } from 'react'
import { Button, CatalogList, CollectionSelect, ConfirmDelete, ListButton, SectionLabel, Tabs, TextInput, Tooltip, selectClass } from './ui'
import { CampaignParties } from './CampaignParties'
import { CampaignJournal } from './Journal'
import { CampaignTimeline } from './Timeline'
import { useCampaignFiles, useCampaignMaps, useCampaignMembers, useCampaignRequests, useJoinRequests } from '../hooks/useCampaign'
import { useRole } from '../hooks/useRole'
import { useJoinTable } from '../hooks/useTable'
import { useCollectionFilter } from '../hooks/useCollections'
import { MapEditingContext, useCampaignMapEditor } from '../hooks/useMap'
import { MapBody } from './MapEditor'

const CAMPAIGN_TABS = [
  { id: 'members', label: 'Members' },
  { id: 'maps', label: 'Maps' },
  { id: 'parties', label: 'Parties' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'journal', label: 'Journal' },
] as const
type CampaignTab = (typeof CAMPAIGN_TABS)[number]['id']

// The campaign tab: the saved campaigns listed on the left, the one in play
// on the right — its name, then in tabs its members, maps, and parties with who is in them,
// when each is and whether it is in play, the timeline and the journal. The table always plays some campaign; one never
// saved is named here to be saved. Opening or beginning another replaces it.
export function CampaignEditor() {
  const { file, campaigns, saveBar, create, open } = useCampaignFiles()
  const joinTable = useJoinTable()
  // the saved campaign about to replace the one in play, or '' for a new one
  const [replacing, setReplacing] = useState<string | null>(null)
  const [tab, setTab] = useState<CampaignTab>('members')

  return (
    <div className='grid grid-cols-12 gap-2 py-2 text-left'>
      <div className='col-span-3 flex flex-col gap-1 border-r border-line pr-2 max-h-[85vh] overflow-y-auto'>
        <CatalogList label='Campaigns' groups={[{ label: null, rows: campaigns }]} nameOf={(c) => c.name}
          beside={<Button size='xs' variant='good' onClick={() => setReplacing('')}>+ new</Button>}
          render={(c) => (
            <div key={c.id} className='flex flex-row items-center gap-1'>
              <div className='flex-1 min-w-0'><ListButton selected={c.id === file.id} onClick={() => setReplacing(c.id)}>{c.name || '—'}{c.locked ? <span className='text-muted'> · locked</span> : null}</ListButton></div>
              {c.member === 'player' ? <Button size='xs' aria-label={`join the table of ${c.name}`} title="play it at the GM's table, from the run screen" onClick={() => joinTable(c.id, c.name)}>join table</Button> : null}
            </div>
          )} />
        {replacing !== null ?
          <ConfirmRow text={`${replacing ? 'opening' : 'beginning'} a campaign replaces the one in play, fight and all; the autosave on this screen keeps it until it is opened again`}
            confirm={replacing ? 'open' : 'begin'} variant='primary' onConfirm={() => { if (replacing) open(replacing); else create(); setReplacing(null) }} onCancel={() => setReplacing(null)} />
          : null}
        <SectionLabel>Join a campaign</SectionLabel>
        <JoinCampaign />
      </div>
      <div className='col-span-9 flex flex-col gap-3 max-h-[85vh] overflow-y-auto pr-2'>
        <CampaignFileBar />
        {saveBar ? <span className='text-xs text-muted'>{saveBar}</span> : null}
        <Tabs label='campaign sections' tabs={CAMPAIGN_TABS} value={tab} onChange={setTab} />
        {tab === 'members' ? <><CampaignMembers /><CampaignRequests /></> : null}
        {tab === 'maps' ? <CampaignMaps /> : null}
        {tab === 'parties' ? <CampaignParties /> : null}
        {tab === 'timeline' ? <CampaignTimeline /> : null}
        {tab === 'journal' ? <CampaignJournal /> : null}
      </div>
    </div>
  )
}

// The campaign in play as it stands in storage: its name, when it was saved
// and autosaved, and saving it, as a copy too, locking it, unlocking it,
// going back to what is saved and deleting it. A locked campaign is saved
// only as a copy, and locking one throws its fight away first.
function CampaignFileBar() {
  const { file, saved, fighting, copiedFrom, savedText, autosavedText, saveBar, deleteBar, setName, restart, save, saveAsCopy, lock, unlock, remove } = useCampaignFiles()
  const { gmTools } = useRole()
  // what is waiting to be confirmed
  const [pending, setPending] = useState<'copy' | 'lock' | 'restart' | null>(null)
  const [copyName, setCopyName] = useState('')
  const cancel = () => setPending(null)
  return (
    <div className='flex flex-col gap-1'>
      <div className='flex flex-row flex-wrap items-center gap-2'>
        <span className='text-xs text-muted'>name</span>
        <TextInput className='w-64' aria-label='campaign name' placeholder='name it to save it' value={file.name} disabled={file.locked} onChange={(e) => setName(e.target.value)} />
        {file.locked ? <span className='text-xs px-1 rounded border border-accent text-accent'>locked</span> : null}
        <span className='text-xs text-muted'>
          {savedText ? `saved ${savedText}` : saved ? 'saved' : 'not saved yet'}
          {autosavedText ? ` · autosaved ${autosavedText}` : ''}
          {copiedFrom ? ` · copy of ${copiedFrom}` : ''}
        </span>
        <span className='grow' />
        {file.locked ? null : (
          <Tooltip text={saveBar ?? 'save the campaign and its characters, fight and all'}>
            <Button variant='primary' disabled={saveBar !== null} onClick={save}>save</Button>
          </Tooltip>
        )}
        {saved ? <Button variant={file.locked ? 'primary' : undefined} onClick={() => { setCopyName(`${file.name} (copy)`); setPending('copy') }}>save as copy…</Button> : null}
        {saved ? <Button title='throw away what was played since it was saved' onClick={() => setPending('restart')}>restart from saved</Button> : null}
        {gmTools && file.locked ? <Button onClick={unlock}>unlock</Button> : null}
        {gmTools && !file.locked ? (
          <Tooltip text={saveBar ?? 'save the campaign and lock it: whatever is saved after is saved as a copy'}>
            <Button disabled={saveBar !== null} onClick={() => fighting ? setPending('lock') : lock()}>lock</Button>
          </Tooltip>
        ) : null}
        {saved && gmTools ? (deleteBar ? <Tooltip text={deleteBar}><Button variant='bad' disabled>delete</Button></Tooltip> : <ConfirmDelete remove={() => remove(file.id)} />) : null}
      </div>
      {pending === 'copy' ? (
        <ConfirmRow text={`save what is in play as a new campaign, now in play; ${file.name || 'this one'} stays as it was saved`} confirm='save copy' variant='primary'
          disabled={!copyName.trim()} onConfirm={() => { saveAsCopy(copyName); cancel() }} onCancel={cancel}>
          <TextInput className='w-48' aria-label='copy name' value={copyName} onChange={(e) => setCopyName(e.target.value)} />
        </ConfirmRow>
      ) : null}
      {pending === 'lock' ? (
        <ConfirmRow text='a locked campaign starts with no fight: everyone sent from the roster goes back to it as the fight left them' confirm='drop the fight and lock'
          onConfirm={() => { lock(); cancel() }} onCancel={cancel} />
      ) : null}
      {pending === 'restart' ? (
        <ConfirmRow text={`go back to the campaign as it was saved${savedText ? ` ${savedText}` : ''}; what was played since is lost`} confirm='restart'
          onConfirm={() => { restart(); cancel() }} onCancel={cancel} />
      ) : null}
    </div>
  )
}

// A press asked about before it is made: what it does, anything it needs
// filled in, and confirming or cancelling it.
function ConfirmRow({ text, confirm, variant = 'bad', disabled, onConfirm, onCancel, children }: { text: string, confirm: string, variant?: 'bad' | 'primary', disabled?: boolean, onConfirm: () => void, onCancel: () => void, children?: ReactNode }) {
  return (
    <div className='flex flex-row flex-wrap items-center gap-1 p-1 border border-accent rounded text-xs'>
      <span>{text}</span>
      {children}
      <Button size='xs' variant={variant} aria-label={`confirm ${confirm}`} disabled={disabled} onClick={onConfirm}>{confirm}</Button>
      <Button size='xs' aria-label={`cancel ${confirm}`} onClick={onCancel}>cancel</Button>
    </div>
  )
}

// Who plays the campaign and as what. Only a GM recasts them; the campaign
// always keeps one. What changes here is kept when the campaign is saved.
function CampaignMembers() {
  const { members, others, set } = useCampaignMembers()
  const { gmTools } = useRole()
  const locked = gmTools ? null : 'only a GM changes who plays'
  return (
    <div className='flex flex-col gap-1 text-xs'>
      {members.length === 0 ? <span className='text-muted'>nobody yet: whoever saves it is its GM</span> : null}
      {members.map((m) => (
        <div key={m.id} className='flex flex-row gap-1 items-center'>
          <span className='w-40 text-sm truncate'>{m.name}{m.me ? <span className='text-muted'> (you)</span> : null}</span>
          <Tooltip text={locked}>
            <Button size='xs' selected={m.role === 'gm'} disabled={!!locked} onClick={() => set(m.id, 'gm')}>GM</Button>
          </Tooltip>
          <Tooltip text={locked ?? m.playerBar}>
            <Button size='xs' selected={m.role === 'player'} disabled={!!locked || !!m.playerBar} onClick={() => set(m.id, 'player')}>player</Button>
          </Tooltip>
          <Tooltip text={locked ?? m.removeBar}>
            <Button size='xs' variant='ghost' aria-label={`remove ${m.name}`} disabled={!!locked || !!m.removeBar} onClick={() => set(m.id, null)}>×</Button>
          </Tooltip>
        </div>
      ))}
      {gmTools && others.length > 0 ? (
        <select aria-label='add member' className={`${selectClass} w-fit`} value='' onChange={(e) => set(e.target.value, 'player')}>
          <option value=''>add a profile as a player…</option>
          {others.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      ) : null}
    </div>
  )
}

// Asking to bring one of your characters into a campaign, one character at a
// time, and the requests still waiting on its GM.
function JoinCampaign() {
  const { campaigns, characters, pending, request, withdraw, refresh } = useJoinRequests()
  const [campaign, setCampaign] = useState('')
  const [character, setCharacter] = useState('')
  return (
    <div className='flex flex-col gap-1 text-xs'>
      <select aria-label='campaign to join' className={selectClass} value={campaign} onChange={(e) => setCampaign(e.target.value)}>
        <option value=''>campaign…</option>
        {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name || '—'}</option>)}
      </select>
      <select aria-label='character to bring' className={selectClass} value={character} onChange={(e) => setCharacter(e.target.value)}>
        <option value=''>{characters.length ? 'your character…' : 'save a character of yours first'}</option>
        {characters.map((c) => <option key={c.id} value={c.id}>{c.name || '—'}</option>)}
      </select>
      <div className='flex flex-row gap-1'>
        <Button size='xs' variant='primary' disabled={!campaign || !character} onClick={() => { request(campaign, character); setCharacter('') }}>ask to join</Button>
        <Button size='xs' variant='ghost' title='look again for answers' onClick={refresh}>refresh</Button>
      </div>
      {pending.map((q) => (
        <div key={`${q.campaign}:${q.character}`} className='flex flex-row gap-1 items-center'>
          <span className='flex-1 truncate'>{q.name || '—'} → {q.campaignName || '—'}</span>
          <Button size='xs' variant='ghost' aria-label={`withdraw ${q.name}`} onClick={() => withdraw(q.campaign, q.character)}>withdraw</Button>
        </div>
      ))}
    </div>
  )
}

// The requests to join the campaign in play, answered by its GM: one accepted
// waits on the roster in no party until it switches into one.
function CampaignRequests() {
  const { requests, accept, decline, refresh } = useCampaignRequests()
  const { gmTools } = useRole()
  if (!gmTools) return null
  return (
    <div className='flex flex-col gap-1 text-xs'>
      <div className='flex flex-row gap-1 items-center'>
        <span className='text-muted'>{requests.length ? 'asking to join' : 'nobody asking to join'}</span>
        <Button size='xs' variant='ghost' title='look again for requests' onClick={refresh}>refresh</Button>
      </div>
      {requests.map((q) => (
        <div key={q.character} className='flex flex-row gap-1 items-center'>
          <span className='w-40 truncate'>{q.name || '—'} <span className='text-muted'>by {q.profileName}</span></span>
          <Button size='xs' variant='good' aria-label={`accept ${q.name}`} title='onto the roster, in no party' onClick={() => accept(q.character)}>accept</Button>
          <Button size='xs' variant='ghost' aria-label={`decline ${q.name}`} onClick={() => decline(q.character)}>decline</Button>
        </div>
      ))}
    </div>
  )
}

// The campaign's maps: each a copy of one from the catalog, so what play
// changes on it stays in the campaign, edited here as the catalog's are. A
// map taken away leaves the parties on it off the map.
function CampaignMaps() {
  const { maps, templates, add, remove } = useCampaignMaps()
  const filter = useCollectionFilter('maps')
  const [editing, setEditing] = useState<string | null>(null)
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
        <div key={m.id} className='flex flex-col gap-1'>
          <div className='flex flex-row gap-2 items-center text-xs'>
            <span className='text-sm'>{m.name}</span>
            <span className='text-muted'>{m.nodes} nodes · {m.parties.length > 0 ? m.parties.join(', ') : 'no party on it'}</span>
            <Button size='xs' variant='ghost' selected={editing === m.id} onClick={() => setEditing(editing === m.id ? null : m.id)}>edit</Button>
            <Button size='xs' variant='ghost' aria-label={`remove map ${m.name}`} title={m.parties.length > 0 ? `take the map away: ${m.parties.join(', ')} end up off the map` : 'take the map away'} onClick={() => remove(m.id)}>×</Button>
          </div>
          {editing === m.id ? <CampaignMapEditor mapId={m.id} /> : null}
        </div>
      ))}
    </div>
  )
}

// One of the campaign's maps open in the map editor; a node a party stands on
// says so and stays.
function CampaignMapEditor({ mapId }: { mapId: string }) {
  const editing = useCampaignMapEditor(mapId)
  if (!editing) return null
  return (
    <MapEditingContext.Provider value={editing}>
      <div className='flex flex-col gap-4 ml-4 pl-2 border-l border-line text-sm'>
        <MapBody />
      </div>
    </MapEditingContext.Provider>
  )
}
