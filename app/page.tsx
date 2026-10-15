import { App } from "./components/App"; 
import { getBasicCharList, getCharacterList, getCampaignList, getCollectionList, getCurrentProfile, getMapList, getProfileList, getRaceList } from "./actions";
import { AppStoreProvider } from "./stores/appStoreProvider";
import { isDevServer } from "./devServer";
import z from "zod";

export default async function Home() {
  // Fetch initial data server-side for faster initial load
  const [baseRes, playerRes, raceRes, mapRes, profileRes, profileListRes, collectionRes, campaignRes] = await Promise.all([
    getBasicCharList(),
    getCharacterList(),
    getRaceList(),
    getMapList(),
    getCurrentProfile(),
    getProfileList(),
    getCollectionList(),
    getCampaignList(),
  ]);
  const collections = collectionRes.ok ? collectionRes.data : {};
  const campaignList = campaignRes.ok ? campaignRes.data : [];
  const profile = profileRes.ok ? profileRes.data : null;
  const profileList = profileListRes.ok ? profileListRes.data : [];

  const baseCharacterList = baseRes.ok ? baseRes.data : {};
  const playerCharacterList = playerRes.ok ? playerRes.data : [];
  const raceList = raceRes.ok ? raceRes.data : {};
  const mapList = mapRes.ok ? mapRes.data : {};

  const characterListSchema = z.object({
    id: z.string(),
    name: z.string()
  }).strip().array();

  const characterList = characterListSchema.safeParse(playerCharacterList);


  return (
    <div className="font-sans items-center justify-items-center min-h-screen pb-20 gap-16 h-screen">
      <AppStoreProvider initialState={{baseCharacterList, raceList, mapList, playerCharacterList: characterList.data || [], profile, profileList, collections, campaignList, devServer: isDevServer()}}>
        <App />
      </AppStoreProvider>
    </div>
  );
}


