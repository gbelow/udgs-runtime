import { getChaseDigest, getChasePanel, type ChasePanel } from "../domain/scene/projections/chase";
import { crossObstacle, declareChase, endChase as endTheChase, followParty, giveUp, joinFight, mergeBack, putBack, resolveChase, setChaseCover, setPartyFighting, startChase as beginChase, turnAround as turnAroundOf } from "../domain/scene/commands/chase";
import { getChaseStartBar } from "../domain/scene/rules/chase";
import type { ChaseDeclaration } from "../domain/scene/types";
import type { ChaseCover, ChaseTier, CrossingSkill } from "../domain/lists";
import { useCombatStore } from "../stores/useCombatStore";
import { realDice } from "../components/utils";

// combat.tex "Chases" — the chase panel, gated on a digest since it is
// freshly allocated, and why the parties picked cannot set off at the tier
// picked.
export function useChase(quarry: string[], tier: ChaseTier): ChasePanel & { startBar: string | null } {
  useCombatStore(getChaseDigest);
  const startBar = useCombatStore((s) => getChaseStartBar(s, quarry, tier));
  return { ...getChasePanel(useCombatStore.getState()), startBar };
}

export function useChaseCommands() {
  const updateCombatState = useCombatStore((s) => s.updateCombatState);
  return {
    startChase: (quarry: string[], tier: ChaseTier) => updateCombatState(beginChase(quarry, tier)),
    declare: (partyId: string, declaration: ChaseDeclaration) => updateCombatState(declareChase(partyId, declaration)),
    resolve: () => updateCombatState(resolveChase(realDice)),
    follow: (partyId: string, target: string) => updateCombatState(followParty(partyId, target)),
    putBack: (partyId: string, target: string, tier: ChaseTier) => updateCombatState(putBack(partyId, target, tier)),
    giveUp: (partyId: string) => updateCombatState(giveUp(partyId)),
    mergeBack: (partyId: string) => updateCombatState(mergeBack(partyId)),
    setFighting: (partyId: string, fighting: boolean) => updateCombatState(setPartyFighting(partyId, fighting)),
    join: (partyId: string, to: string) => updateCombatState(joinFight(partyId, to)),
    cross: (partyId: string, skill: CrossingSkill, DL: number) => updateCombatState(crossObstacle(partyId, skill, DL, realDice)),
    endChase: () => updateCombatState(endTheChase),
    turnAround: (id: string) => updateCombatState(turnAroundOf(id)),
    setCover: (id: string, cover: ChaseCover | null) => updateCombatState(setChaseCover(id, cover)),
  };
}
