import { Character, Characteristics, Knowledges, Lens, Movement, Senses, Skills } from "../../types";
import { getAGI, getAwareness, getCharisma, getCON, getConviction1, getConviction2, getDevotion, getDEX, getINT, getMelee, getRanged, getSorcery, getSPI, getSTA, getSTR, characteristicTermGetters } from "../rules/characteristics";
import { makeInvertingLens, makeTrainableValueLens } from "./factories";
import { getAlchemy, getAnimancy, getBiomancy, getDivine, getMiracle, getShamanism } from "../rules/magic";
import { getSize } from "../rules/size";
import { getTGH } from "../rules/misc";
import { getBasicMovement, getCarefulMovement, getClimbMovement, getCrawlMovement, getFastSwimMovement, getJumpMovement, getRunMovement, getStandMovement, getSwimMovement } from "../rules/movement";
import { makeMovementCostLens, makeMovementLens } from "./movement";
import { makeSenseActiveLens, makeSenseBonusLens, makeSenseHasSenseLens, makeSensePenaltyLens, makeSenseRangeLens, makeSenseRangePenaltyLens, makeSenseReactiveLens } from "./senses";
import { getStrike, getAccuracy, getDefend, getReflex, getGrapple, getCunning, getSD, getBalance, getClimb, getSwim, getPrestidigitation, getHealth, getExplore, getWill, getStealth, getPersuasion, getInsight, getDeception, getDetection, getForce } from "../rules/skills";
import { skillTermGetters } from "../rules/skills";
import { getKnowledge } from "../rules/knowledge";
import { Term, sumTerms, termsDigest, termsView, TermsView } from "../rules/terms";

export { skillTermGetters, characteristicTermGetters, sumTerms, termsDigest, termsView }
export type { Term, TermsView }

export const skillLenses: Record<keyof Skills, Lens<Character, number>> = {
  strike: makeTrainableValueLens("strike", getStrike),
  accuracy: makeTrainableValueLens("accuracy", getAccuracy),
  defend: makeTrainableValueLens("defend", getDefend),
  reflex: makeTrainableValueLens("reflex", getReflex),
  grapple: makeTrainableValueLens("grapple", getGrapple),
  cunning: makeTrainableValueLens("cunning", getCunning),
  SD: makeTrainableValueLens("SD", getSD),
  balance: makeTrainableValueLens("balance", getBalance),
  climb: makeTrainableValueLens("climb", getClimb),
  swim: makeTrainableValueLens("swim", getSwim),
  detection: makeTrainableValueLens("detection", getDetection),
  stealth: makeTrainableValueLens("stealth", getStealth),
  prestidigitation: makeTrainableValueLens("prestidigitation", getPrestidigitation),
  health: makeTrainableValueLens("health", getHealth),
  force: makeTrainableValueLens("force", getForce),
  explore: makeTrainableValueLens("explore", getExplore),
  will: makeTrainableValueLens("will", getWill),
  persuasion: makeTrainableValueLens("persuasion", getPersuasion),
  deception: makeTrainableValueLens("deception", getDeception),
  insight: makeTrainableValueLens("insight", getInsight),
};

export const knowledgeLenses: Record<keyof Knowledges, Lens<Character, number>> = {
  alchemy: makeTrainableValueLens("alchemy", getKnowledge("alchemy")),
  animancy: makeTrainableValueLens("animancy", getKnowledge("animancy")),
  biomancy: makeTrainableValueLens("biomancy", getKnowledge("biomancy")),
  shamanism: makeTrainableValueLens("shamanism", getKnowledge("shamanism")),
  mechanics: makeTrainableValueLens("mechanics", getKnowledge("mechanics")),
  smithing: makeTrainableValueLens("smithing", getKnowledge("smithing")),
  chemistry: makeTrainableValueLens("chemistry", getKnowledge("chemistry")),
  medicine: makeTrainableValueLens("medicine", getKnowledge("medicine")),
  linguistics: makeTrainableValueLens("linguistics", getKnowledge("linguistics")),
  navigation: makeTrainableValueLens("navigation", getKnowledge("navigation")),
  survival: makeTrainableValueLens("survival", getKnowledge("survival")),
  "animal handling": makeTrainableValueLens("animal handling", getKnowledge("animal handling")),
};

export const characteristicLenses: Record<keyof Characteristics, Lens<Character, number>> = {
  STR: makeTrainableValueLens("STR", getSTR),
  AGI: makeTrainableValueLens("AGI", getAGI),
  STA: makeTrainableValueLens("STA", getSTA),
  DEX: makeTrainableValueLens("DEX", getDEX),
  CON: makeTrainableValueLens("CON", getCON),
  INT: makeTrainableValueLens("INT", getINT),
  SPI: makeTrainableValueLens("SPI", getSPI),
  melee: makeTrainableValueLens("melee", getMelee),
  ranged: makeTrainableValueLens("ranged", getRanged),
  awareness: makeTrainableValueLens("awareness", getAwareness),
  sorcery: makeTrainableValueLens("sorcery", getSorcery),
  devotion: makeTrainableValueLens("devotion", getDevotion),
  conviction1: makeTrainableValueLens("conviction1", getConviction1),
  conviction2: makeTrainableValueLens("conviction2", getConviction2),
  charisma: makeTrainableValueLens("charisma", getCharisma),
}

export const movementLenses: Record<keyof Movement, Lens<Character, number>> = {
  basic: makeMovementLens("basic", getBasicMovement),
  careful: makeMovementLens("careful", getCarefulMovement),
  stand: makeMovementLens("stand", getStandMovement, "AP"),
  climb: makeMovementLens("climb", getClimbMovement),
  swim: makeMovementLens("swim", getSwimMovement),
  "fast swim": makeMovementLens("fast swim", getFastSwimMovement),
  crawl: makeMovementLens("crawl", getCrawlMovement),
  jump: makeMovementLens("jump", getJumpMovement),
  run: makeMovementLens("run", getRunMovement)
}

// combat.tex "Movement Costs and Speeds": the AP and STA of one block of each
// movement. Standing up has the AGI-reduced AP of its own lens above.
export const movementCostLenses: Record<keyof Movement, Record<'AP' | 'STA', Lens<Character, number>>> = {
  basic: { AP: makeMovementCostLens("basic", "AP"), STA: makeMovementCostLens("basic", "STA") },
  careful: { AP: makeMovementCostLens("careful", "AP"), STA: makeMovementCostLens("careful", "STA") },
  stand: { AP: movementLenses.stand, STA: makeMovementCostLens("stand", "STA") },
  climb: { AP: makeMovementCostLens("climb", "AP"), STA: makeMovementCostLens("climb", "STA") },
  swim: { AP: makeMovementCostLens("swim", "AP"), STA: makeMovementCostLens("swim", "STA") },
  "fast swim": { AP: makeMovementCostLens("fast swim", "AP"), STA: makeMovementCostLens("fast swim", "STA") },
  crawl: { AP: makeMovementCostLens("crawl", "AP"), STA: makeMovementCostLens("crawl", "STA") },
  jump: { AP: makeMovementCostLens("jump", "AP"), STA: makeMovementCostLens("jump", "STA") },
  run: { AP: makeMovementCostLens("run", "AP"), STA: makeMovementCostLens("run", "STA") },
}

export const senseLenses: Record<keyof Senses, {
  rangePenalty: Lens<Character, number>
  bonus: Lens<Character, number>
  penalty: Lens<Character, number>
  range: Lens<Character, number | null>
  active: Lens<Character, boolean>
  reactive: Lens<Character, boolean>
  hasSense: Lens<Character, boolean>
}> = {
  vision: {
    rangePenalty: makeSenseRangePenaltyLens("vision"),
    bonus: makeSenseBonusLens("vision"),
    penalty: makeSensePenaltyLens("vision"),
    range: makeSenseRangeLens("vision"),
    active: makeSenseActiveLens("vision"),
    reactive: makeSenseReactiveLens("vision"),
    hasSense: makeSenseHasSenseLens("vision"),
  },
  hearing: {
    rangePenalty: makeSenseRangePenaltyLens("hearing"),
    bonus: makeSenseBonusLens("hearing"),
    penalty: makeSensePenaltyLens("hearing"),
    range: makeSenseRangeLens("hearing"),
    active: makeSenseActiveLens("hearing"),
    reactive: makeSenseReactiveLens("hearing"),
    hasSense: makeSenseHasSenseLens("hearing"),
  },
  smell: {
    rangePenalty: makeSenseRangePenaltyLens("smell"),
    bonus: makeSenseBonusLens("smell"),
    penalty: makeSensePenaltyLens("smell"),
    range: makeSenseRangeLens("smell"),
    active: makeSenseActiveLens("smell"),
    reactive: makeSenseReactiveLens("smell"),
    hasSense: makeSenseHasSenseLens("smell"),
  },
  touch: {
    rangePenalty: makeSenseRangePenaltyLens("touch"),
    bonus: makeSenseBonusLens("touch"),
    penalty: makeSensePenaltyLens("touch"),
    range: makeSenseRangeLens("touch"),
    active: makeSenseActiveLens("touch"),
    reactive: makeSenseReactiveLens("touch"),
    hasSense: makeSenseHasSenseLens("touch"),
  },
  synesthesia: {
    rangePenalty: makeSenseRangePenaltyLens("synesthesia"),
    bonus: makeSenseBonusLens("synesthesia"),
    penalty: makeSensePenaltyLens("synesthesia"),
    range: makeSenseRangeLens("synesthesia"),
    active: makeSenseActiveLens("synesthesia"),
    reactive: makeSenseReactiveLens("synesthesia"),
    hasSense: makeSenseHasSenseLens("synesthesia"),
  },
}

export const miscLenses = {
  size: makeInvertingLens("size", getSize),
  height: makeInvertingLens("height", (c) => c.height),
  TGH: makeInvertingLens("TGH", getTGH),
  attributeBalanceBase: makeInvertingLens("attributeBalanceBase", (c) => c.attributeBalanceBase),
}

export const magicGetters = {
  alchemy: (c: Character) => getAlchemy(c),
  animancy: (c: Character) => getAnimancy(c),
  biomancy: (c: Character) => getBiomancy(c),
  shamanism: (c: Character) => getShamanism(c),
  divine: (c: Character) => getDivine(c),
  miracle: (c: Character) => getMiracle(c),
}