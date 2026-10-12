import type { CampaignCharacter } from '../../types'
import { getPartWound } from '../rules/wounds'

// combat.tex "Wounds": the wound joins what the character carries, needing
// the part's IL wound for it unless what caused it asks for more or less.
// The same wound again on a part that already carries it adds nothing. An
// amputation ("no heal") is not carried: the part is lost. A wound that
// kills is the death the damage brings, not something carried; one the part
// does not take does nothing.
export function woundPart(name: string, partId: string, IL: number | null = null): (c: CampaignCharacter) => CampaignCharacter {
  return (c: CampaignCharacter) => {
    const wound = getPartWound(c, { name, part: partId })
    if (!wound || wound.effect === 'kill') return c
    if (wound.effect === 'sever') return severPart(partId)(c)
    if (c.injuries.wounds.some((w) => w.name === name && w.part === partId)) return c
    return { ...c, injuries: { ...c.injuries, wounds: [...c.injuries.wounds, { name, part: partId, IL: IL ?? wound.heal }] } }
  }
}

// A part cut off: its slot stays, lost; what it held is let go of unless
// another hand still has it; the wounds it carried go with it. Every
// creature has a chest, so the chest is never cut off.
export function severPart(partId: string): (c: CampaignCharacter) => CampaignCharacter {
  return (c: CampaignCharacter) => {
    const part = c.body.find((p) => p.id === partId)
    if (!part || part.lost || part.location === 'chest') return c
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

// spells.tex "Reattach Limb": a lost part put back, "adding a wound that
// requires 20 IL to be healed and function perfectly again" — carried on
// the part, so it is useless until then.
export function reattachPart(partId: string, IL: number): (c: CampaignCharacter) => CampaignCharacter {
  return (c: CampaignCharacter) => {
    if (!c.body.some((p) => p.id === partId && p.lost)) return c
    const body = c.body.map((p) => (p.id === partId ? { ...p, lost: false } : p))
    const wounds = IL > 0 ? [...c.injuries.wounds, { name: 'reattached', part: partId, IL }] : c.injuries.wounds
    return { ...c, body, injuries: { ...c.injuries, wounds } }
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
