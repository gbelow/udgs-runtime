'use client'
import { useContainerLens } from '../hooks/useContainerLens'
import { useItemLens } from '../hooks/useItemLens'
import { useTradeLens } from '../hooks/useTradeLens'
import type { ContainerSlotView } from '../domain/item/projections/containers'
import { Minus, X } from 'lucide-react'
import { Button, IconButton, Panel } from './ui'

export function ContainerPanel(){
  const { panels, burden, purse, startingWealth, putOnView, putOn, takeOff } = useContainerLens()
  const { pending, clear } = useItemLens()

  return(
    <Panel title='Containers' meta={<>{purse} · burden · {burden.label}</>} pending={!!pending}>
      {
        startingWealth ?
        <div className='flex flex-row flex-wrap gap-x-3 text-xs'>
          <span className='text-muted'>starting wealth {startingWealth.budget}</span>
          <span className={startingWealth.over ? 'text-bad' : ''}>{startingWealth.left} {startingWealth.over ? 'over' : 'left'}</span>
          {startingWealth.overSpared ? <span className='text-bad'>coins kept above {startingWealth.spared}</span> : null}
        </div>
        : null
      }
      {
        pending ?
        <div className='flex flex-row flex-wrap gap-2 items-center text-xs text-good'>
          <span>{pending.source === 'catalog' ? `placing ${pending.key} ×${pending.amount}` : pending.source === 'worn' ? 'taking armor off' : 'storing from hand'} — pick a slot group</span>
          {putOnView ? (putOnView.able
            ? <Button size='xs' weight='subtle' tone='good' aria-label='put on pending container' onClick={putOn}>{putOnView.cost === null ? 'put on' : `put on (${putOnView.cost} AP)`}</Button>
            : <span className='text-muted'>{putOnView.why}</span>) : null}
          <Button size='xs' onClick={clear}>cancel</Button>
        </div>
        : null
      }
      {
        panels.length === 0 ?
        <span className='text-xs text-muted'>none equipped — pick one in the Item tab and put it on</span> :
        panels.map((panel) => (
          <div key={panel.key} className='flex flex-col gap-1 rounded border border-line px-1.5 py-1'>
            <div className='flex flex-row flex-wrap gap-x-3 items-baseline text-xs'>
              <span className='text-sm'>{panel.name}</span>
              <span className='text-muted'>{panel.kind} · burden {panel.burden}</span>
              {panel.money ? <span className='font-mono'>{panel.money}</span> : null}
              {panel.penalty && panel.penalty.value > 0 ? <span className='text-bad font-mono'>−{panel.penalty.value}{panel.penalty.lame ? ' · lame' : ''}</span> : null}
              {panel.inner ? <span className='ml-auto text-muted'>{panel.inner}</span> : <Button size='xs' weight='subtle' className='ml-auto' title='into the hands, with what it carries' onClick={() => takeOff(panel.key)}>take off</Button>}
            </div>
            {panel.slots.map((group) => <SlotGroupRow key={group.slot} containerKey={panel.key} group={group} />)}
          </div>
        ))
      }
    </Panel>
  )
}

function SlotGroupRow({ containerKey, group }: { containerKey: string, group: ContainerSlotView }){
  const { pending, place, remove, draw, wear, putOn } = useItemLens()
  const { trading, isOffered, toggleOffer } = useTradeLens()
  const buying = trading && pending?.source === 'catalog'
  const dimmed = group.fits === false

  return(
    <div className={`flex flex-row flex-wrap gap-2 items-baseline text-xs ${dimmed ? 'text-muted' : ''}`}>
      <span className='w-28 shrink-0 text-muted'>
        {group.slot} ({group.bulkName})
      </span>
      <span className={`w-8 shrink-0 font-mono ${group.available < 0 ? 'text-bad' : ''}`}>{group.used}/{group.numSlots}</span>
      {
        group.fits ?
        <Button size='xs' weight='subtle' tone='good' aria-label={`place in ${containerKey} ${group.slot}`} onClick={() => place(containerKey, group.slot)}>{buying ? '+ cart' : group.storeCost === null ? '+ place' : `+ store (${group.storeCost} AP)`}</Button>
        : null
      }
      <div className='flex flex-row flex-wrap gap-1'>
        {group.items.map((item) => (
          <span key={item.id} className='border border-line rounded pl-1.5 pr-0.5 py-0.5 flex flex-row gap-1 items-center' title={`${item.bulkName} · ${item.slots} slot${item.slots === 1 ? '' : 's'}`}>
            <span>{item.name}{item.amount > 1 ? ` ×${item.amount}` : ''}</span>
            {item.drawable ? <Button size='xs' weight='subtle' aria-label={`draw ${item.name}`} title={item.drawCost === null ? 'take in hand' : `take in hand for ${item.drawCost} AP`} onClick={() => draw(containerKey, item.id)}>{item.drawCost === null ? 'draw' : `draw ${item.drawCost}AP`}</Button> : null}
            {item.wear ? <Button size='xs' weight='subtle' aria-label={`wear ${item.name}`} disabled={!item.wear.wearable} title={item.wear.wearable ? 'put on' : item.wear.why} onClick={() => wear(containerKey, item.id)}>wear</Button> : null}
            {item.putOn ? <Button size='xs' weight='subtle' aria-label={`put on ${item.name}`} disabled={!item.putOn.able} title={item.putOn.able ? (item.putOn.cost === null ? 'put on' : `put on for ${item.putOn.cost} AP`) : item.putOn.why} onClick={() => putOn(containerKey, item.id)}>{item.putOn.cost === null ? 'put on' : `put on ${item.putOn.cost}AP`}</Button> : null}
            {trading && item.offerable ? <Button size='xs' weight='subtle' tone='good' active={isOffered(item.id)} aria-label={`offer ${item.name}`} onClick={() => toggleOffer(item.id)}>{isOffered(item.id) ? 'offered' : 'offer'}</Button> : null}
            {item.amount > 1 ? <IconButton icon={Minus} aria-label={`remove one ${item.name}`} onClick={() => remove(containerKey, item.id, 1)} /> : null}
            <IconButton icon={X} tone='bad' aria-label={`remove ${item.name}`} onClick={() => remove(containerKey, item.id)} />
          </span>
        ))}
      </div>
    </div>
  )
}
