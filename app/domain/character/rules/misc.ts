import { Character } from "../../types";
import { getSTRBase } from "./characteristics";
import { getDM } from "./size";


// combat.tex "Afflictions" excludes TGH from the injury penalty, so this reads
// the unpenalized STR base.
export const getTGH = (c: Character) => Math.floor(0.5 * getSTRBase(c) * getDM(c) + c.TGH)
