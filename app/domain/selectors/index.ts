import { Character, Characteristics, Movement, Skills } from "../types";
import { getAGI, getCON, getConviction1, getConviction2, getDetection, getDEX, getINS, getINT, getMelee, getRanged, getRES, getSize, getSpellcast, getSPI, getSTA, getSTR, getTGH } from "./characteristics";
import { getBasicMovement, getCarefulMovement, getCrawlMovement, getFastSwimMovement, getJumpMovement, getRunMovement, getStandMovement, getSwimMovement } from "./movement";
import {
  getStrike, getAccuracy, getDefend, getReflex, getGrapple, getCunning, getSD,
  getBalance, getClimb, getSwim, getStrength, getPrestidigitation, getHealth, getKnowledge,
  getExplore, getWill, getCharm, getStress, getDevotion,
  getCombustion, getEletromag, getRadiation, getEntropy, getBiomancy, getTelepathy, getAnimancy,
  getStealth,
  getActing
} from "./skills";

export const skillSelectors: Record<keyof Skills, (c: Character) => number> = {
  strike: getStrike,
  accuracy: getAccuracy,
  defend: getDefend,
  reflex: getReflex,
  grapple: getGrapple,
  cunning: getCunning,
  SD: getSD,
  balance: getBalance,
  climb: getClimb,
  swim: getSwim,
  strength: getStrength,
  stealth: getStealth,
  prestidigitation: getPrestidigitation,
  health: getHealth,
  knowledge: getKnowledge,
  explore: getExplore,
  will: getWill,
  charm: getCharm,
  stress: getStress,
  acting: getActing,
  devotion: getDevotion,
  combustion: getCombustion,
  eletromag: getEletromag,
  radiation: getRadiation,
  entropy: getEntropy,
  biomancy: getBiomancy,
  telepathy: getTelepathy,
  animancy: getAnimancy,
};

export const characteristicSelectors: Record<keyof Characteristics, (c: Character) => number> = {
  size: getSize,
  STR: getSTR,
  AGI: getAGI,
  STA: getSTA,
  DEX: getDEX,
  CON: getCON,
  INT: getINT,
  SPI: getSPI,
  melee: getMelee,
  ranged: getRanged,
  detection: getDetection,
  spellcast: getSpellcast,
  devotion: getDevotion,
  conviction1: getConviction1,
  conviction2: getConviction2,
  TGH: getTGH,
  RES: getRES,
  INS: getINS,
}

export const movementSelectors: Record<keyof Movement, (c: Character) => number> = {
  basic: getBasicMovement,
  careful: getCarefulMovement,
  stand: getStandMovement,
  swim: getSwimMovement,
  "fast swim": getFastSwimMovement,
  crawl: getCrawlMovement,
  jump: getJumpMovement,
  run: getRunMovement
}