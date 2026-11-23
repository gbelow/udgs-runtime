import { FullApp } from "./fullApp";
import { Landing } from "./landing";
import { isDevServer } from "./devServer";

// The dev server opens on the whole app; everyone else on the landing page.
export default async function Home() {
  return isDevServer() ? <FullApp /> : <Landing dev={false} />;
}
