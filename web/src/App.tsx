import { useEffect, useState } from "react";
import { Header } from "./components/Header";
import { PotList } from "./components/PotList";
import { PotDetail } from "./components/PotDetail";
import { CreatePot } from "./components/CreatePot";
import { Leaderboard } from "./components/Leaderboard";
import { FACTORY_ADDRESS, chain, explorerUrl } from "./lib/config";
import { usePotAddresses } from "./lib/hooks";
import { potSlug, resolveSlug } from "./lib/slug";

const GITHUB_URL = "https://github.com/Mayberetard/Goalpot";

type Route =
  | { view: "list" }
  | { view: "create" }
  | { view: "leaderboard" }
  | { view: "slug"; slug: string }
  | { view: "address"; address: `0x${string}` };

function parseHash(): Route {
  const h = window.location.hash;
  if (h === "#/new" || h === "#/create") return { view: "create" };
  if (h === "#/leaderboard") return { view: "leaderboard" };
  let m = h.match(/^#\/p\/([0-9a-fA-F]{12})$/);
  if (m) return { view: "slug", slug: m[1] };
  m = h.match(/^#\/pot\/(0x[0-9a-fA-F]{40})$/); // direct address links
  if (m) return { view: "address", address: m[1] as `0x${string}` };
  return { view: "list" };
}

type Theme = "light" | "dark";

function initialTheme(): Theme {
  const saved = localStorage.getItem("goalpot-theme");
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Resolves an opaque share code to a pot address, then renders it. */
function PotBySlug({ slug, onBack }: { slug: string; onBack: () => void }) {
  const { addresses, isLoading } = usePotAddresses();
  if (isLoading)
    return (
      <section className="sheet">
        <p className="empty-note">Reading the chain…</p>
      </section>
    );
  const address = resolveSlug(slug, addresses);
  if (!address)
    return (
      <section className="sheet">
        <div className="rule-label">No such entry</div>
        <p>This invite link doesn't match any pot on the current factory.</p>
        <button className="crumb" onClick={onBack}>
          ← back to the ledger
        </button>
      </section>
    );
  return <PotDetail address={address} onBack={onBack} />;
}

export default function App() {
  const [route, setRoute] = useState<Route>(parseHash);
  const [theme, setTheme] = useState<Theme>(initialTheme);

  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("goalpot-theme", theme);
  }, [theme]);

  const go = (hash: string) => {
    window.location.hash = hash;
  };
  const openPot = (address: string) => go(`/p/${potSlug(address)}`);

  return (
    <>
      <Header
        onHome={() => go("/")}
        onLeaderboard={() => go("/leaderboard")}
        theme={theme}
        onToggleTheme={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
      />
      {!FACTORY_ADDRESS ? (
        <div className="sheet">
          <div className="rule-label">Setup required</div>
          <p>
            No factory address configured. Deploy the contracts to {chain.name} and set{" "}
            <code>VITE_FACTORY_ADDRESS</code> in <code>web/.env</code>. Every number on
            this page is read from the chain — there is nothing to show without a
            factory.
          </p>
        </div>
      ) : route.view === "create" ? (
        <CreatePot onDone={(addr) => (addr ? openPot(addr) : go("/"))} />
      ) : route.view === "leaderboard" ? (
        <Leaderboard onOpen={openPot} />
      ) : route.view === "slug" ? (
        <PotBySlug slug={route.slug} onBack={() => go("/")} />
      ) : route.view === "address" ? (
        <PotDetail address={route.address} onBack={() => go("/")} />
      ) : (
        <PotList onOpen={openPot} onCreate={() => go("/new")} />
      )}
      <footer className="colophon">
        <span>
          © {new Date().getFullYear()} GOALPOT · all rights reserved · a coöperative
          savings ledger on {chain.name}
        </span>
        <span className="colophon-links">
          <a href={GITHUB_URL} target="_blank" rel="noreferrer">
            github ↗
          </a>
          {FACTORY_ADDRESS && (
            <a
              href={`${explorerUrl}/address/${FACTORY_ADDRESS}`}
              target="_blank"
              rel="noreferrer"
            >
              factory ↗
            </a>
          )}
        </span>
      </footer>
    </>
  );
}
