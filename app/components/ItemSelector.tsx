'use client'
import { useState } from 'react'
import { useItemLens } from '../hooks/useItemLens';
import type { ItemCatalogRow } from '../domain/item/lenses';

export function ItemSelector(){
  const { catalog, pending, select, setAmount, clear } = useItemLens()
  const [filter, setFilter] = useState('')

  const needle = filter.trim().toLowerCase()
  const visible = needle ? catalog.filter((row) => row.name.toLowerCase().includes(needle)) : catalog
  const groups = visible.reduce<Record<string, ItemCatalogRow[]>>((acc, row) => {
    (acc[row.type] ??= []).push(row)
    return acc
  }, {})

  return(
    <div className='flex flex-col w-full gap-1'>
      <div className='flex flex-row gap-1 items-center'>
        <input className='p-1 border border-white rounded w-full text-sm' type='text' placeholder='filter' aria-label='item filter' value={filter} onChange={(e) => setFilter(e.target.value)} />
        <input className='w-12 p-1 border border-white rounded text-center text-sm' type='number' inputMode='numeric' min={1} aria-label='item amount' title='amount' value={pending?.source === 'catalog' ? pending.amount : 1} onChange={(e) => setAmount(parseInt(e.target.value))} disabled={pending?.source !== 'catalog'} />
      </div>
      {
        pending?.source === 'catalog' ?
        <div className='flex flex-row gap-2 items-center text-xs px-1'>
          <span className='truncate'>placing: {pending.key} ×{pending.amount}</span>
          <input type='button' value='cancel' onClick={clear} className='border rounded px-1 ml-auto' />
        </div> :
        <span className='text-xs text-gray-400 px-1'>pick an item, then a slot in a container or a hand</span>
      }
      {
        Object.entries(groups).map(([type, rows]) => (
          <div key={type} className='flex flex-col'>
            <span className='text-xs uppercase text-gray-400 px-1 pt-1'>{type}</span>
            {rows.map((row) => (
              <input key={row.key} type='button' aria-label={row.name} title={row.bulkName}
                value={`${row.name} · ${row.bulkName}`}
                className={'text-left px-1 hover:bg-gray-500 text-sm ' + (pending?.source === 'catalog' && pending.key === row.key ? 'bg-white text-black' : '')}
                onClick={() => select(row.key, pending?.source === 'catalog' ? pending.amount : 1)}
              />
            ))}
          </div>
        ))
      }
    </div>
  )
}
