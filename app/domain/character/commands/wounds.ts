import type { CampaignCharacter } from '../../types'
import { WOUNDS, WoundKey } from '../../tables'

// combat.tex "Wounds": the wound joins what the character carries, needing
// the table's IL wound unless what caused it asks for more or less. The
// same wound again on a part that already carries it adds nothing. An
// amputation ("no heal") is not carried: the part is lost.
export function woundPart(key: WoundKey, partId: string, IL: number | null = null): (c: CampaignCharacter) => CampaignCharacter {
  return (c: CampaignCharacter) => {
    const { heal, amputation } = WOUNDS[key]
    if (amputation || heal === null) return severPart(partId)(c)
    if (c.injuries.wounds.some((w) => w.key === key && w.part === partId)) return c
    return { ...c, injuries: { ...c.injuries, wounds: [...c.injuries.wounds, { key, part: partId, IL: IL ?? heal }] } }
  }
}

// A part cut off: its slot stays, lost; what it held is let go of unless
// another hand still has it; the wounds it carried go with it.
export function severPart(partId: string): (c: CampaignCharacter) => CampaignCharacter {
  return (c: CampaignCharacter) => {
    const part = c.body.find((p) => p.id === partId)
    if (!part || part.lost) return c
    const body = c.body.map((p) => (p.id === partId ? { ...p, lost: true, itemId: '' } : p))
    const stillHeld = !part.itemId || body.some((p) => p.itemId === part.itemId)
    return {
      ...c,
      body,
      held: stillHeld ? c.held : c.held.filter((item) => item.id !== part.itemId),
      injuries: { ...c.injuries, wounds: c.injuries.wounds.filter((w) => w.part !== partId) },
    }
  }
}

// survival.tex "Healing Wounds": medicine or magic heal a wound by so much
// IL wound, without the hunger and thirst healing IL costs; healed to none,
// it is gone. A negative amount opens it back up.
export function healWound(index: number, amount: number): (c: CampaignCharacter) => CampaignCharacter {
  return (c: CampaignCharacter) => {
    const wound = c.injuries.wounds[index]
    if (!wound || amount === 0) return c
    const IL = Math.max(0, wound.IL - amount)
    const wounds = IL === 0
      ? c.injuries.wounds.filter((_, i) => i !== index)
      : c.injuries.wounds.map((w, i) => (i === index ? { ...w, IL } : w))
    return { ...c, injuries: { ...c.injuries, wounds } }
  }
}
