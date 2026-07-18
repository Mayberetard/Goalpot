import { useEffect, useState } from "react";
import { useReadContract } from "wagmi";
import { goalPot } from "./lib/hooks";
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

export default function App() {
  const [route, setRoute] = useState<Route>(parseHash);
  const versionMismatch = useVersionMismatch();

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
