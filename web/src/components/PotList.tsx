import { useState } from "react";
import { usePotAddresses, usePotSummaries, STATE_LABEL, POT_TYPE_LABEL } from "../lib/hooks";
import { fmtMon, timeLeft, pct } from "../lib/format";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "0", label: "Standard" },
  { id: "1", label: "Streak" },
  { id: "2", label: "Charity" },
] as const;

export function PotList({
  onOpen,
  onCreate,
}: {
  onOpen: (address: string) => void;
  onCreate: () => void;
}) {
  const { addresses, count, isLoading, error } = usePotAddresses();
  const pots = usePotSummaries(addresses);
  const [filter, setFilter] = useState<string>("all");

  const shown = filter === "all" ? pots : pots.filter((p) => String(p.potType) === filter);

  return (
    <section className="sheet">
      <div className="row spread">
        <h2 className="sheet-title">Open ledger</h2>
        <button className="primary" onClick={onCreate}>
          + Start a pot
        </button>
      </div>

      {count > 0 && (
        <div className="row mt filter-row">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              className={filter === f.id ? "chip active" : "chip"}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      {error && (
        <p className="error-note">
          Monad RPC unreachable — check your connection and refresh.
        </p>
      )}
      {isLoading && <p className="empty-note">Reading the chain…</p>}
      {!isLoading && count === 0 && !error && (
        <p className="empty-note">The ledger is blank. Be the first to start a pot.</p>
      )}

      {shown.map((p, i) => {
        const balance = p.totalDeposited + p.penaltyPool;
        return (
          <div key={p.address} className="pot-row" onClick={() => onOpen(p.address)}>
            <div>
              <h3>
                Nº {String(i).padStart(3, "0")} — {p.name}
              </h3>
              <div className="meta">
                {p.memberCount} member{p.memberCount === 1 ? "" : "s"} ·{" "}
                {fmtMon(balance)} / {fmtMon(p.goal)} MON ({pct(balance, p.goal).toFixed(0)}%)
                · {p.state === 0 ? timeLeft(p.deadline) : "settled"}
              </div>
            </div>
            <div className="row" style={{ gap: 6 }}>
              {p.potType !== 0 && (
                <span className={`stamp type-${p.potType}`}>
                  {POT_TYPE_LABEL[p.potType]}
                </span>
              )}
              <span className={`stamp ${STATE_LABEL[p.state]}`}>
                {STATE_LABEL[p.state]}
              </span>
            </div>
          </div>
        );
      })}
      {!isLoading && count > 0 && shown.length === 0 && (
        <p className="empty-note">No {POT_TYPE_LABEL[Number(filter)]} pots yet.</p>
      )}
    </section>
  );
}
