import { getAfflictions } from "../selectors/afflictions"
import { AfflictionKey, CampaignCharacter } from "../types"


export function addAffliction(item: AfflictionKey): (c: CampaignCharacter) => CampaignCharacter {
  return ((c:CampaignCharacter) => ({
    ...c,
    afflictions: symmetricDifference(getAfflictions(c) ?? [], item as AfflictionKey) as AfflictionKey[]
  }))
}


    
function symmetricDifference(arr: AfflictionKey[], item: AfflictionKey) {
  return arr.includes(item) ? arr.filter(el => el != item) : [...arr, item]
}