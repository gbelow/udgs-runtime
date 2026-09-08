import { Character } from "../../types";
import { getSorcery } from "./characteristics";
import { makeKnowledgeLens } from "./knowledge";

// combat.tex "Afflictions" lists both "all Knowledges" and "all spellcasting"
// as taking the mental penalty. A spell value is sorcery + a knowledge, so the
// penalty already arrives through `makeKnowledgeLens` and is not applied a
// second time here.


export function getAlchemy(c: Character): number {
  return(
    getSorcery(c) +
    (makeKnowledgeLens('alchemy').get(c) ?? 0)
  )
}

export function getAnimancy(c: Character): number {
  return(
    getSorcery(c) +
    (makeKnowledgeLens('animancy').get(c) ?? 0)
  )
}

export function getBiomancy(c: Character): number {
  return(
    getSorcery(c) +
    (makeKnowledgeLens('biomancy').get(c) ?? 0)
  )
}

export function getDivine(c: Character): number {
  return(
    getSorcery(c) +
    (makeKnowledgeLens('devotion').get(c) ?? 0)
  )
}

export function getMiracle(c: Character): number {
  return(
    2 * (makeKnowledgeLens('miracles').get(c) ?? 0)
  )
}