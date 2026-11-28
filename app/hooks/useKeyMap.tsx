import { getKeyMap, type KeyMap } from "../keys";

const DEFAULT = getKeyMap();

// The keys the screen answers to: the default key profile
// (assets/keys/default.json), until a player's own can be picked.
export function useKeyMap(): KeyMap {
  return DEFAULT;
}
