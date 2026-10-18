'use client'
import { ConfirmDelete } from '../ui'
import { useBoardMapList } from '../../hooks/useBoardMaps'

// The battle maps kept: the developer's, shared with everyone, and the
// profile's own. A map is made on the scene's board and kept from its tools;
// here they are looked over and put away.
export function BoardMapsEditor() {
  const { rows, devServer, remove } = useBoardMapList()
  return (
    <div className='flex flex-col gap-1 text-left text-sm'>
      {rows.length === 0 ? <span className='text-muted'>No battle maps kept yet: paint a board in a scene and keep it from the GM board tools.</span> : null}
      {rows.map((r) => (
        <div key={r.id} className='flex flex-row items-center gap-2'>
          <span>{r.name || '—'}</span>
          <span className='text-xs text-muted'>{r.shared ? 'shared with everyone' : 'yours'}</span>
          <span className='grow' />
          {!r.shared || devServer ? <ConfirmDelete remove={() => remove(r.id)} /> : null}
        </div>
      ))}
    </div>
  )
}
