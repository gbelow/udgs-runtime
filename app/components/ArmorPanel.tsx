'use client'
import { useGetActiveCharacter } from '../hooks/useGetActiveCharacter'
import { makeCharacter } from '../domain/factories'
import { ArmorSchema } from '../domain/types'

export function ArmorPanel(){
  const character = useGetActiveCharacter()
  const armor = character ? character.armor : ArmorSchema.parse({})
  const characteristics = character ? character.characteristics : makeCharacter('').characteristics
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
            <td>{characteristics.RES + armor.prot}</td>
            <td>{characteristics.TGH + armor.TGH}</td>
            <td>{characteristics.INS + armor.INS}</td>
          </tr>
          <tr>
            <td>serious</td>
            <td>{characteristics.RES*2 + armor.prot}</td>
            <td>{characteristics.TGH*2 + armor.TGH}</td>
            <td>{characteristics.INS*2 + armor.INS}</td>
          </tr>
          <tr>
            <td>deadly</td>
            <td>{characteristics.RES*3 + armor.prot}</td>
            <td>{characteristics.TGH*3 + armor.TGH}</td>
            <td>{characteristics.INS*3 + armor.INS}</td>
          </tr>
          <tr>
            <td>sudden</td>
            <td>{characteristics.RES*6 + armor.prot}</td>
            <td>{characteristics.TGH*6 + armor.TGH}</td>
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