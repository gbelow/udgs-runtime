'use client'
import { useGetActiveCharacter } from '../hooks/useGetActiveCharacter'
import { makeCharacter } from '../domain/factories'
import { ArmorSchema } from '../domain/types'
import { makeCharacteristicSelector } from '../domain/selectors/factories'

export function ArmorPanel(){
  const character = useGetActiveCharacter()
  const armor = character ? character.armor : ArmorSchema.parse({})

  // NOTE: characteristics.RES/TGH/INS are now stored as *base* additive terms.
  // Use selectors to get the effective derived thresholds.
  const fallback = makeCharacter('')
  const effectiveRES = character ? makeCharacteristicSelector('RES')(character) : makeCharacteristicSelector('RES')(fallback)
  const effectiveTGH = character ? makeCharacteristicSelector('TGH')(character) : makeCharacteristicSelector('TGH')(fallback)
  const effectiveINS = character ? makeCharacteristicSelector('INS')(character) : makeCharacteristicSelector('INS')(fallback)

  return(
    <>
    <div>Armor: {armor.name}</div>
      <table className='w-84 md:w-full text-center'>
        <thead>
          <tr >
            <th></th>
            <th>PROT</th>
            <th>TGH</th>
            <th>INS</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>armor</td>
            <td>{ armor.prot}</td>
            <td>{ armor.TGH}</td>
            <td>{ armor.INS}</td>
          </tr>
          <tr>
            <td>light</td>
            <td>{effectiveRES + armor.prot}</td>
            <td>{effectiveTGH + armor.TGH}</td>
            <td>{effectiveINS + armor.INS}</td>
          </tr>
          <tr>
            <td>serious</td>
            <td>{effectiveRES*2 + armor.prot}</td>
            <td>{effectiveTGH*2 + armor.TGH}</td>
            <td>{effectiveINS*2 + armor.INS}</td>
          </tr>
          <tr>
            <td>deadly</td>
            <td>{effectiveRES*3 + armor.prot}</td>
            <td>{effectiveTGH*3 + armor.TGH}</td>
            <td>{effectiveINS*3 + armor.INS}</td>
          </tr>
          <tr>
            <td>sudden</td>
            <td>{effectiveRES*6 + armor.prot}</td>
            <td>{effectiveTGH*6 + armor.TGH}</td>
            <td></td>
          </tr>
        </tbody>
      </table>
      <div className='flex gap-2 text-center justify-center'>
        <span>RES {armor.RES}</span>
        <span>Penal {armor.penalty}</span>
        <span>Coverage {armor.cover}</span>
      </div>
    </>
  )
}
