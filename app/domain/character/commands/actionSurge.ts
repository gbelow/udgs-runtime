import { CampaignCharacter, SurgeKind } from "../../types"
import { canSurge, getSurged } from "../rules/surge"

// combat.tex "Action surge": a character is entitled to one surge per round, so
// a character that already used one this round cannot surge again, whichever
// kind it was. `canSurge` holds the whole gate — round, price and affliction —
// so the command refuses exactly what the button shows as closed. An
// earmarked surge's AP is marked off from the rest (`surgeFloor`).
export function actionSurge(kind: SurgeKind, compelled = false): (c: CampaignCharacter) => CampaignCharacter {
  return (c: CampaignCharacter) => (c.resources && canSurge(kind, compelled)(c) ? getSurged(kind)(c) : c)
}

// Gives up what is left of an earmarked surge, so the character is free to
// do anything again. The STA it cost stays spent, and the round's surge stays
// used.
export function endSurge(c: CampaignCharacter): CampaignCharacter {
  const { surgeFloor } = c
  if (surgeFloor === null) return c
  return { ...c, surgeFloor: null, resources: { ...c.resources, AP: Math.min(c.resources.AP, surgeFloor) } }
}
