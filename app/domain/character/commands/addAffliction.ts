import { AFFLICTIONS } from "../../tables"
import { AfflictionKey, CampaignCharacter } from "../../types"


// Toggles an affliction on the *stored* list, not the derived one. Afflictions
// that hunger, thirst, exhaustion or burden force on the character are
// recomputed by `getAfflictions` on every read, so writing them back here would
// freeze them in place long after the cause is gone.
export function addAffliction(item: AfflictionKey): (c: CampaignCharacter) => CampaignCharacter {
  return ((c:CampaignCharacter) => {
    // A non-controlable affliction is owned by the resource that derives it
    // (hunger, thirst, exhaustion), so toggling it by hand is a no-op.
    if (!AFFLICTIONS[item].controlable) return c
    return {
      ...c,
      afflictions: symmetricDifference(c.afflictions ?? [], item)
    }
  })
}


    
function symmetricDifference(arr: AfflictionKey[], item: AfflictionKey) {
  return arr.includes(item) ? arr.filter(el => el != item) : [...arr, item]
}
