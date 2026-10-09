'use client'
import { useItemLens } from '../hooks/useItemLens';
import { Button, CatalogList, ListButton, NumberInput } from './ui';
import { groupBy } from '../domain/utils';

export function ItemSelector(){
  const { catalog, pending, amount, scale, select, setAmount, setScale, clear } = useItemLens()

  return(
    <CatalogList label='item' groups={groupBy(catalog, (row) => row.group)} nameOf={(row) => row.name} beside={<>
      <NumberInput className='w-10 text-sm py-0.5' min={1} aria-label='item amount' title='amount' value={amount} onChange={(e) => setAmount(parseInt(e.target.value) || 1)} disabled={pending?.source !== 'catalog'} />
      <NumberInput className='w-10 text-sm py-0.5' min={1} max={7} aria-label='item size' title='size the item is made for' value={scale} onChange={(e) => setScale(parseInt(e.target.value) || 1)} disabled={pending?.source !== 'catalog'} />
    </>} render={(row) => (
      <ListButton key={row.key} aria-label={row.name} title={row.bulkName}
        selected={pending?.source === 'catalog' && pending.key === row.key}
        onClick={() => select(row.key)}>{row.name} <span className='text-muted text-xs'>· {row.bulkName} · {row.price}</span></ListButton>
    )}>
      {
        pending?.source === 'catalog' ?
        <div className='flex flex-row gap-2 items-center text-xs px-1 text-good'>
          <span className='truncate'>placing: {pending.key} ×{pending.amount} · size {pending.scale}</span>
          <Button size='xs' onClick={clear} className='ml-auto'>cancel</Button>
        </div> :
        <span className='text-xs text-muted px-1'>pick an item and its size, then a slot in a container or a hand</span>
      }
    </CatalogList>
  )
}
