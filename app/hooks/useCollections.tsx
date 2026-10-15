import { useCallback, useMemo, useState } from "react";
import { CATALOGS, getCatalogRows, getKindLabel, isCatalogName } from "../forms/catalogs";
import { ALL_ENTRIES, getCatalogGroups, getCollections, type CatalogRow, type CatalogRows, type CollectionView } from "../domain/campaign/projections/collections";
import { createCollection, removeCollection, renameCollection, setInCollection } from "../domain/campaign/commands/collections";
import type { CatalogKind } from "../domain/campaign/types";
import { getBaseCharacters } from "../domain/character/grouping";
import type { JsonObject } from "../actions";
import { useAppStore } from "../stores/useAppStore";
import { useCampaignStore } from "../stores/useCampaignStore";

type Lists = { characters: JsonObject; races: JsonObject; maps: JsonObject };

// Every entry of `kind`'s catalog: a saved character under its name and its
// first tag, a race or a map under its name, every other catalog as its
// editor lists it.
function catalogRows(kind: CatalogKind, lists: Lists): CatalogRow[] {
  if (isCatalogName(kind)) return getCatalogRows(CATALOGS[kind]);
  if (kind === 'characters') return getBaseCharacters(lists.characters).map((c) => ({ key: c.name, name: c.name, group: c.tags[0]?.trim() ?? '' }));
  return Object.keys(lists[kind]).sort().map((key) => ({ key, name: key, group: '' }));
}

// The entries of each of the `kinds` of catalog.
export function useCatalogRows(...kinds: CatalogKind[]): CatalogRows[] {
  const characters = useAppStore((s) => (kinds.includes('characters') ? s.baseCharacterList : null));
  const races = useAppStore((s) => (kinds.includes('races') ? s.raceList : null));
  const maps = useAppStore((s) => (kinds.includes('maps') ? s.mapList : null));
  const key = kinds.join();
  return useMemo(() => {
    const lists = { characters: characters ?? {}, races: races ?? {}, maps: maps ?? {} };
    return (key.split(',') as CatalogKind[]).map((kind) => ({ kind, label: getKindLabel(kind), rows: catalogRows(kind, lists) }));
  }, [key, characters, races, maps]);
}

// The collections a picker of the `catalogs`' entries offers.
export function useCollections(catalogs: CatalogRows[]): CollectionView[] {
  const collections = useCampaignStore((s) => s.collections);
  return useMemo(() => getCollections(collections, catalogs), [collections, catalogs]);
}

// The Collections tab's view of one catalog: its collections, and its
// entries by category to fill one from.
export function useCollectionEditor(kind: CatalogKind) {
  const catalogs = useCatalogRows(kind);
  const collections = useCollections(catalogs);
  const groups = useMemo(() => getCatalogGroups(catalogs[0].rows), [catalogs]);
  return { collections, groups } as const;
}

// A picker narrowed to one collection of the `kinds` of catalog, everything
// until another is chosen. `all` says nothing is narrowed; `keep` narrows a
// list of keys, keeping `current` where it is one of them, so a picked value
// stays shown.
export type CollectionFilter = {
  collections: CollectionView[]; chosen: string; choose: (id: string) => void;
  all: boolean; has: (key: string) => boolean; keep: (keys: string[], current?: string | null) => string[];
};

export function useCollectionFilter(...kinds: CatalogKind[]): CollectionFilter {
  const collections = useCollections(useCatalogRows(...kinds));
  const [chosen, choose] = useState(ALL_ENTRIES);
  const current = collections.find((c) => c.id === chosen) ?? collections[0];
  const digest = current.keys.join('\n');
  const keys = useMemo(() => new Set(digest.split('\n')), [digest]);
  const has = useCallback((key: string) => keys.has(key), [keys]);
  const keep = useCallback((list: string[], picked?: string | null) =>
    list.filter((key) => keys.has(key) || key === picked), [keys]);
  return { collections, chosen: current.id, choose, all: current.id === ALL_ENTRIES, has, keep };
}

// The GM's own collections, made, named, filled and thrown away; they are
// the campaign in play's, saved with it.
export function useCollectionCommands() {
  const update = useCampaignStore((s) => s.updateCampaignState);
  const campaign = useCampaignStore((s) => s.file.name);
  return {
    campaign,
    create: (kind: CatalogKind) => {
      const id = crypto.randomUUID();
      update(createCollection(id, kind));
      return id;
    },
    rename: (id: string, name: string) => update(renameCollection(id, name)),
    remove: (id: string) => update(removeCollection(id)),
    set: (id: string, key: string, on: boolean) => update(setInCollection(id, key, on)),
  } as const;
}
