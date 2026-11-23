import { Landing } from "../landing";
import { isDevServer } from "../devServer";

// The landing page, where the dev server shows it.
export default function LandingPage() {
  return <Landing dev={isDevServer()} />;
}
