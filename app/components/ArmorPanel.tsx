'use client'
import { putGauntlets, putHelm } from '../domain/character/commands'
import { makeCharacter } from '../domain/factories'
import { useActiveCharacterSelector, useActiveCharacterUpdate } from '../hooks/useActiveCharacterSelector'
import { useArmorLens } from '../hooks/useArmorLens'
import { useActiveCharacterDataLens } from '../hooks/useCharacterDataLens'

export function ArmorPanel(){
  const [armor] = useArmorLens()
  const [TGH] = useActiveCharacterDataLens('TGH')

  const fallback = makeCharacter('')
  // const effectiveRES = useCharacteristicLens('RES')[0] ?? fallback.characteristics.RES
  const effectiveTGH = TGH ?? fallback.TGH
  // const effectiveINS = useCharacteristicLens('INS')[0] ?? fallback.characteristics.INS

  return(
    <>
      <div className='font-bold '>Armor: {armor.name}</div>
      <ArmorAddons />
      
      <table className='w-84 md:w-full text-center'>
        <thead>
          <tr >
            <th></th>
            <th>PROT (blunt)</th>
            <th>RES (cutting)</th>
            <th>INS (burn)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>T0</td>
            <td>{ armor.protection}</td>
            <td>{ armor.RES + (armor.RESlayer > 0 ? "/" + armor.RESlayer : '')}</td>
            <td>{ armor.INS}</td>
          </tr>
          <tr>
            <td>T1</td>
            <td>{effectiveTGH + armor.protection}</td>
            <td>{effectiveTGH + armor.RES}</td>
            <td>{effectiveTGH + armor.INS}</td>
          </tr>
          <tr>
            <td>T2</td>
            <td>{effectiveTGH*2 + armor.protection}</td>
            <td>{effectiveTGH*2 + armor.RES}</td>
            <td>{effectiveTGH*2 + armor.INS}</td>
          </tr>
          <tr>
            <td>T3</td>
            <td>{effectiveTGH*3 + armor.protection}</td>
            <td>{effectiveTGH*3 + armor.RES}</td>
            <td>{effectiveTGH*3 + armor.INS}</td>
          </tr>
          <tr>
            <td>T4</td>
            <td>{effectiveTGH*4 + armor.protection}</td>
            <td>{effectiveTGH*4 + armor.RES}</td>
            <td></td>
          </tr>
        </tbody>
      </table>
      <div className='flex gap-2 text-center justify-center'>
        {/* <span>Poise {armor.poise + effectiveTGH}</span> */}
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
  const update = useActiveCharacterUpdate()
  const hasGauntlets = useActiveCharacterSelector((c) => !!c.hasGauntlets) ?? false
  const hasHelm = useActiveCharacterSelector((c) => !!c.hasHelm) ?? false

  return(
    <div className='flex flex-row gap-2'>
        <div className='flex flex-col'>
          <label>Gauntlet</label>
          <input type='checkbox' aria-label={'gaunt'} name={'gaunt'} checked={hasGauntlets} onChange={() => update(putGauntlets)} />
        </div>
        <div className='flex flex-col'>
          <label>Full Helm</label>
          <input type='checkbox' aria-label={'helm'} name={'helm'} checked={hasHelm} onChange={() => update(putHelm)} />
        </div>
      </div>
  )
}
