import { useEffect, useState } from "react";
import { useReadContract } from "wagmi";
import { goalPot } from "./lib/hooks";
import { Header } from "./components/Header";
import { PotList } from "./components/PotList";
import { PotDetail } from "./components/PotDetail";
import { CreatePot } from "./components/CreatePot";
import { GOALPOT_ADDRESS, chain, explorerUrl } from "./lib/config";
import { potSlug, resolveSlug } from "./lib/slug";

const GITHUB_URL = "https://github.com/Mayberetard/Goalpot";

type Route =
  | { view: "list" }
  | { view: "create" }
  | { view: "pot"; id: bigint }
  | { view: "slug"; slug: string };

function parseHash(): Route {
  const h = window.location.hash;
  if (h === "#/new") return { view: "create" };
  let m = h.match(/^#\/pot\/(\d+)$/); // legacy numeric links keep working
  if (m) return { view: "pot", id: BigInt(m[1]) };
  m = h.match(/^#\/p\/([0-9a-fA-F]{12})$/);
  if (m) return { view: "slug", slug: m[1] };
  return { view: "list" };
}

type Theme = "light" | "dark";

function initialTheme(): Theme {
  const saved = localStorage.getItem("goalpot-theme");
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/** Detects a configured address that answers basic calls but lacks functions
 *  from the current ABI — i.e. an older GoalPot deployment left in
 *  VITE_GOALPOT_ADDRESS after a breaking contract change. */
function useVersionMismatch(): boolean {
  const base = useReadContract({
    ...goalPot,
    functionName: "potCount",
    query: { enabled: !!GOALPOT_ADDRESS, retry: 1, staleTime: Infinity },
  });
  const probe = useReadContract({
    ...goalPot,
    functionName: "invitedOf", // exists only since the invite-only update
    args: [0n, "0x0000000000000000000000000000000000000001"],
    query: { enabled: !!GOALPOT_ADDRESS, retry: 1, staleTime: Infinity },
  });
  return base.isSuccess && probe.isError;
}

/** Resolves an opaque share code to a pot id, then renders the pot. */
function PotBySlug({ slug, onBack }: { slug: string; onBack: () => void }) {
  const { data: count, isLoading } = useReadContract({
    ...goalPot,
    functionName: "potCount",
  });
  if (isLoading || count === undefined)
    return (
      <section className="sheet">
        <p className="empty-note">Reading the chain…</p>
      </section>
    );
  const id = resolveSlug(slug, count as bigint);
  if (id === null)
    return (
      <section className="sheet">
        <div className="rule-label">No such entry</div>
        <p>This invite link doesn't match any pot on the current contract.</p>
        <button className="crumb" onClick={onBack}>← back to the ledger</button>
      </section>
    );
  return <PotDetail potId={id} onBack={onBack} />;
}

export default function App() {
  const [route, setRoute] = useState<Route>(parseHash);
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const versionMismatch = useVersionMismatch();

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
  const openPot = (id: bigint) => go(`/p/${potSlug(id)}`);

  return (
    <>
      <Header
        onHome={() => go("/")}
        theme={theme}
        onToggleTheme={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
      />
      {versionMismatch && (
        <div className="sheet">
          <div className="rule-label">Configuration problem</div>
          <p>
            The configured contract at <code>{GOALPOT_ADDRESS}</code> is an{" "}
            <b>older GoalPot deployment</b> that doesn't match this version of the
            app — transactions will fail. Operator: redeploy the contract from the
            current code (<code>npm run deploy:testnet</code>) and update{" "}
            <code>VITE_GOALPOT_ADDRESS</code>.
          </p>
        </div>
      )}
      {!GOALPOT_ADDRESS ? (
        <div className="sheet">
          <div className="rule-label">Setup required</div>
          <p>
            No contract address configured. Deploy <code>GoalPot.sol</code> to{" "}
            {chain.name} and set <code>VITE_GOALPOT_ADDRESS</code> in{" "}
            <code>web/.env</code>. Every number on this page is read from the
            chain — there is nothing to show without a contract.
          </p>
        </div>
      ) : route.view === "create" ? (
        <CreatePot onDone={(id) => (id !== undefined ? openPot(id) : go("/"))} />
      ) : route.view === "pot" ? (
        <PotDetail potId={route.id} onBack={() => go("/")} />
      ) : route.view === "slug" ? (
        <PotBySlug slug={route.slug} onBack={() => go("/")} />
      ) : (
        <PotList onOpen={openPot} onCreate={() => go("/new")} />
      )}
      <footer className="colophon">
        <span>
          © {new Date().getFullYear()} GOALPOT · all rights reserved · a
          coöperative savings ledger on {chain.name}
        </span>
        <span className="colophon-links">
          <a href={GITHUB_URL} target="_blank" rel="noreferrer">
            github ↗
          </a>
          {GOALPOT_ADDRESS && (
            <a
              href={`${explorerUrl}/address/${GOALPOT_ADDRESS}`}
              target="_blank"
              rel="noreferrer"
            >
              contract ↗
            </a>
          )}
        </span>
      </footer>
    </>
  );
}
