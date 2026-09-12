import { Character } from '../../types'
import { ABILITIES, ABILITY_KEYS, AbilityKey } from '../../abilities'
import { isAbilityActive } from './effects'

// abilities.tex "Acquiring abilities": "It is not possible to acquire an
// ability unless the requirements are met" and each is acquired once. Only the
// stage chain is enforced here — a stage requires the one before it.
export function canLearnAbility(key: AbilityKey): (c: Character) => boolean {
  return (c: Character) =>
    !c.abilities.includes(key) && ABILITIES[key].requires.every((req) => c.abilities.includes(req))
}

export type AbilityStageView = {
  key: AbilityKey
  name: string
  stage: number
  learned: boolean
  learnable: boolean
  description: string
}

// One row per family, its stages in order, so the sidebar can show "Sprinter"
// once and let the reader step through I, II, III.
export type AbilityFamilyView = {
  family: string
  section: string
  usage: string
  stages: AbilityStageView[]
  next: AbilityStageView | null // the stage a click would learn, if any
  top: AbilityStageView | null // the highest learned stage — the one a click would forget
  progress: string // "2/3" for a multi-stage family, "" otherwise
  toggle: AbilityStageView | null // the learned stage that carries the family's switch, if any
  active: boolean // whether that switch is on
}

export function getAbilityCatalogRows(c: Character): AbilityFamilyView[] {
  const families = new Map<string, AbilityFamilyView>()
  for (const key of ABILITY_KEYS) {
    const ability = ABILITIES[key]
    const row = families.get(ability.family) ?? {
      family: ability.family,
      section: ability.section,
      usage: ability.usage,
      stages: [],
      next: null,
      top: null,
      progress: '',
      toggle: null,
      active: false,
    }
    const learned = c.abilities.includes(key)
    const stage: AbilityStageView = {
      key,
      name: ability.name,
      stage: ability.stage,
      learned,
      learnable: canLearnAbility(key)(c),
      description: ability.description,
    }
    row.stages.push(stage)
    families.set(ability.family, row)
  }
  for (const row of families.values()) {
    row.stages.sort((a, b) => a.stage - b.stage)
    row.next = row.stages.find((s) => s.learnable) ?? null
    row.top = row.stages.filter((s) => s.learned).at(-1) ?? null
    row.toggle = row.stages.find((s) => s.learned && ABILITIES[s.key].activation === 'toggle') ?? null
    row.active = row.toggle !== null && isAbilityActive(c, row.toggle.key)
    // A conviction's stages are its levels and may start at 0, so progress
    // reads the stage number rather than a count of stages.
    if (row.stages.length > 1) row.progress = `${row.top?.stage ?? 0}/${row.stages.at(-1)!.stage}`
  }
  return [...families.values()]
}

// The character's own abilities, collapsed the same way: one row per family
// with every stage's text kept, so the sheet reads "Keen Eyes 2/3" and a step
// back is a click on the top stage.
export function getLearnedAbilityRows(c: Character): AbilityFamilyView[] {
  return getAbilityCatalogRows(c).filter((row) => row.top !== null)
}

