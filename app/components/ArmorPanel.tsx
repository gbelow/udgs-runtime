'use client'
import { useActiveCharacterSelector } from '../hooks/useActiveCharacterSelector'
import { useArmorLens, useDamageTiers } from '../hooks/useArmorLens'
import { useCharacterCommands } from '../hooks/useCharacterCommands'
import { useItemLens } from '../hooks/useItemLens'

export function ArmorPanel(){
  const { panel: armor, drop } = useArmorLens()
  const { pending, selectWorn, clear } = useItemLens()
  // combat.tex "Damage Tiers" — thresholds, IL and wound chance all come from
  // the domain; this component only lays the table out.
  const tiers = useDamageTiers()
  const doffing = pending?.source === 'worn'

  return(
    <>
      <div className={'flex flex-row flex-wrap gap-3 items-center ' + (doffing ? 'text-green-300' : '')}>
        <span className='font-bold'>Armor: {armor.name}</span>
        {
          armor.worn ?
          <>
            <span>Size: {armor.worn.scale}{armor.worn.fits ? '' : ' (does not fit)'}</span>
            {
              doffing ?
              <input type='button' value='cancel' aria-label='cancel taking off armor' onClick={clear} className='border rounded px-1 text-xs' /> :
              armor.worn.canDoff ?
              <input type='button' value={armor.worn.doffCost === null ? 'take off' : `take off (${armor.worn.doffCost} AP +)`} aria-label='take off armor' title='then pick a slot group to put it in' onClick={selectWorn} className='border rounded px-1 text-xs' /> :
              <span className='text-xs text-gray-400'>takes minutes to take off</span>
            }
            {armor.worn.canDoff ? <input type='button' value='drop' aria-label='drop armor' onClick={drop} className='border rounded px-1 text-xs' /> : null}
          </> :
          <span className='text-xs text-gray-400'>wear armor from a container or the hands</span>
        }
      </div>
      <ArmorAddons />
      
      <table className='w-84 md:w-full text-center'>
        <thead>
          <tr >
            <th></th>
            <th>PROT</th>
            <th>RES </th>
            <th>INS </th>
            {/* <th>IL</th>
            <th>wound</th> */}
          </tr>
        </thead>
        <tbody>
          {
            tiers.map((row) => (
              <tr key={row.tier}>
                <td>T{row.tier}</td>
                <td>{row.blunt}</td>
                <td>{row.RES}</td>
                <td>{row.INS}</td>
                {/* <td>{row.IL}</td>
                <td>{row.woundChance > 0 ? Math.round(row.woundChance * 100) + '%' : '-'}</td> */}
              </tr>
            ))
          }
        </tbody>
      </table>
      <div className='flex gap-2 text-center justify-center'>
        <span>Penal {armor.burdenPenalty}</span>
        <span>Deflection {armor.deflection}</span>
        <span> {armor.properties}</span>
      </div>
      {
        armor.notes ?
        <textarea title='armorNotes' value={armor.notes} />
        : null
      }
    </>
  )
}

function ArmorAddons (){
  const { toggleGauntlets, toggleHelm } = useCharacterCommands()
  const hasGauntlets = useActiveCharacterSelector((c) => !!c.hasGauntlets) ?? false
  const hasHelm = useActiveCharacterSelector((c) => !!c.hasHelm) ?? false

  return(
    <div className='flex flex-row gap-2'>
        <div className='flex flex-col'>
          <label>Gauntlet</label>
          <input type='checkbox' aria-label={'gaunt'} name={'gaunt'} checked={hasGauntlets} onChange={toggleGauntlets} />
        </div>
        <div className='flex flex-col'>
          <label>Full Helm</label>
          <input type='checkbox' aria-label={'helm'} name={'helm'} checked={hasHelm} onChange={toggleHelm} />
        </div>
      </div>
  )
}
