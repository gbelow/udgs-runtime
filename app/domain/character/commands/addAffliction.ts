import { AFFLICTIONS } from "../../tables"
import { AfflictionKey, CampaignCharacter } from "../../types"


// Toggles an affliction on the *stored* list, not the derived one. Afflictions
// that hunger, thirst, exhaustion or burden force on the character are
// recomputed by `getAfflictions` on every read, so writing them back here would
// freeze them in place long after the cause is gone.
//
// A character sits on one rung of a ladder, so switching a rung on drops the
// ladder's other rungs from the stored list — otherwise a lower rung lingers
// underneath and resurfaces when the higher one is switched off.
export function addAffliction(item: AfflictionKey): (c: CampaignCharacter) => CampaignCharacter {
  return ((c:CampaignCharacter) => {
    // A non-controlable affliction is owned by the resource that derives it
    // (hunger, thirst, exhaustion), so toggling it by hand is a no-op.
    if (!AFFLICTIONS[item].controlable) return c
    const stored = c.afflictions ?? []
    if (stored.includes(item)) return { ...c, afflictions: stored.filter((el) => el !== item) }
    const { group } = AFFLICTIONS[item]
    const rest = group ? stored.filter((el) => AFFLICTIONS[el].group !== group) : stored
    return { ...c, afflictions: [...rest, item] }
  })
}

// combat.tex "Afflictions": one of a group at a time, the one put on last
// standing in for whatever of the group was carried. A key already carried
// is not carried twice.
export function inflict(keys: readonly AfflictionKey[]): (c: CampaignCharacter) => CampaignCharacter {
  return (c: CampaignCharacter) =>
    keys.reduce((acc, key) => {
      const { group } = AFFLICTIONS[key]
      const rest = group ? acc.afflictions.filter((k) => AFFLICTIONS[k].group !== group) : acc.afflictions
      if (!rest.includes(key)) return { ...acc, afflictions: [...rest, key] }
      return rest === acc.afflictions ? acc : { ...acc, afflictions: rest }
    }, c)
}

// Takes the keys off the stored list; one not carried is left as it is.
export function cure(keys: readonly AfflictionKey[]): (c: CampaignCharacter) => CampaignCharacter {
  return (c: CampaignCharacter) =>
    keys.some((key) => c.afflictions.includes(key)) ? { ...c, afflictions: c.afflictions.filter((a) => !keys.includes(a)) } : c
}
