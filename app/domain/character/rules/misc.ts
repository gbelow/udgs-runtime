import { Character } from "../../types";
import { getSTRBase } from "./characteristics";
import { getDM } from "./helpers";


// combat.tex "Afflictions" excludes TGH from the injury penalty, so this reads
// the unpenalized STR base.
export const getTGH = (c: Character) => Math.floor(0.5 * getSTRBase(c) * getDM(c) + c.TGH)

export const getSize = (c: Character) => c.size > 6 ? 7 : c.size < 2 ? 1 : c.size