import { CampaignCharacter, SurgeKind } from "../../types"
import { SURGES } from "../../tables"
import { bleed } from "./bleed"
import { canSurge, getSurgeAP } from "../rules/surge"

// combat.tex "Action surge": a character is entitled to one surge per round, so
// a character that already used one this round cannot surge again, whichever
// kind it was. `canSurge` holds the whole gate — round, price and affliction —
// so the command refuses exactly what the button shows as closed.
export function actionSurge(kind: SurgeKind): (c: CampaignCharacter) => CampaignCharacter {
  return (c: CampaignCharacter) => {
    const { STA } = SURGES[kind]
    if (!c.resources || !canSurge(kind)(c)) return c
    const char = bleed(STA)(c)
    return {
      ...char,
      usedSurge: kind,
      resources: {
        ...char.resources,
        AP: char.resources.AP + getSurgeAP(kind)(c),
        STA: char.resources.STA - STA,
      },
    }
  }
}
