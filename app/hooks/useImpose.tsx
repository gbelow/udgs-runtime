import { useEffect, useState } from "react";
import { useGmPickStore } from "../stores/useGmPickStore";
import { getRosterParties, getCombatRosterDigest, type RosterParty } from "../domain/scene/projections/roster";
import { getImposeBar, getImposed, getImposedDL, IMPOSE_AFFLICTIONS, IMPOSE_DAMAGE_KINDS, IMPOSE_DRAFT, IMPOSE_EFFECTS, IMPOSE_SKILLS, type ImposeDraft } from "../domain/scene/rules/impose";
import { useCombatStore } from "../stores/useCombatStore";
import { useGmBar } from "./useControl";
import { useSceneDispatch } from "./useSceneDispatch";

// The GM's test: who it is asked of, the effect and the test it rides on, and
// the press that lays it on them. Who is picked and what is drafted are the
// screen's own; the delivery they make is the domain's.
export function useImpose() {
  const dispatch = useSceneDispatch();
  const gmBar = useGmBar();
  const picked = useGmPickStore((s) => s.picked);
  const setPicked = useGmPickStore((s) => s.setPicked);
  const toggle = useGmPickStore((s) => s.toggle);
  const setPicking = useGmPickStore((s) => s.setPicking);
  useEffect(() => {
    setPicking(true);
    return () => setPicking(false);
  }, [setPicking]);
  const [draft, setDraft] = useState<ImposeDraft>(IMPOSE_DRAFT);

  useCombatStore(getCombatRosterDigest);
  const parties: RosterParty[] = getRosterParties(useCombatStore.getState());
  const here = new Set(parties.flatMap((p) => p.entries.map((e) => e.id)));
  const ids = picked.filter((id) => here.has(id));
  const bar = useCombatStore((s) => getImposeBar(s, ids)) ?? gmBar;

  const toggleParty = (party: RosterParty) => {
    const members = party.entries.map((e) => e.id);
    setPicked(members.every((id) => picked.includes(id)) ? picked.filter((id) => !members.includes(id)) : [...new Set([...picked, ...members])]);
  };
  const set = (fields: Partial<ImposeDraft>) => setDraft({ ...draft, ...fields });
  const impose = () => dispatch({ kind: "impose", args: [ids, getImposed(draft)] });

  const options = { effects: IMPOSE_EFFECTS, skills: IMPOSE_SKILLS, damageKinds: IMPOSE_DAMAGE_KINDS, afflictions: IMPOSE_AFFLICTIONS } as const;

  return { options, parties, picked: ids, toggle, toggleParty, draft, set, DL: getImposedDL(draft), bar, impose } as const;
}
