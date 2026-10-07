import type { Character, Lens, RaceBonusKey } from '../../types'
import { RACE_BONUS_KEYS } from '../../types'
import { ABILITIES, ABILITY_KEYS } from '../../abilities'
import { withRaceDraft } from '../rules/race'
import weaponsCatalog from '../../../assets/weapons.json'

export type RaceAbilityRow = { key: string; name: string }

// creating.tex "Races": the race being made as the creator shows it — its
// traits and the abilities it has by name.
export type RacePanelView = {
  name: string
  description: string
  playable: boolean
  abilities: RaceAbilityRow[]
}

const abilityRow = (key: string): RaceAbilityRow => ({ key, name: key in ABILITIES ? ABILITIES[key as keyof typeof ABILITIES].name : key })

export function getRacePanel(c: Character): RacePanelView {
  return {
    name: c.raceDraft?.name ?? '',
    description: c.raceDraft?.description ?? '',
    playable: c.raceDraft?.playable ?? true,
    abilities: (c.raceDraft?.abilities ?? []).map(abilityRow),
  }
}

// The abilities the race could be given: every one it does not have yet.
export function getRaceAbilityOptions(c: Character): RaceAbilityRow[] {
  const has = new Set(c.raceDraft?.abilities ?? [])
  return ABILITY_KEYS.filter((key) => !has.has(key)).map(abilityRow)
}

// The weapons a part can attack with while empty: any in the weapon catalog
// (gear.tex "Unarmed", the Claws).
export function getNaturalWeaponOptions(): string[] {
  return Object.keys(weaponsCatalog)
}

// The race's bonus to each attribute and talent, as a dial.
export const raceBonusLenses = Object.fromEntries(RACE_BONUS_KEYS.map((key) => [key, {
  get: (c: Character) => c.raceDraft?.bonuses[key] ?? 0,
  set: (c: Character, value: number) => withRaceDraft(c, { bonuses: { ...c.raceDraft?.bonuses, [key]: value } }),
}])) as Record<RaceBonusKey, Lens<Character, number>>
