import { getBasicCharList, getBoardMapList, getDemoCollection, getStructureList } from "../actions";
import { AppStoreProvider } from "../stores/appStoreProvider";
import { DemoApp } from "../components/demo/DemoApp";
import { DEMO_VISITOR } from "../domain/demo";

// The demo: one prepared scene against the bots, played by a visitor with no
// profile, from the catalog and the shared battle maps alone. Nothing of it
// is saved.
export default async function Demo() {
  const [baseRes, boardRes, structureRes, collectionRes] = await Promise.all([
    getBasicCharList(),
    getBoardMapList(),
    getStructureList(),
    getDemoCollection(),
  ]);
  const boardMaps = boardRes.ok ? Object.fromEntries(Object.entries(boardRes.data).filter(([, b]) => b.owner === null)) : {};
  const structures = structureRes.ok ? Object.fromEntries(Object.entries(structureRes.data).filter(([, s]) => s.owner === null)) : {};

  return (
    <div className="font-sans min-h-screen bg-bg">
      <AppStoreProvider initialState={{
        baseCharacterList: baseRes.ok ? baseRes.data : {},
        boardMaps,
        structures,
        profile: { id: DEMO_VISITOR, name: 'you', dice: 'screen' },
        profileList: [],
        devServer: false,
        selectedGameTab: 'scene',
      }}>
        <DemoApp offered={collectionRes.ok ? collectionRes.data : null} />
      </AppStoreProvider>
    </div>
  );
}
