'use client'

import { useWeaponLens } from "../hooks/useWeaponLens";
import { useCombatActions } from "../hooks/useCombatActions";
import type { AttackVariant } from "../domain/character/rules/gear";
import type { AttackKind } from "../domain/types";
import { Button, Panel } from "./ui";

const th = 'font-medium px-1 pb-1 border-b border-line'

// The weapons in hand as a table; a melee row's variants declare a strike
// with that row filled in, so the action panel opens at the target step.
export function WeaponPanel(){
  const { panels } = useWeaponLens()
  const { declare } = useCombatActions()

  const AttackButtons = ({ variants, weaponKey, attack, kind }: { variants: AttackVariant[], weaponKey: string, attack: string, kind: AttackKind }) =>{
    return(
      <span className='flex flex-row flex-wrap gap-1'>
        {
          variants.map(el =>
            <Button size='xs' key={el.name} disabled={kind !== 'melee'}
              title={`blunt ${el.blunt} · cut ${el.cut} · ${el.AP} AP${el.STA ? ` · ${el.STA} STA` : ''}${el.penalty ? ` · ${-el.penalty} to hit` : ''}`}
              onClick={() => declare({ kind: 'strike', weaponKey, attack, variant: el.name })}>
              {el.name} <span className='font-mono'>{el.blunt}/{el.cut}</span>
            </Button>
          )
        }
      </span>
    )
  }

  return(
    <Panel title='Weapons'>
      {
        panels.map((panel) => (
          <div key={panel.key} className='flex flex-col gap-1'>
            <div className='flex flex-row flex-wrap gap-x-3 gap-y-0.5 items-baseline text-xs'>
              <span className='text-sm'>{panel.name}</span>
              <span className='text-muted'>size {panel.scale}{!panel.wieldable ? <span className='text-bad'> · too large to wield</span> : panel.oversize ? <span className='text-bad'> · oversize: +1 AP, STR−5</span> : ''}</span>
              {panel.shield && <span className='text-muted'>{panel.shield.body ? 'body shield' : 'shield'} · cover +{panel.shield.cover}</span>}
              <span className='text-muted'>{panel.natural ? `${panel.grip} free` : `${panel.grip}h`}</span>
            </div>
            <div className='overflow-x-auto'>
              <table className='w-full text-xs'>
                <thead>
                  <tr className='text-[10px] uppercase tracking-wider text-muted text-left'>
                    <th className={th}>attack</th>
                    <th className={th}>hands</th>
                    <th className={`${th} text-right`}>RES</th>
                    <th className={`${th} text-right`}>blunt</th>
                    <th className={`${th} text-right`}>cut</th>
                    <th className={`${th} text-right`}>AP</th>
                    <th className={th}>reach</th>
                    <th className={`${th} text-right`}>DEF</th>
                    <th className={th}>properties</th>
                    <th className={th}></th>
                  </tr>
                </thead>
                <tbody>
                  {
                    panel.rows.map((row, index) =>
                      <tr key={panel.name+index.toString()} className={`hover:bg-raised ${row.usable && !row.needsFocus ? '' : 'text-muted'}`}>
                        <td className='px-1 py-0.5'>{row.name}</td>
                        <td className='px-1 py-0.5'>{row.handed}</td>
                        <td className='px-1 py-0.5 text-right font-mono'>{row.RES}</td>
                        <td className='px-1 py-0.5 text-right font-mono'>{row.blunt}</td>
                        <td className='px-1 py-0.5 text-right font-mono'>{row.cut}</td>
                        <td className='px-1 py-0.5 text-right font-mono'>{row.AP + (row.reload ? '+' + row.reload : '')}</td>
                        <td className='px-1 py-0.5'>{row.range}</td>
                        <td className='px-1 py-0.5 text-right font-mono'>{row.block ?? '–'}</td>
                        <td className='px-1 py-0.5 text-muted'>{row.properties.join(', ')}</td>
                        <td className='px-1 py-0.5'>{row.needsFocus ? <span className='text-muted'>needs focus surge</span> : <AttackButtons variants={row.variants} weaponKey={panel.key} attack={row.name} kind={row.kind} />}</td>
                      </tr>
                    )
                  }
                </tbody>
              </table>
            </div>
          </div>
        ))
      }
    </Panel>
  )
}
