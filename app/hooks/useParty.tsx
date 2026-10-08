import type { CampaignUpdater, ETPlan } from "../domain/campaign/types";
import { getPartyRoster, getPartyRosterDigest, type PartyEntry } from "../domain/campaign/projections/roster";
import { getClockView, type ClockView } from "../domain/campaign/projections/clock";
import { getExplorationPanel, type ExplorationPanel } from "../domain/campaign/projections/exploration";
import { drink as drinkFor, eat as eatFor, passET as passClock, setExposure as setCampExposure, setPlan as setPlanFor } from "../domain/campaign/commands/exploration";
import { removeFromRoster } from "../domain/campaign/commands/roster";
import { returnFromFight, sendToFight } from "../domain/campaign/commands/fight";
import { getActiveCharacter } from "../domain/combat/rules/fighters";
import { getPassBar } from "../domain/campaign/rules/exploration";
import { useCampaignStore } from "../stores/useCampaignStore";
import { useCombatStore } from "../stores/useCombatStore";
import { realDice } from "../components/utils";

// The party's roster, gated on a digest since the rows are freshly allocated.
export function usePartyRoster(): { roster: PartyEntry[]; pick: (id: string) => void } {
  useCampaignStore(getPartyRosterDigest);
  const roster = getPartyRoster(useCampaignStore.getState());
  const pick = useCampaignStore((s) => s.setActiveCharacter);
  return { roster, pick };
}

export function useClock(): ClockView {
  return getClockView(useCampaignStore((s) => s.clock));
}

// Why the ET cannot pass now; the fight's roster is the gate.
export function usePassBar(): string | null {
  useCombatStore((s) => s.characters);
  return getPassBar({ campaign: useCampaignStore.getState(), fight: useCombatStore.getState() });
}

export function useExposure(): number {
  return useCampaignStore((s) => s.exposure);
}

const NO_EXPLORATION: ExplorationPanel = { bar: 'no active character', plan: null, options: [], willDL: null, lastRoll: null, potion: 0 }

// survival.tex "Exhaustion", "Rest", "Wear" — the plans for the coming ET
// open to the party's active character. The panel reads that character and
// the campaign's ET registries and exposure, so their references are the gate.
export function useExploration(): ExplorationPanel {
  const c = useCampaignStore(getActiveCharacter);
  useCampaignStore((s) => s.plans);
  useCampaignStore((s) => s.rests);
  useCampaignStore((s) => s.exhaustionRolls);
  useCampaignStore((s) => s.exposure);
  const s = useCampaignStore.getState();
  return c ? getExplorationPanel(s, c.id) : NO_EXPLORATION;
}

export function usePartyCommands() {
  const updateCampaignState = useCampaignStore((s) => s.updateCampaignState);
  const updateTable = useCampaignStore((s) => s.updateTable);

  const withActive = (run: (id: string) => void) => {
    const id = useCampaignStore.getState().activeCharacterId;
    if (id) run(id);
  };
  const asActive = (command: (id: string) => CampaignUpdater) => withActive((id) => updateCampaignState(command(id)));

  const newId = () => crypto.randomUUID();

  return {
    setPlan: (plan: ETPlan | null) => asActive((id) => setPlanFor(id, plan)),
    setExposure: (exposure: number) => updateCampaignState(setCampExposure(exposure)),
    eat: (nutrition: number) => asActive((id) => eatFor(id, nutrition)),
    drink: () => asActive(drinkFor),
    leaveParty: () => asActive(removeFromRoster),
    passET: () => updateTable(passClock(realDice)),
    sendActiveToFight: () => withActive((id) => updateTable(sendToFight([id], newId))),
    sendAllToFight: () => updateTable(sendToFight(Object.keys(useCampaignStore.getState().characters), newId)),
    returnFromFight: () => updateTable(returnFromFight(newId)),
  };
}
