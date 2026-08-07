import { useEffect, useState } from "react";
import { usePublicClient, useReadContract } from "wagmi";
import { parseAbiItem } from "viem";
import { potContract, POLL_MS, type PotSummary } from "../lib/hooks";
import { fmtMon, shortAddr } from "../lib/format";

const DONATION_EVENT = parseAbiItem(
  "event DonationMessage(address indexed donor, uint256 amount, string message)"
);

type Note = { donor: `0x${string}`; amount: bigint; message: string; block: bigint };

/** Public messages left with donations, read straight from the event log —
 *  no IPFS gateway or backend in the path. */
export function DonorWall({ pot }: { pot: PotSummary }) {
  const client = usePublicClient();
  const [notes, setNotes] = useState<Note[]>([]);
  const [err, setErr] = useState("");

  const { data: donorCount } = useReadContract({
    ...potContract(pot.address, pot.potType),
    functionName: "donorCount",
    query: { refetchInterval: POLL_MS },
  });
  const { data: charityName } = useReadContract({
    ...potContract(pot.address, pot.potType),
    functionName: "charityName",
  });

  useEffect(() => {
    let live = true;
    if (!client) return;
    client
      .getLogs({ address: pot.address, event: DONATION_EVENT, fromBlock: 0n, toBlock: "latest" })
      .then((logs) => {
        if (!live) return;
        setNotes(
          logs.map((l) => ({
            donor: (l.args as any).donor,
            amount: (l.args as any).amount as bigint,
            message: (l.args as any).message as string,
            block: l.blockNumber ?? 0n,
          }))
        );
      })
      .catch(() => live && setErr("Could not load the donor wall from this RPC."));
    return () => {
      live = false;
    };
  }, [client, pot.address, donorCount]);

  const total = pot.totalDeposited + pot.penaltyPool;
  const shareText = `I donated to ${charityName ?? pot.name} via Goalpot — ${fmtMon(
    total
  )} MON raised so far.`;

  return (
    <section className="sheet">
      <div className="row spread">
        <h2 className="sheet-title">Donor wall</h2>
        <button
          className="ghost"
          onClick={() => {
            const url = window.location.href;
            if (navigator.share) navigator.share({ text: shareText, url }).catch(() => {});
            else navigator.clipboard.writeText(`${shareText} ${url}`);
          }}
        >
          Share this appeal
        </button>
      </div>
      <p className="hint">
        {String(donorCount ?? 0)} donor{Number(donorCount ?? 0) === 1 ? "" : "s"} ·{" "}
        {fmtMon(total)} MON raised for {String(charityName ?? "this cause")}.
      </p>

      {err && <p className="error-note">{err}</p>}
      {notes.length === 0 && !err && (
        <p className="empty-note">
          No public messages yet — donate with a note to start the wall.
        </p>
      )}
      <div className="donor-wall mt">
        {notes
          .slice()
          .reverse()
          .map((n, i) => (
            <figure key={`${n.donor}-${i}`} className="donor-note">
              <blockquote>{n.message}</blockquote>
              <figcaption>
                {shortAddr(n.donor)} · {fmtMon(n.amount)} MON
              </figcaption>
            </figure>
          ))}
      </div>

      {pot.state === 1 && <TaxReceipt pot={pot} notes={notes} />}
    </section>
  );
}

function TaxReceipt({ pot, notes }: { pot: PotSummary; notes: Note[] }) {
  const { data: charityName } = useReadContract({
    ...potContract(pot.address, pot.potType),
    functionName: "charityName",
  });

  function download() {
    const mine = notes;
    const lines = [
      "GOALPOT — DONATION SUMMARY",
      "==========================",
      `Appeal:       ${pot.name}`,
      `Charity:      ${String(charityName ?? "")}`,
      `Pot contract: ${pot.address}`,
      `Payout to:    ${pot.beneficiary}`,
      `Generated:    ${new Date().toISOString()}`,
      "",
      "Donations recorded with public messages:",
      ...mine.map((n) => `  ${n.donor}  ${fmtMon(n.amount)} MON  "${n.message}"`),
      "",
      `Total raised: ${fmtMon(pot.totalDeposited + pot.penaltyPool)} MON`,
      "",
      "This summary is generated from on-chain records and is not tax advice.",
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `goalpot-donation-summary-${pot.address.slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mt">
      <button onClick={download}>Download donation summary</button>
      <p className="hint">
        A plain-text record of this appeal's on-chain donations, for your files.
      </p>
    </div>
  );
}
