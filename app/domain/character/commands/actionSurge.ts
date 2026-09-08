import { CampaignCharacter, SurgeKind } from "../../types"
import { SURGES } from "../../tables"
import { bleed } from "./bleed"

// combat.tex "Action surge": a character is entitled to one surge per round, so
// a character that already used one this round cannot surge again, whichever
// kind it was.
export function actionSurge(kind: SurgeKind): (c: CampaignCharacter) => CampaignCharacter {
  return (c: CampaignCharacter) => {
    const { STA, AP } = SURGES[kind]
    if (c.usedSurge !== null || !c.resources || STA > c.resources.STA) return c
    const char = bleed(STA)(c)
    return {
      ...char,
      usedSurge: kind,
      resources: {
        ...char.resources,
        AP: char.resources.AP + AP,
        STA: char.resources.STA - STA,
      },
    }
  }
}
