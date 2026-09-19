'use client'
import { useActiveCharacterSelector } from '../hooks/useActiveCharacterSelector'
import { useArmorLens, useDamageTiers } from '../hooks/useArmorLens'
import { useCharacterCommands } from '../hooks/useCharacterCommands'
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
        <Button size='xs' variant='good' aria-label='equip pending armor' onClick={equip}>{equipView.cost === null ? 'equip' : `don (${equipView.cost} AP)`}</Button> :
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

function ArmorAddons (){
  const { toggleGauntlets, toggleHelm } = useCharacterCommands()
  const hasGauntlets = useActiveCharacterSelector((c) => !!c.hasGauntlets) ?? false
  const hasHelm = useActiveCharacterSelector((c) => !!c.hasHelm) ?? false

  return(
    <div className='flex flex-row gap-4 text-xs'>
      <label className='flex flex-row items-center gap-1.5 cursor-pointer'>
        <input type='checkbox' className='accent-accent' aria-label={'gaunt'} name={'gaunt'} checked={hasGauntlets} onChange={toggleGauntlets} />
        gauntlets
      </label>
      <label className='flex flex-row items-center gap-1.5 cursor-pointer'>
        <input type='checkbox' className='accent-accent' aria-label={'helm'} name={'helm'} checked={hasHelm} onChange={toggleHelm} />
        full helm
      </label>
    </div>
  )
}
