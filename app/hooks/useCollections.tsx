import { useCallback, useMemo, useState } from "react";
import { CATALOGS, getCatalogRows, getKindLabel, isCatalogName } from "../forms/catalogs";
import { ALL_ENTRIES, getCatalogGroups, getCollections, type CatalogRow, type CatalogRows, type CollectionView } from "../domain/campaign/projections/collections";
import { newCollection, renameCollection, setInCollection, shareCollection, type CollectionUpdater } from "../domain/campaign/commands/collections";
import { deleteCollection, saveCollection } from "../actions";
import { canReadCollection, isOwnerOrDev } from "../domain/profiles";
import { useProfileId } from "./useProfile";
import { toast } from "sonner";
import type { CatalogKind, Collection } from "../domain/campaign/types";
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

// The collections a picker of the `catalogs`' entries offers: the
// catalogs' own, and the curated ones the profile at the screen reads in the
// campaign in play.
export function useCollections(catalogs: CatalogRows[]): CollectionView[] {
  const collections = useAppStore((s) => s.collections);
  const profile = useProfileId();
  const campaign = useCampaignStore((s) => s.file.id);
  return useMemo(() => getCollections(Object.values(collections).filter((c) => canReadCollection(c, profile, (id) => id === campaign)), catalogs), [collections, profile, campaign, catalogs]);
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
  collections: CollectionView[]; chosen: string; choose: (id: string) => void; keys: string[];
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
  return { collections, chosen: current.id, choose, keys: current.keys, all: current.id === ALL_ENTRIES, has, keep };
}

// A GM's own collections, made, named, filled, shared and thrown away; each
// is saved as it changes, and only its owner changes it.
export function useCollectionCommands() {
  const collections = useAppStore((s) => s.collections);
  const profile = useProfileId();
  const devServer = useAppStore((s) => s.devServer);
  const profiles = useAppStore((s) => s.profileList);
  const put = useAppStore((s) => s.putCollection);
  const drop = useAppStore((s) => s.dropCollection);
  const reload = useAppStore((s) => s.updateCollections);

  const save = async (collection: Collection) => {
    put(collection);
    const res = await saveCollection(collection);
    if (!res.ok) { toast.error(res.error); reload(); }
  };
  const change = (id: string, updater: CollectionUpdater) => {
    const collection = collections[id];
    if (collection) save(updater(collection));
  };

  return {
    editable: (id: string) => { const c = collections[id]; return !!c && isOwnerOrDev(c.owner, profile, devServer); },
    sharedWith: (id: string) => collections[id]?.shared ?? { profiles: [], campaigns: [] },
    ownerName: (owner: string | null) => profiles.find((p) => p.id === owner)?.name ?? '',
    others: profiles.filter((p) => p.id !== profile),
    create: (kind: CatalogKind) => {
      if (!profile) return null;
      const collection = newCollection(crypto.randomUUID(), profile, kind);
      save(collection);
      return collection.id;
    },
    rename: (id: string, name: string) => change(id, renameCollection(name)),
    set: (id: string, key: string, on: boolean) => change(id, setInCollection(key, on)),
    share: (id: string, to: 'profiles' | 'campaigns', target: string, on: boolean) => change(id, shareCollection(to, target, on)),
    remove: async (id: string) => {
      drop(id);
      const res = await deleteCollection(id);
      if (!res.ok) { toast.error(res.error); reload(); }
    },
  } as const;
}
