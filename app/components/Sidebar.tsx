'use client'
import { useState } from 'react'
import { CharacterSelector } from './CharacterSelector';
import { ContainerSelector } from './ContainerSelector';
import { ItemSelector } from './ItemSelector';
import { AbilitySelector } from './AbilitySelector';
import { SpellSelector } from './SpellSelector';

const PANELS = {
  Container: ContainerSelector,
  Item: ItemSelector,
  Ability: AbilitySelector,
  Spell: SpellSelector,
  Character: CharacterSelector,
} as const
type PanelName = keyof typeof PANELS
const PANEL_NAMES = Object.keys(PANELS) as PanelName[]

export function Sidebar(){

  const [selected, setSelected] = useState<PanelName | null>(null)
  const Panel = selected ? PANELS[selected] : null

  return(
    <div className='flex flex-col gap-2 h-full text-left'>
      <div className='flex flex-row flex-wrap gap-1 text-xs'>
        {PANEL_NAMES.map((name) => (
          <button key={name} type='button' aria-label={`sbar_${name.toLowerCase()}`}
            className={`py-1 px-2 rounded border ${selected === name ? 'border-accent text-accent bg-raised' : 'border-line text-muted hover:text-fg hover:bg-raised'}`}
            onClick={() => setSelected(name)}>{name}</button>
        ))}
      </div>
      <div className='flex flex-col gap-1 max-h-[85vh] overflow-y-auto pr-2'>
        {Panel ? <Panel /> : <span className='text-sm text-muted'>Pick a panel above.</span>}
      </div>
    </div>
  )
}
