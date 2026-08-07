import { useEffect, useMemo, useState } from "react";
import { usePublicClient } from "wagmi";
import { parseAbiItem } from "viem";
import { usePotAddresses, usePotSummaries, POT_TYPE, type PotSummary } from "../lib/hooks";
import { fmtMon, shortAddr } from "../lib/format";
import { potSlug } from "../lib/slug";

const DEPOSITED = parseAbiItem(
  "event Deposited(address indexed member, uint256 amount, uint256 newTotal)"
);

type Row = { address: `0x${string}`; value: bigint | number; detail?: string };

/**
 * MVP indexer: pulls Deposited logs from every pot the factory knows about and
 * aggregates them in the browser. Slow-but-honest for a few hundred pots; the
 * shape here (fetch → aggregate → render) is what a real indexer would slot
 * into by replacing `useAggregates` with an API call.
 */
function useAggregates(pots: PotSummary[]) {
  const client = usePublicClient();
  const [deposits, setDeposits] = useState<Map<string, bigint>>(new Map());
  const [donations, setDonations] = useState<Map<string, bigint>>(new Map());
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const key = pots.map((p) => p.address).join(",");

  useEffect(() => {
    let live = true;
    if (!client || pots.length === 0) {
      setLoading(false);
      return;
    }
    setLoading(true);
    (async () => {
      const dep = new Map<string, bigint>();
      const don = new Map<string, bigint>();
      try {
        for (const pot of pots) {
          const logs = await client.getLogs({
            address: pot.address,
            event: DEPOSITED,
            fromBlock: 0n,
            toBlock: "latest",
          });
          for (const l of logs) {
            const member = ((l.args as any).member as string).toLowerCase();
            const amount = (l.args as any).amount as bigint;
            dep.set(member, (dep.get(member) ?? 0n) + amount);
            if (pot.potType === POT_TYPE.Charity) {
              don.set(member, (don.get(member) ?? 0n) + amount);
            }
          }
        }
        if (!live) return;
        setDeposits(dep);
        setDonations(don);
      } catch {
        if (live) setErr("Could not read event history from this RPC.");
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [client, key]);

  return { deposits, donations, loading, err };
}

export function Leaderboard({ onOpen }: { onOpen: (address: string) => void }) {
  const { addresses } = usePotAddresses();
  const pots = usePotSummaries(addresses);
  const { deposits, donations, loading, err } = useAggregates(pots);

  const biggestSavers = useMemo(
    () =>
      [...deposits.entries()]
        .map(([address, value]) => ({ address: address as `0x${string}`, value }))
        .sort((a, b) => (b.value > a.value ? 1 : -1))
        .slice(0, 10),
    [deposits]
  );

  const mostGenerous = useMemo(
    () =>
      [...donations.entries()]
        .map(([address, value]) => ({ address: address as `0x${string}`, value }))
        .sort((a, b) => (b.value > a.value ? 1 : -1))
        .slice(0, 10),
    [donations]
  );

  const creators = useMemo(() => {
    const m = new Map<string, { reached: number; total: number }>();
    for (const p of pots) {
      const k = p.creator.toLowerCase();
      const cur = m.get(k) ?? { reached: 0, total: 0 };
      cur.total += 1;
      if (p.state === 1 || p.totalDeposited + p.penaltyPool >= p.goal) cur.reached += 1;
      m.set(k, cur);
    }
    return [...m.entries()]
      .map(([address, s]) => ({
        address: address as `0x${string}`,
        value: s.reached,
        detail: `${s.reached} of ${s.total} pots funded`,
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);
  }, [pots]);

  const streakPots = pots.filter((p) => p.potType === POT_TYPE.Streak);

  return (
    <>
      <section className="sheet">
        <h2 className="sheet-title">Leaderboard</h2>
        <p className="hint">
          Compiled in your browser from the contract event log — no server, no database.
          {loading && " Reading history…"}
        </p>
        {err && <p className="error-note">{err}</p>}
      </section>

      <Board
        title="Biggest savers"
        subtitle="Total MON deposited across every pot, lifetime."
        rows={biggestSavers}
        render={(r) => `${fmtMon(r.value as bigint)} MON`}
      />
      <Board
        title="Most generous"
        subtitle="Total MON donated to charity appeals."
        rows={mostGenerous}
        render={(r) => `${fmtMon(r.value as bigint)} MON`}
      />
      <Board
        title="Pot creator hall of fame"
        subtitle="Creators whose pots reach their goal."
        rows={creators}
        render={(r) => r.detail ?? String(r.value)}
      />

      <section className="sheet">
        <h2 className="sheet-title">Most consistent</h2>
        <p className="hint">
          Streak pots ranked by how much of the schedule their members have kept.
        </p>
        {streakPots.length === 0 ? (
          <p className="empty-note">No streak pots yet.</p>
        ) : (
          <div className="table-wrap mt">
            <table className="ledger">
              <thead>
                <tr>
                  <th>Pot</th>
                  <th>Members</th>
                  <th>Forfeit pool</th>
                </tr>
              </thead>
              <tbody>
                {streakPots.map((p) => (
                  <tr key={p.address}>
                    <td>
                      <a
                        href={`#/p/${potSlug(p.address)}`}
                        onClick={(e) => {
                          e.preventDefault();
                          onOpen(p.address);
                        }}
                      >
                        {p.name}
                      </a>
                    </td>
                    <td>{p.memberCount}</td>
                    <td>{fmtMon(p.penaltyPool)} MON</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function Board({
  title,
  subtitle,
  rows,
  render,
}: {
  title: string;
  subtitle: string;
  rows: Row[];
  render: (r: Row) => string;
}) {
  return (
    <section className="sheet">
      <h2 className="sheet-title">{title}</h2>
      <p className="hint">{subtitle}</p>
      {rows.length === 0 ? (
        <p className="empty-note">Nothing recorded yet.</p>
      ) : (
        <div className="table-wrap mt">
          <table className="ledger">
            <thead>
              <tr>
                <th>#</th>
                <th>Address</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.address}>
                  <td>{i === 0 ? "🏆" : String(i + 1).padStart(2, "0")}</td>
                  <td>{shortAddr(r.address)}</td>
                  <td>{render(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
