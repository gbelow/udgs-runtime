import type { ExplorationAction } from "../domain/lists";
import type { CampaignUpdater } from "../domain/campaign/types";
import { getPartyRoster, getPartyRosterDigest, type PartyEntry } from "../domain/campaign/projections/roster";
import { getClockView, type ClockView } from "../domain/campaign/projections/clock";
import { getExplorationPanel, type ExplorationPanel } from "../domain/campaign/projections/exploration";
import { drink as drinkFor, eat as eatFor, explore as exploreFor, passET as passClock, shortRest as shortRestFor, sleep as sleepFor } from "../domain/campaign/commands/exploration";
import { removeFromRoster } from "../domain/campaign/commands/roster";
import { returnFromFight, sendToFight } from "../domain/campaign/commands/fight";
import { getActiveCharacter } from "../domain/combat/rules/fighters";
import { useCampaignStore } from "../stores/useCampaignStore";

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

const NO_EXPLORATION: ExplorationPanel = { bar: 'no active character', restBar: 'no active character', actions: [], sleep: { heal: 0, exhaustion: 0 }, potion: 0 }

// survival.tex "Rest, Exhaustion and Healing" — the ET buttons for the party's
// active character on ground of this exposure. The panel reads that character
// alone, so its reference is the gate.
export function useExploration(exposure: number): ExplorationPanel {
  const c = useCampaignStore(getActiveCharacter);
  const s = useCampaignStore.getState();
  return c ? getExplorationPanel(s, c.id, exposure) : NO_EXPLORATION;
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
    explore: (action: ExplorationAction) => asActive((id) => exploreFor(id, action)),
    shortRest: (exposure: number) => asActive((id) => shortRestFor(id, exposure)),
    sleep: (exposure: number) => asActive((id) => sleepFor(id, exposure)),
    eat: (nutrition: number) => asActive((id) => eatFor(id, nutrition)),
    drink: () => asActive(drinkFor),
    leaveParty: () => asActive(removeFromRoster),
    passET: () => updateCampaignState(passClock),
    sendActiveToFight: () => withActive((id) => updateTable(sendToFight([id], newId))),
    sendAllToFight: () => updateTable(sendToFight(Object.keys(useCampaignStore.getState().characters), newId)),
    returnFromFight: () => updateTable(returnFromFight(newId)),
  };
}
