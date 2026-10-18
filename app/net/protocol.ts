import { SceneStateSchema, type SceneState } from "../domain/scene/types";
import { CampaignStateSchema, type CampaignState } from "../domain/campaign/types";
import { ExplorationStateSchema, type ExplorationState } from "../domain/exploration/types";
import { DowntimeStateSchema, type DowntimeState } from "../domain/downtime/types";
import type { CharacterOwners } from "../domain/profiles";
import type { CampaignFile } from "../stores/useCampaignStore";
import type { Commands, PartName } from "./parts";
import type { Patch } from "./diff";

// What the table shares: the fight and the campaign with what exploration and
// downtime keep, which saved campaign it is and who plays whom; never whom a
// screen has picked.
export type SharedCampaign = CampaignState & { exploration: ExplorationState; downtime: DowntimeState; file: CampaignFile; owners: CharacterOwners }
export type Shared = { scene: SceneState; campaign: SharedCampaign }

const SCENE_KEYS = Object.keys(SceneStateSchema.shape) as (keyof SceneState)[];
const CAMPAIGN_KEYS = [...Object.keys(CampaignStateSchema.shape), 'exploration', 'downtime', 'file', 'owners'] as (keyof SharedCampaign)[];

const pick = <T extends object, K extends keyof T>(from: T, keys: readonly K[]) =>
  Object.fromEntries(keys.map((k) => [k, from[k]])) as Pick<T, K>;

export const sharedSceneOf = (scene: SceneState): SceneState => pick(scene, SCENE_KEYS);

export const sharedOf = (scene: SceneState, campaign: SharedCampaign): Shared =>
  ({ scene: sharedSceneOf(scene), campaign: pick(campaign, CAMPAIGN_KEYS) });

// The whole state as it arrives over the wire, read as the stores keep it.
export const readShared = (raw: Shared): Shared => ({
  scene: SceneStateSchema.parse(raw.scene),
  campaign: {
    ...CampaignStateSchema.parse(raw.campaign),
    exploration: ExplorationStateSchema.parse(raw.campaign.exploration),
    downtime: DowntimeStateSchema.parse(raw.campaign.downtime),
    file: raw.campaign.file,
    owners: raw.campaign.owners,
  },
});

export type CommandMessage = { [P in PartName]: { kind: 'command'; part: P; command: Commands[P]; gmMode: boolean } }[PartName];

export type ToHost = CommandMessage | { kind: 'resync' };

export type ToGuest =
  | { kind: 'full'; seq: number; state: Shared }
  | { kind: 'patch'; seq: number; patch: Patch }
  | { kind: 'refused'; why: string }
  | { kind: 'moved'; room: string; roomName: string }
  | { kind: 'noHost' };

export type FromRelay =
  | { kind: 'join'; from: string; profile: string }
  | { kind: 'leave'; from: string; profile: string }
  | { kind: 'message'; from: string; profile: string; data: ToHost };
