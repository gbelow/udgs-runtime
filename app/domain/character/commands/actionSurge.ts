import { CampaignCharacter, SurgeKind } from "../../types"
import { SURGES } from "../../tables"
import { bleed } from "./bleed"
import { canSurge, getSurgeAP } from "../rules/surge"

// combat.tex "Action surge": a character is entitled to one surge per round, so
// a character that already used one this round cannot surge again, whichever
// kind it was. `canSurge` holds the whole gate — round, price and affliction —
// so the command refuses exactly what the button shows as closed. An
// earmarked surge's AP is kept apart from the rest (`surgeAP`).
export function actionSurge(kind: SurgeKind): (c: CampaignCharacter) => CampaignCharacter {
  return (c: CampaignCharacter) => {
    const { STA, earmarked } = SURGES[kind]
    if (!c.resources || !canSurge(kind)(c)) return c
    const char = bleed(STA)(c)
    const AP = getSurgeAP(kind)(c)
    return {
      ...char,
      usedSurge: kind,
      resources: {
        ...char.resources,
        AP: earmarked ? char.resources.AP : char.resources.AP + AP,
        surgeAP: earmarked ? AP : char.resources.surgeAP,
        STA: char.resources.STA - STA,
      },
    }
  }
}

// Gives up what is left of an earmarked surge, so the character is free to
// do anything again. The STA it cost stays spent, and the round's surge stays
// used.
export function endSurge(c: CampaignCharacter): CampaignCharacter {
  if (c.resources.surgeAP === 0) return c
  return { ...c, resources: { ...c.resources, surgeAP: 0 } }
}
