import Image from "next/image";
import Link from "next/link";
import logo from "./assets/fallow_logo_umber.png";

// What fallow is, and the way into the demo: the home page everywhere but on
// the dev server, where it is at /home and links back to the whole app.
export function Landing({ dev }: { dev: boolean }) {
  return (
    <main className="min-h-screen bg-bg text-fg flex flex-col items-center justify-center gap-8 px-6 py-12 text-center">
      <Image src={logo} alt="" priority className="w-72 h-auto mix-blend-lighten brightness-[2.2]" />
      <div className="flex flex-col gap-3 max-w-xl">
        <h1 className="text-4xl font-semibold tracking-wide">fallow</h1>
        <p className="text-lg text-muted">A tabletop roleplaying game, and the table to play it on.</p>
        <p className="text-sm text-muted">
          The app runs the book&apos;s rules: tests, wounds, reactions, morale. Every option shows its cost, and every
          result shows how it came to be.
        </p>
      </div>
      <div className="flex flex-col items-center gap-3">
        <Link href="/demo" className="rounded border border-accent bg-accent/15 px-6 py-3 text-lg font-medium text-accent hover:bg-accent/25">
          Play the demo
        </Link>
        <span className="text-xs text-muted">Pick a party, place it, and fight a band of bots.</span>
        {dev ? <Link href="/" className="text-sm text-muted underline hover:text-fg">open the full app</Link> : null}
      </div>
    </main>
  );
}
