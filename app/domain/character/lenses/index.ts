import { Character, Characteristics, Lens, Movement, Senses, Skills } from "../../types";
import { getAGI, getAwareness, getCharisma, getCON, getConviction1, getConviction2, getDevotion, getDEX, getINT, getMelee, getRanged, getSorcery, getSPI, getSTA, getSTR, characteristicTermGetters } from "./characteristics";
import { makeInvertingLens, makeTrainableValueLens } from "./factories";
import { getAlchemy, getAnimancy, getBiomancy, getDivine, getMiracle, getShamanism } from "./magic";
import { getSize, getTGH } from "./misc";
import { getBasicMovement, getCarefulMovement, getCrawlMovement, getFastSwimMovement, getJumpMovement, getRunMovement, getStandMovement, getSwimMovement, makeMovementLens } from "./movement";
import { makeSenseActiveLens, makeSenseBonusLens, makeSenseHasSenseLens, makeSenseRangePenaltyLens } from "./senses";
import {
  getStrike, getAccuracy, getDefend, getReflex, getGrapple, getCunning, getSD,
  getBalance, getClimb, getSwim, getPrestidigitation, getHealth,
  getExplore, getWill,
  getStealth,
  getPersuasion,
  getInsight,
  getDeception,
  getDetection,
  skillTermGetters, Term, sumTerms,
  getForce,
} from "./skills";
import { termsDigest, termsView, TermsView } from "./terms";

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
  // knowledge: makeTrainableValueLens("knowledge", getKnowledge),
  explore: makeTrainableValueLens("explore", getExplore),
  will: makeTrainableValueLens("will", getWill),
  persuasion: makeTrainableValueLens("persuasion", getPersuasion),
  deception: makeTrainableValueLens("deception", getDeception),
  insight: makeTrainableValueLens("insight", getInsight),
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
  stand: makeMovementLens("stand", getStandMovement),
  swim: makeMovementLens("swim", getSwimMovement),
  "fast swim": makeMovementLens("fast swim", getFastSwimMovement),
  crawl: makeMovementLens("crawl", getCrawlMovement),
  jump: makeMovementLens("jump", getJumpMovement),
  run: makeMovementLens("run", getRunMovement)
}

export const senseLenses: Record<keyof Senses, {
  rangePenalty: Lens<Character, number>
  bonus: Lens<Character, number>
  active: Lens<Character, boolean>
  hasSense: Lens<Character, boolean>
}> = {
  vision: {
    rangePenalty: makeSenseRangePenaltyLens("vision"),
    bonus: makeSenseBonusLens("vision"),
    active: makeSenseActiveLens("vision"),
    hasSense: makeSenseHasSenseLens("vision"),
  },
  hearing: {
    rangePenalty: makeSenseRangePenaltyLens("hearing"),
    bonus: makeSenseBonusLens("hearing"),
    active: makeSenseActiveLens("hearing"),
    hasSense: makeSenseHasSenseLens("hearing"),
  },
  smell: {
    rangePenalty: makeSenseRangePenaltyLens("smell"),
    bonus: makeSenseBonusLens("smell"),
    active: makeSenseActiveLens("smell"),
    hasSense: makeSenseHasSenseLens("smell"),
  },
  touch: {
    rangePenalty: makeSenseRangePenaltyLens("touch"),
    bonus: makeSenseBonusLens("touch"),
    active: makeSenseActiveLens("touch"),
    hasSense: makeSenseHasSenseLens("touch"),
  },
  synesthesia: {
    rangePenalty: makeSenseRangePenaltyLens("synesthesia"),
    bonus: makeSenseBonusLens("synesthesia"),
    active: makeSenseActiveLens("synesthesia"),
    hasSense: makeSenseHasSenseLens("synesthesia"),
  },
}

export const miscLenses = {
  size: makeInvertingLens("size", getSize),
  TGH: makeInvertingLens("TGH", getTGH),
}

export const magicGetters = {
  alchemy: (c: Character) => getAlchemy(c),
  animancy: (c: Character) => getAnimancy(c),
  biomancy: (c: Character) => getBiomancy(c),
  shamanism: (c: Character) => getShamanism(c),
  divine: (c: Character) => getDivine(c),
  miracle: (c: Character) => getMiracle(c),
}