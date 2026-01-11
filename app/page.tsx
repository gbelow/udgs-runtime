import { App} from "./components"; 
import { getBasicCharList, getCharacterList } from "./actions";
import { AppStoreProvider } from "./stores/appStoreProvider";
import z from "zod";

export default async function Home() {
  // Fetch initial data server-side for faster initial load
  const [baseCharacterList, playerCharacterList] = await Promise.all([
    getBasicCharList(),
    getCharacterList(),
  ]);

  const characterListSchema = z.object({
    id: z.string(),
    name: z.string()
  }).strip().array();

  const characterList = characterListSchema.safeParse(playerCharacterList);


  return (
    <div className="font-sans items-center justify-items-center min-h-screen pb-20 gap-16 h-screen">
      <AppStoreProvider initialState={{baseCharacterList, playerCharacterList: characterList.data || []}}>
        <App />
      </AppStoreProvider>
    </div>
  );
}


