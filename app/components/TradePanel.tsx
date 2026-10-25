'use client'
import { useTradeLens } from '../hooks/useTradeLens'
import { X } from 'lucide-react'
import { Button, IconButton, Panel } from './ui'

// Trading with a merchant: put stacks down from the container panel, pick what
// to buy in the item sidebar and place it where it goes, and the panel counts.
export function TradePanel(){
  const { trading, view, start, cancel, toggleOffer, removeLine, confirm } = useTradeLens()

  if (!trading || !view) {
    return (
      <Panel title='Trade' actions={<Button size='xs' onClick={start}>trade</Button>}>
        <span className='text-xs text-muted'>put down coins or goods, take what the merchant sells</span>
      </Panel>
    )
  }

  return (
    <Panel title='Trade' meta={<>put down {view.offeredTotal} · cart {view.cost} · change {view.change}</>} pending
      actions={<>
        <Button size='xs' weight='solid' tone='good' disabled={!view.able} title={view.able ? 'make the trade' : view.why} onClick={confirm}>trade</Button>
        <Button size='xs' weight='ghost' onClick={cancel}>cancel</Button>
      </>}>
      <div className='flex flex-col gap-1 text-xs'>
        <span className='text-muted'>put down — offer stacks in the container panel</span>
        {view.offered.map((stack) => (
          <span key={stack.id} className='flex flex-row gap-2 items-center'>
            <span>{stack.name}{stack.amount > 1 ? ` ×${stack.amount}` : ''}</span>
            <span className='font-mono text-muted'>{stack.value}</span>
            <IconButton icon={X} tone='bad' className='ml-auto' aria-label={`take back ${stack.name}`} onClick={() => toggleOffer(stack.id)} />
          </span>
        ))}
      </div>
      <div className='flex flex-col gap-1 text-xs'>
        <span className='text-muted'>cart — pick in the item list, place where it goes</span>
        {view.cart.map((line, i) => (
          <span key={i} className={`flex flex-row gap-2 items-center ${line.fits ? '' : 'text-bad'}`}>
            <span>{line.name}{line.amount > 1 ? ` ×${line.amount}` : ''}</span>
            <span className='text-muted'>{line.where}</span>
            <span className='font-mono text-muted'>{line.price}</span>
            <IconButton icon={X} tone='bad' className='ml-auto' aria-label={`remove ${line.name} from the cart`} onClick={() => removeLine(i)} />
          </span>
        ))}
      </div>
      {view.why ? <span className='text-xs text-muted'>{view.why}</span> : null}
    </Panel>
  )
}
