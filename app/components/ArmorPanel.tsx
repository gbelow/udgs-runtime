'use client'
import { useArmorLens, useArmorPieces, useDamageTiers } from '../hooks/useArmorLens'
import { useItemLens } from '../hooks/useItemLens'
import { Button, Panel } from './ui'

export function ArmorPanel(){
  const { panel: armor, equipView, equip, drop } = useArmorLens()
  const { pending, selectWorn, clear } = useItemLens()
  // combat.tex "Damage Tiers" — thresholds, IL and wound chance all come from
  // the domain; this component only lays the table out.
  const tiers = useDamageTiers()
  const doffing = pending?.source === 'worn'

  const actions = (
    <>
      {
        armor.worn ?
        <>
          {
            doffing ?
            <Button size='xs' aria-label='cancel taking off armor' onClick={clear}>cancel</Button> :
            armor.worn.canDoff ?
            <Button size='xs' aria-label='take off armor' title='then pick a slot group to put it in' onClick={selectWorn}>{armor.worn.doffCost === null ? 'take off' : `take off (${armor.worn.doffCost} AP +)`}</Button> :
            <span className='text-xs text-muted'>takes minutes to take off</span>
          }
          {armor.worn.canDoff ? <Button size='xs' variant='ghost' aria-label='drop armor' onClick={drop}>drop</Button> : null}
        </> : null
      }
      {
        equipView ?
        equipView.wearable ?
        <Button size='xs' variant='good' aria-label='equip pending armor' onClick={equip}>equip</Button> :
        <span className='text-xs text-muted'>{equipView.why}</span>
        : null
      }
    </>
  )

  return(
    <Panel title={<>Armor <span className='font-normal'>{armor.name}</span></>} pending={doffing}
      meta={armor.worn ? <>size {armor.worn.scale}{armor.worn.fits ? '' : <span className='text-bad'> · does not fit</span>}</> : 'wear armor from a container, the hands or the catalog'}
      actions={actions}>
      <ArmorAddons />
      <table className='w-full text-xs'>
        <thead>
          <tr className='text-[10px] uppercase tracking-wider text-muted'>
            <th className='text-left font-medium px-1 pb-1 border-b border-line'>tier</th>
            <th className='text-right font-medium px-1 pb-1 border-b border-line'>PROT</th>
            <th className='text-right font-medium px-1 pb-1 border-b border-line'>RES</th>
            <th className='text-right font-medium px-1 pb-1 border-b border-line'>INS</th>
          </tr>
        </thead>
        <tbody className='font-mono'>
          {
            tiers.map((row) => (
              <tr key={row.tier} className='hover:bg-raised'>
                <td className='px-1 py-0.5 font-sans'>T{row.tier}</td>
                <td className='px-1 py-0.5 text-right'>{row.blunt}</td>
                <td className='px-1 py-0.5 text-right'>{row.RES}</td>
                <td className='px-1 py-0.5 text-right'>{row.INS}</td>
              </tr>
            ))
          }
        </tbody>
      </table>
      <div className='flex flex-row flex-wrap gap-x-3 gap-y-1 text-xs text-muted'>
        <span>penalty <span className={`font-mono ${armor.burdenPenalty ? 'text-bad' : 'text-fg'}`}>{armor.burdenPenalty}</span></span>
        <span>deflection <span className='font-mono text-fg'>{armor.deflection}</span></span>
        <span>{armor.material} · hardness <span className='font-mono text-fg'>{armor.hardness}</span></span>
        {armor.properties.length ? <span>{armor.properties.join(', ')}</span> : null}
      </div>
      {
        armor.notes ?
        <textarea title='armorNotes' className='border border-line rounded p-1 text-xs bg-surface' value={armor.notes} readOnly />
        : null
      }
    </Panel>
  )
}

// The gauntlets and the closed helmet: each put on or taken off, and the
// helmet's visor raised or lowered, with what that costs in play.
function ArmorAddons (){
  const { pieces, gauntlets, helm, visor } = useArmorPieces()
  if (!pieces) return null

  return(
    <div className='flex flex-row flex-wrap gap-2 items-center text-xs'>
      <Button size='xs' variant={pieces.gauntlets.worn ? 'primary' : 'default'} aria-label={pieces.gauntlets.worn ? 'doff gauntlets' : 'don gauntlets'}
        title={pieces.gauntlets.worn ? 'gauntlets on: -3 prestidigitation, accuracy and climbing; the hands are armored and fight with the gauntlet' : 'no gauntlets'}
        onClick={gauntlets}>
        {pieces.gauntlets.worn ? 'doff gauntlets' : 'don gauntlets'}{pieces.gauntlets.cost !== null ? <span className='ml-1 font-mono text-muted'>{pieces.gauntlets.cost} AP</span> : null}
      </Button>
      <Button size='xs' variant={pieces.helm.worn ? 'primary' : 'default'} aria-label={pieces.helm.worn ? 'doff helm' : 'don helm'}
        title={pieces.helm.worn ? 'closed helmet on' : 'no helmet'}
        onClick={helm}>
        {pieces.helm.worn ? 'doff helm' : 'don helm'}{pieces.helm.cost !== null ? <span className='ml-1 font-mono text-muted'>{pieces.helm.cost} AP</span> : null}
      </Button>
      {pieces.visor ?
        <Button size='xs' variant={pieces.visor.open ? 'default' : 'primary'} aria-label={pieces.visor.open ? 'close visor' : 'open visor'}
          title={pieces.visor.open ? 'visor up: no helmet penalties, the head can be bypassed' : 'visor down: -2 reflex and detection, no bypass at the head'}
          onClick={visor}>
          {pieces.visor.open ? 'visor up' : 'visor down'}{pieces.visor.cost !== null ? <span className='ml-1 font-mono text-muted'>{pieces.visor.cost} AP</span> : null}
        </Button>
      : null}
    </div>
  )
}
