'use client'
import { makeCharacter } from '../domain/factories'
import { ArmorSchema } from '../domain/types'
import { useArmorLens } from '../hooks/useArmorLens'
import { useCharacteristicLens } from '../hooks/useCharacteristicLens'

export function ArmorPanel(){
  const [armor] = useArmorLens()

  const fallback = makeCharacter('')
  const effectiveRES = useCharacteristicLens('RES')[0] ?? fallback.characteristics.RES
  const effectiveTGH = useCharacteristicLens('TGH')[0] ?? fallback.characteristics.TGH
  const effectiveINS = useCharacteristicLens('INS')[0] ?? fallback.characteristics.INS

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
