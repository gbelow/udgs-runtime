import { FOCI, type Character, type CreationDraft, type Focus, type Priority, type Race, type SpellMethod, type Trainables } from '../../types'
import { FamilyKey } from '../../abilities'
import type { SpellKey } from '../../spells'
import type { LimitStressAction } from '../../lists'
import { settleStartingWealth } from '../../item/commands/wealth'
import { getBoughtStageCount, getCreationAbilityRaises, getCreationRaise, getCreationBuild, getRacialLevel, canClaimCreationSpell, getCreatedCharacter } from '../rules/creation'
import { canLearnSpell } from '../rules/spells'

// creating.tex "Character Creation", Step 1: the race the character is made
// from, or none. Only the race changes; it is put on the character when its
// prices are worked out (getCreationStart), so the name, the choices and
// everything bought stay.
export function setCreationRace(race: Race | null): (d: CreationDraft) => CreationDraft {
  return (d: CreationDraft) => ({ ...d, race })
}

export function setCreationName(name: string): (d: CreationDraft) => CreationDraft {
  return (d: CreationDraft) => ({ ...d, character: { ...d.character, name } })
}

// Step 2: a focus given a priority; the focus that held it takes the one given
// up, so every priority stays given once.
export function setCreationPriority(focus: Focus, priority: Priority): (d: CreationDraft) => CreationDraft {
  return (d: CreationDraft) => {
    const holder = FOCI.find((f) => d.priorities[f] === priority) ?? focus
    return { ...d, priorities: { ...d.priorities, [holder]: d.priorities[focus], [focus]: priority } }
  }
}

// A count set, and dropped once nothing is bought.
const counted = (record: Partial<Record<string, number>>, key: string, count: number): Record<string, number> =>
  Object.fromEntries(Object.entries({ ...record, [key]: count }).filter((entry): entry is [string, number] => (entry[1] ?? 0) > 0))

// creating.tex "Limit Stress Actions": "Each character must choose a limit
// stress action."
export function setCreationLimitStress(action: LimitStressAction | null): (d: CreationDraft) => CreationDraft {
  return (d: CreationDraft) => ({ ...d, character: { ...d.character, limitStress: action } })
}

// creating.tex "Convictions": "A character must adopt one worldview conviction
// and one temperament conviction during character creation", named on the
// proficiency each is trained as.
export function setCreationConviction(slot: 'conviction1' | 'conviction2', name: string): (d: CreationDraft) => CreationDraft {
  return (d: CreationDraft) => {
    const { trainables } = d.character
    return { ...d, character: { ...d.character, trainables: { ...trainables, [slot]: { ...trainables[slot], name } } } }
  }
}

// A level of a trainable bought or given back. A level is bought only where
// one can be; a pool may be overspent, since a priority changed later can
// overspend it anyway.
export function buyCreationLevel(key: keyof Trainables, change: 1 | -1): (d: CreationDraft) => CreationDraft {
  return (d: CreationDraft) => {
    const count = (d.trainables[key] ?? 0) + change
    if (count < 0 || (change > 0 && getCreationRaise(d, key) === null)) return d
    return { ...d, trainables: counted(d.trainables, key, count) as CreationDraft['trainables'] }
  }
}

// A level of a knowledge bought or given back.
export function buyCreationKnowledge(name: string, change: 1 | -1): (d: CreationDraft) => CreationDraft {
  return (d: CreationDraft) => {
    const count = (d.knowledges[name] ?? 0) + change
    return count < 0 ? d : { ...d, knowledges: counted(d.knowledges, name, count) }
  }
}

// The next stage of an ability family bought, or the last bought given back.
// The draft keeps the level bought up to, counted from the race's.
export function buyCreationStage(family: FamilyKey, change: 1 | -1): (d: CreationDraft) => CreationDraft {
  return (d: CreationDraft) => {
    const racial = getRacialLevel(d, family)
    const bought = getBoughtStageCount(d, family)
    if (bought + change < 0 || (change > 0 && !(family in getCreationAbilityRaises(d)))) return d
    const level = racial + bought + change
    return { ...d, abilities: counted(d.abilities, family, level > racial ? level : 0) }
  }
}

// A spell chosen by a method it can be learned by, or given back (null),
// paid or claimed free.
export function setCreationSpell(key: SpellKey, method: SpellMethod | null): (d: CreationDraft) => CreationDraft {
  return (d: CreationDraft) => {
    const { [key]: _chosen, ...spells } = d.spells
    if (method === null) return key in d.spells ? { ...d, spells } : d
    if (!canLearnSpell(key, method)(getCreationBuild({ ...d, spells }))) return d
    return { ...d, spells: { ...spells, [key]: { method, free: false } } }
  }
}

// abilities.tex "Magic Theory": a spell claimed as one of the free ones.
export function claimCreationSpell(key: SpellKey): (d: CreationDraft) => CreationDraft {
  return (d: CreationDraft) => (canClaimCreationSpell(d, key) ? { ...d, spells: { ...d.spells, [key]: { method: 'wizard', free: true } } } : d)
}

// Gear moved on the character being made: whatever the updater changes on the
// character as it stands (race bonuses and levels bought included, so fits and
// prices are worked out for them) is written to the draft's own character.
export function updateCreationCharacter(updater: (c: Character) => Character): (d: CreationDraft) => CreationDraft {
  return (d: CreationDraft) => {
    const created = getCreatedCharacter(d)
    const updated = updater(created)
    const changed = (Object.keys(updated) as (keyof Character)[]).filter((key) => updated[key] !== created[key])
    return changed.length === 0 ? d : { ...d, character: { ...d.character, ...Object.fromEntries(changed.map((key) => [key, updated[key]])) } }
  }
}

// The character the draft makes: what is bought, with the gold the gear did
// not use settled.
export function getFinishedCharacter(d: CreationDraft): Character {
  return settleStartingWealth(getCreatedCharacter(d))
}
