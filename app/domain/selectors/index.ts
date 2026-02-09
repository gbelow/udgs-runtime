import { Character, Characteristics, Lens, Movement, Skills } from "../types";
import { getAGI, getCON, getConviction1, getConviction2, getDetection, getDEX, getINS, getINT, getMelee, getRanged, getRES, getSize, getSpellcast, getSPI, getSTA, getSTR, getTGH, makeCharacteristicLens } from "./characteristics";
import { getBasicMovement, getCarefulMovement, getCrawlMovement, getFastSwimMovement, getJumpMovement, getRunMovement, getStandMovement, getSwimMovement, makeMovementLens } from "./movement";
import {
  getStrike, getAccuracy, getDefend, getReflex, getGrapple, getCunning, getSD,
  getBalance, getClimb, getSwim, getStrength, getPrestidigitation, getHealth, getKnowledge,
  getExplore, getWill, getCharm, getStress, getDevotion,
  getCombustion, getEletromag, getRadiation, getEntropy, getBiomancy, getTelepathy, getAnimancy,
  getStealth,
  getActing,
  makeSkillLens,
} from "./skills";

export const skillLenses: Record<keyof Skills, Lens<Character, number>> = {
  strike: makeSkillLens("strike", getStrike),
  accuracy: makeSkillLens("accuracy", getAccuracy),
  defend: makeSkillLens("defend", getDefend),
  reflex: makeSkillLens("reflex", getReflex),
  grapple: makeSkillLens("grapple", getGrapple),
  cunning: makeSkillLens("cunning", getCunning),
  SD: makeSkillLens("SD", getSD),
  balance: makeSkillLens("balance", getBalance),
  climb: makeSkillLens("climb", getClimb),
  swim: makeSkillLens("swim", getSwim),
  strength: makeSkillLens("strength", getStrength),
  stealth: makeSkillLens("stealth", getStealth),
  prestidigitation: makeSkillLens("prestidigitation", getPrestidigitation),
  health: makeSkillLens("health", getHealth),
  knowledge: makeSkillLens("knowledge", getKnowledge),
  explore: makeSkillLens("explore", getExplore),
  will: makeSkillLens("will", getWill),
  charm: makeSkillLens("charm", getCharm),
  stress: makeSkillLens("stress", getStress),
  acting: makeSkillLens("acting", getActing),
  devotion: makeSkillLens("devotion", getDevotion),
  combustion: makeSkillLens("combustion", getCombustion),
  eletromag: makeSkillLens("eletromag", getEletromag),
  radiation: makeSkillLens("radiation", getRadiation),
  entropy: makeSkillLens("entropy", getEntropy),
  biomancy: makeSkillLens("biomancy", getBiomancy),
  telepathy: makeSkillLens("telepathy", getTelepathy),
  animancy: makeSkillLens("animancy", getAnimancy),
};

export const characteristicLenses: Record<keyof Characteristics, Lens<Character, number>> = {
  size: makeCharacteristicLens("size", getSize),
  STR: makeCharacteristicLens("STR", getSTR),
  AGI: makeCharacteristicLens("AGI", getAGI),
  STA: makeCharacteristicLens("STA", getSTA),
  DEX: makeCharacteristicLens("DEX", getDEX),
  CON: makeCharacteristicLens("CON", getCON),
  INT: makeCharacteristicLens("INT", getINT),
  SPI: makeCharacteristicLens("SPI", getSPI),
  melee: makeCharacteristicLens("melee", getMelee),
  ranged: makeCharacteristicLens("ranged", getRanged),
  detection: makeCharacteristicLens("detection", getDetection),
  spellcast: makeCharacteristicLens("spellcast", getSpellcast),
  devotion: makeCharacteristicLens("devotion", getDevotion),
  conviction1: makeCharacteristicLens("conviction1", getConviction1),
  conviction2: makeCharacteristicLens("conviction2", getConviction2),
  TGH: makeCharacteristicLens("TGH", getTGH),
  RES: makeCharacteristicLens("RES", getRES),
  INS: makeCharacteristicLens("INS", getINS),
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