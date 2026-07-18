import { useReadContracts } from "wagmi";
import { goalPot, usePotCount, POLL_MS, STATE_LABEL, type Pot } from "../lib/hooks";
import { fmtMon, timeLeft, pct } from "../lib/format";

export function PotList({
  onOpen,
  onCreate,
}: {
  onOpen: (id: bigint) => void;
  onCreate: () => void;
}) {
  const { data: count, isLoading, error } = usePotCount();
  const n = Number(count ?? 0n);

  const { data: potReads } = useReadContracts({
    contracts: Array.from({ length: n }, (_, i) => ({
      ...goalPot,
      functionName: "getPot",
      args: [BigInt(i)],
    })),
    query: { enabled: n > 0, refetchInterval: POLL_MS },
  });

  return (
    <section className="sheet">
      <div className="row spread">
        <h2 className="sheet-title">Open ledger</h2>
        <button className="primary" onClick={onCreate}>
          + Start a pot
        </button>
      </div>

      {error && (
        <p className="error-note">
          Could not reach the contract: {error.message.split("\n")[0]}
        </p>
      )}
      {isLoading && <p className="empty-note">Reading the chain…</p>}
      {!isLoading && n === 0 && !error && (
        <p className="empty-note">
          The ledger is blank. Be the first to start a savings pot.
        </p>
      )}

      {potReads?.map((r, i) => {
        if (r.status !== "success") return null;
        const p = r.result as unknown as Pot;
        const balance = p.totalDeposited + p.penaltyPool;
        return (
          <div key={i} className="pot-row" onClick={() => onOpen(BigInt(i))}>
            <div>
              <h3>
                Nº {String(i).padStart(3, "0")} — {p.name}
              </h3>
              <div className="meta">
                {p.memberCount} member{p.memberCount === 1 ? "" : "s"} ·{" "}
                {fmtMon(balance)} / {fmtMon(p.goal)} MON ({pct(balance, p.goal).toFixed(0)}
                %) · {p.state === 0 ? timeLeft(BigInt(p.deadline)) : "settled"}
              </div>
            </div>
            <span className={`stamp ${STATE_LABEL[p.state]}`}>{STATE_LABEL[p.state]}</span>
          </div>
        );
      })}
    </section>
  );
}
