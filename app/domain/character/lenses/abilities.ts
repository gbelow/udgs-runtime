import { Character } from '../../types'
import { ABILITIES, ABILITY_KEYS, AbilityKey } from '../../abilities'

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
  learnedStage: number // 0 when none of the stages is learned
  next: AbilityStageView | null // the stage a click would learn, if any
  top: AbilityStageView | null // the highest learned stage — the one a click would forget
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
      learnedStage: 0,
      next: null,
      top: null,
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
    if (learned) row.learnedStage = Math.max(row.learnedStage, ability.stage)
    families.set(ability.family, row)
  }
  for (const row of families.values()) {
    row.stages.sort((a, b) => a.stage - b.stage)
    row.next = row.stages.find((s) => s.learnable) ?? null
    row.top = row.stages.filter((s) => s.learned).at(-1) ?? null
  }
  return [...families.values()]
}

// The character's own abilities, collapsed the same way: one row per family
// with every stage's text kept, so the sheet reads "Keen Eyes 2/3" and a step
// back is a click on the top stage.
export function getLearnedAbilityRows(c: Character): AbilityFamilyView[] {
  return getAbilityCatalogRows(c).filter((row) => row.learnedStage > 0)
}

