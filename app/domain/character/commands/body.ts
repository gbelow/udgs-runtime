import { ArmorSchema, PartWoundSchema, StanceSchema, presetPart, type Armor, type BodyPart, type Character, type HitLocation, type PartWound, type Shape, type Stance } from '../../types'
import { isCampaignCharacter } from '../../utils'

// The race's side of a creature: its body, stance, natural armor and grid
// shape. A race sets them, and in free creation the character changes them
// freely.

// A new body changes what is held and what is wounded: a stack no gripping
// part still holds is let go of, and a wound on a part that is gone, or that
// no longer takes it, is gone with it.
export function withBody(c: Character, body: BodyPart[]): Character {
  const gripped = new Set(body.filter((part) => part.grip && !part.lost).map((part) => part.itemId))
  const settled = body.map((part) => (part.itemId && !(part.grip && !part.lost) ? { ...part, itemId: '' } : part))
  const held = c.held.filter((item) => gripped.has(item.id))
  if (!isCampaignCharacter(c)) return { ...c, body: settled, held }
  const wounds = c.injuries.wounds.filter((w) => settled.some((p) => p.id === w.part && p.wounds.some((pw) => pw.name === w.name)))
  return { ...c, body: settled, held, injuries: { ...c.injuries, wounds } }
}

// Every creature has a chest: the last one is never removed or made into
// something else.
function keepsChest(body: BodyPart[]): boolean {
  return body.some((part) => part.location === 'chest')
}

// A part of the kind, as the humanoid's row describes it.
export function addBodyPart(location: HitLocation): (c: Character) => Character {
  return (c: Character) => withBody(c, [...c.body, presetPart(location, { name: location })])
}

export function removeBodyPart(partId: string): (c: Character) => Character {
  return (c: Character) => {
    const body = c.body.filter((part) => part.id !== partId)
    return body.length === c.body.length || !keepsChest(body) ? c : withBody(c, body)
  }
}

// What a part is and does; its id, what it holds and whether it is lost are
// not edited here.
export type BodyPartEdit = Partial<Pick<BodyPart, 'name' | 'location' | 'grip' | 'climbs' | 'naturalWeapon' | 'aimPenalty' | 'maxTier' | 'flags'>>

export function editBodyPart(partId: string, edit: BodyPartEdit): (c: Character) => Character {
  return (c: Character) => {
    if (!c.body.some((part) => part.id === partId)) return c
    const body = c.body.map((part) => (part.id === partId ? { ...part, ...edit } : part))
    return keepsChest(body) ? withBody(c, body) : c
  }
}

function editWounds(partId: string, change: (wounds: PartWound[]) => PartWound[]): (c: Character) => Character {
  return (c: Character) => {
    if (!c.body.some((part) => part.id === partId)) return c
    return withBody(c, c.body.map((part) => (part.id === partId ? { ...part, wounds: change(part.wounds) } : part)))
  }
}

export function addPartWound(partId: string): (c: Character) => Character {
  return editWounds(partId, (wounds) => [...wounds, PartWoundSchema.parse({ name: 'wound' })])
}

export function editPartWound(partId: string, index: number, edit: Partial<PartWound>): (c: Character) => Character {
  return editWounds(partId, (wounds) => wounds.map((w, i) => (i === index ? { ...w, ...edit } : w)))
}

export function removePartWound(partId: string, index: number): (c: Character) => Character {
  return editWounds(partId, (wounds) => wounds.filter((_, i) => i !== index))
}

export function editStance(edit: Partial<Stance>): (c: Character) => Character {
  return (c: Character) => ({ ...c, stance: StanceSchema.parse({ ...c.stance, ...edit }) })
}

// What the creature is under anything it wears (gear.tex "Armors": skin,
// fur, hide).
export function editNaturalArmor(edit: Partial<Armor>): (c: Character) => Character {
  return (c: Character) => ({ ...c, armor: ArmorSchema.parse({ ...c.armor, ...edit }) })
}

export function setShape(shape: Shape): (c: Character) => Character {
  return (c: Character) => ({ ...c, shape })
}
