import { useEffect, useState } from "react";
import { Header } from "./components/Header";
import { PotList } from "./components/PotList";
import { PotDetail } from "./components/PotDetail";
import { CreatePot } from "./components/CreatePot";
import { GOALPOT_ADDRESS, chain, explorerUrl } from "./lib/config";

type Route = { view: "list" } | { view: "create" } | { view: "pot"; id: bigint };

function parseHash(): Route {
  const h = window.location.hash;
  if (h === "#/new") return { view: "create" };
  const m = h.match(/^#\/pot\/(\d+)$/);
  if (m) return { view: "pot", id: BigInt(m[1]) };
  return { view: "list" };
}

export default function App() {
  const [route, setRoute] = useState<Route>(parseHash);

  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const go = (hash: string) => {
    window.location.hash = hash;
  };

  return (
    <>
      <Header onHome={() => go("/")} />
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
        <CreatePot onDone={(id) => go(id !== undefined ? `/pot/${id}` : "/")} />
      ) : route.view === "pot" ? (
        <PotDetail potId={route.id} onBack={() => go("/")} />
      ) : (
        <PotList onOpen={(id) => go(`/pot/${id}`)} onCreate={() => go("/new")} />
      )}
      <footer className="colophon">
        <span>GOALPOT · a coöperative savings ledger on {chain.name}</span>
        <span>
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
