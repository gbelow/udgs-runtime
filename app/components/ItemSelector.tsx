'use client'
import { useState } from 'react'
import { useItemLens } from '../hooks/useItemLens';
import type { ItemCatalogRow } from '../domain/item/lenses';
import { Button, ListButton, NumberInput, SectionLabel, TextInput } from './ui';

export function ItemSelector(){
  const { catalog, pending, amount, scale, select, setAmount, setScale, clear } = useItemLens()
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
        <TextInput className='w-full' placeholder='filter' aria-label='item filter' value={filter} onChange={(e) => setFilter(e.target.value)} />
        <NumberInput className='w-10 text-sm py-0.5' min={1} aria-label='item amount' title='amount' value={amount} onChange={(e) => setAmount(parseInt(e.target.value))} disabled={pending?.source !== 'catalog'} />
        <NumberInput className='w-10 text-sm py-0.5' min={1} max={7} aria-label='item size' title='size the item is made for' value={scale} onChange={(e) => setScale(parseInt(e.target.value))} disabled={pending?.source !== 'catalog'} />
      </div>
      {
        pending?.source === 'catalog' ?
        <div className='flex flex-row gap-2 items-center text-xs px-1 text-good'>
          <span className='truncate'>placing: {pending.key} ×{pending.amount} · size {pending.scale}</span>
          <Button size='xs' onClick={clear} className='ml-auto'>cancel</Button>
        </div> :
        <span className='text-xs text-muted px-1'>pick an item and its size, then a slot in a container or a hand</span>
      }
      {
        Object.entries(groups).map(([type, rows]) => (
          <div key={type} className='flex flex-col'>
            <SectionLabel className='px-1 pt-2'>{type}</SectionLabel>
            {rows.map((row) => (
              <ListButton key={row.key} aria-label={row.name} title={row.bulkName}
                selected={pending?.source === 'catalog' && pending.key === row.key}
                onClick={() => select(row.key)}>{row.name} <span className='text-muted text-xs'>· {row.bulkName}</span></ListButton>
            ))}
          </div>
        ))
      }
    </div>
  )
}
