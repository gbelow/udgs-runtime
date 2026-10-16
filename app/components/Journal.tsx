'use client'
import { useState } from 'react'
import { Button, inputClass, selectClass } from './ui'
import { useActivePartyId, useJournal } from '../hooks/useCampaign'
import { useRole } from '../hooks/useRole'
import type { EntryView } from '../domain/campaign/projections/journal'

// The campaign's journal: what play recorded and what was written by hand,
// party by party, newest first. A note is written to a party at its moment or
// to the campaign as a whole; the GM may keep one from the players. Whoever
// wrote a note may rewrite or throw it away, and the GM any entry.
export function CampaignJournal() {
  const [filter, setFilter] = useState<string>('all')
  const { view, parties, write, edit, remove } = useJournal(filter === 'all' ? 'all' : filter || null)
  const { gmTools } = useRole()

  return (
    <div className='flex flex-col gap-2'>
      <NoteForm parties={parties} write={write} gmTools={gmTools} />
      <div className='flex flex-row gap-2 items-center'>
        <span className='text-xs text-muted'>show</span>
        <select aria-label='journal party' className={selectClass} value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value='all'>every party</option>
          <option value=''>the campaign</option>
          {parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      {view.length === 0 ? <span className='text-xs text-muted'>nothing written yet: play records itself here, and notes are written above</span> : null}
      {view.map((group) => (
        <div key={group.id ?? ''} className='flex flex-col gap-1'>
          <span className='text-sm font-medium'>{group.name}</span>
          {group.entries.map((e) => <Entry key={e.id} entry={e} gmTools={gmTools} edit={edit} remove={remove} />)}
        </div>
      ))}
    </div>
  )
}

// A note to write, to a party or to the campaign, kept from the players or
// not.
function NoteForm({ parties, write, gmTools }: { parties: { id: string, name: string }[], write: (party: string | null, text: string, gmOnly: boolean) => void, gmTools: boolean }) {
  const [party, setParty] = useState('')
  const [text, setText] = useState('')
  const [gmOnly, setGmOnly] = useState(false)
  const submit = () => { write(party || null, text, gmOnly); setText('') }
  return (
    <div className='flex flex-col gap-1 border border-line rounded p-2'>
      <div className='flex flex-row flex-wrap gap-2 items-center'>
        <span className='text-xs text-muted'>note to</span>
        <select aria-label='note party' className={selectClass} value={party} onChange={(e) => setParty(e.target.value)}>
          <option value=''>the campaign</option>
          {parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {gmTools ? (
          <label className='text-xs text-muted flex items-center gap-1'>
            <input type='checkbox' aria-label='GM only' checked={gmOnly} onChange={(e) => setGmOnly(e.target.checked)} />GM only
          </label>
        ) : null}
        <Button size='xs' variant='primary' className='ml-auto' disabled={text.trim() === ''} onClick={submit}>write</Button>
      </div>
      <textarea aria-label='note' rows={2} className={`${inputClass} text-sm`} placeholder='what happened, what to remember' value={text} onChange={(e) => setText(e.target.value)} />
    </div>
  )
}

// The newest few entries of the active character's party, read at a glance
// beside the sequence being played; the whole journal is in the Campaign tab.
export function RecentJournal() {
  const party = useActivePartyId()
  return party === null ? null : <PartyJournal party={party} />
}

function PartyJournal({ party }: { party: string }) {
  const { view } = useJournal(party, 3)
  const entries = view.flatMap((group) => group.entries)
  return (
    <div className='flex flex-col gap-1'>
      <span className='text-xs text-muted'>journal · the whole of it is in the Campaign tab</span>
      {entries.length === 0 ? <span className='text-xs text-muted'>nothing written yet</span> : null}
      {entries.map((e) => (
        <div key={e.id} className='flex flex-col border-l border-line pl-2'>
          <span className='flex flex-row flex-wrap gap-2 items-baseline text-xs'>
            <span className='text-muted'>{e.when}</span>
            <span className={e.note ? 'text-accent' : 'text-muted'}>{e.kind}</span>
            {e.title ? <span className='text-sm'>{e.title}</span> : null}
          </span>
          {e.lines.slice(0, 1).map((line, i) => <span key={i} className='text-xs text-muted truncate'>{line}</span>)}
        </div>
      ))}
    </div>
  )
}

type EntryProps = {
  entry: EntryView
  gmTools: boolean
  edit: (id: string, text: string, gmOnly: boolean) => void
  remove: (id: string) => void
}

// One entry: when, what kind, and what it says; a long one folds to its
// first line. A note its viewer may change opens in place to be rewritten.
function Entry({ entry, gmTools, edit, remove }: EntryProps) {
  const [draft, setDraft] = useState<{ text: string, gmOnly: boolean } | null>(null)
  const long = entry.lines.length > 3
  const head = (
    <span className='flex flex-row flex-wrap gap-2 items-baseline text-xs'>
      <span className='text-muted'>{entry.when}</span>
      <span className={entry.note ? 'text-accent' : 'text-muted'}>{entry.kind}{entry.gmOnly ? ' · GM only' : ''}</span>
      {entry.title ? <span className='text-sm'>{entry.title}</span> : null}
      <span className='ml-auto flex flex-row gap-1'>
        {entry.editable && draft === null ? <Button size='xs' variant='ghost' aria-label={`edit entry ${entry.id}`} title='rewrite the note' onClick={() => setDraft({ text: entry.lines.join('\n'), gmOnly: entry.gmOnly })}>edit</Button> : null}
        {entry.removable ? <Button size='xs' variant='ghost' aria-label={`delete entry ${entry.id}`} title='throw the entry away' onClick={() => remove(entry.id)}>×</Button> : null}
      </span>
    </span>
  )
  if (draft !== null) {
    const save = () => { edit(entry.id, draft.text, draft.gmOnly); setDraft(null) }
    return (
      <div className='flex flex-col gap-1 border-l border-line pl-2'>
        {head}
        <textarea aria-label={`note ${entry.id}`} rows={3} className={`${inputClass} text-sm`} value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} />
        <div className='flex flex-row gap-2 items-center'>
          {gmTools ? (
            <label className='text-xs text-muted flex items-center gap-1'>
              <input type='checkbox' aria-label='GM only' checked={draft.gmOnly} onChange={(e) => setDraft({ ...draft, gmOnly: e.target.checked })} />GM only
            </label>
          ) : null}
          <Button size='xs' className='ml-auto' onClick={() => setDraft(null)}>cancel</Button>
          <Button size='xs' variant='primary' disabled={draft.text.trim() === ''} onClick={save}>save</Button>
        </div>
      </div>
    )
  }
  const body = entry.lines.map((line, i) => <span key={i} className={`text-xs whitespace-pre-wrap ${entry.note ? 'text-fg text-sm' : 'text-muted'}`}>{line}</span>)
  return long ? (
    <details className='border-l border-line pl-2'>
      <summary className='cursor-pointer select-none list-none'>{head}</summary>
      <div className='flex flex-col'>{body}</div>
    </details>
  ) : (
    <div className='flex flex-col border-l border-line pl-2'>{head}{body}</div>
  )
}
