'use client'
import { useActiveCharacterSelector } from '../hooks/useActiveCharacterSelector'
import { useArmorLens, useDamageTiers } from '../hooks/useArmorLens'
import { useCharacterCommands } from '../hooks/useCharacterCommands'

export function ArmorPanel(){
  const [armor] = useArmorLens()
  // combat.tex "Damage Tiers" — thresholds, IL and wound chance all come from
  // the domain; this component only lays the table out.
  const tiers = useDamageTiers()

  return(
    <>
      <div className='font-bold '>Armor: {armor.name}</div>
      <ArmorAddons />
      
      <table className='w-84 md:w-full text-center'>
        <thead>
          <tr >
            <th></th>
            <th>PROT (blunt)</th>
            <th>RES (piercing)</th>
            <th>INS (burn)</th>
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
                <td>{row.RES + (row.RESlayer > 0 ? "/" + row.RESlayer : '')}</td>
                <td>{row.INS}</td>
                {/* <td>{row.IL}</td>
                <td>{row.woundChance > 0 ? Math.round(row.woundChance * 100) + '%' : '-'}</td> */}
              </tr>
            ))
          }
        </tbody>
      </table>
      <div className='flex gap-2 text-center justify-center'>
        <span>Penal {armor.penalty}</span>
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
