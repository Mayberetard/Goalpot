import { useEffect, useRef, useState } from "react";
import { useAccount, useDisconnect, useWriteContract } from "wagmi";
import { isAddress } from "viem";
import QRCode from "qrcode";
import { potContract, POT_TYPE, type PotSummary } from "../lib/hooks";
import { isStaleConnectorError, STALE_SESSION_MSG } from "../lib/errors";
import { potSlug } from "../lib/slug";
import { fmtMon, pct } from "../lib/format";

export function InvitePanel({ pot }: { pot: PotSummary }) {
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const { writeContractAsync, isPending } = useWriteContract();
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [inviteesRaw, setInviteesRaw] = useState("");
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Opaque share code — not enumerable. The chain is still public; the real
  // gate on invite-only pots is the on-chain allowlist.
  const url = `${window.location.origin}${window.location.pathname}#/p/${potSlug(pot.address)}`;
  // Rich-preview link for Discord/X. It exposes the pot address (crawlers need
  // a real path, not a fragment), so it is only offered for open pots —
  // invite-only pots keep the opaque link.
  const previewUrl = pot.openJoin ? `${window.location.origin}/s/${pot.address}` : null;
  const isCreator = !!address && address.toLowerCase() === pot.creator.toLowerCase();
  const canShare = typeof navigator !== "undefined" && !!navigator.share;
  const isCharity = pot.potType === POT_TYPE.Charity;

  const balance = pot.totalDeposited + pot.penaltyPool;
  const shareText = `${pot.name} — ${pct(balance, pot.goal).toFixed(0)}% funded (${fmtMon(
    balance
  )}/${fmtMon(pot.goal)} MON) on Goalpot`;

  useEffect(() => {
    if (showQr && canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, url, {
        width: 200,
        margin: 1,
        color: { dark: "#2b2620", light: "#faf5ea" },
      });
    }
  }, [showQr, url]);

  async function copy() {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function invite() {
    setErr("");
    setOk("");
    try {
      const list = inviteesRaw.split(/[\s,;]+/).map((a) => a.trim()).filter(Boolean);
      if (list.length === 0) throw new Error("Paste at least one address.");
      if (list.length > 100) throw new Error("At most 100 addresses per transaction.");
      for (const a of list)
        if (!isAddress(a)) throw new Error(`Not a valid address: ${a.slice(0, 20)}…`);
      await writeContractAsync({
        ...potContract(pot.address, pot.potType),
        functionName: "inviteMembers",
        args: [list as `0x${string}`[]],
      });
      setInviteesRaw("");
      setOk(`Invited ${list.length} address${list.length === 1 ? "" : "es"}.`);
    } catch (e) {
      if (isStaleConnectorError(e)) {
        disconnect();
        setErr(STALE_SESSION_MSG);
      } else {
        setErr(e instanceof Error ? e.message.split("\n")[0] : String(e));
      }
    }
  }

  return (
    <section className="sheet">
      <h2 className="sheet-title">{isCharity ? "Spread the word" : "Invite members"}</h2>
      <p className="hint">
        {pot.openJoin
          ? isCharity
            ? "Anyone with this link can donate."
            : "Anyone with this link can join by depositing."
          : "Share the link with people you've invited — only allowlisted addresses can deposit."}
      </p>
      <div className="row mt">
        <button onClick={copy}>{copied ? "Copied ✓" : "Copy pot link"}</button>
        {previewUrl && (
          <button
            onClick={async () => {
              await navigator.clipboard.writeText(previewUrl);
              setOk("Preview link copied — it unfurls with live progress on Discord and X.");
              setTimeout(() => setOk(""), 3000);
            }}
          >
            Copy link with preview
          </button>
        )}
        {canShare && (
          <button
            onClick={() =>
              navigator
                .share({ title: `Goalpot — ${pot.name}`, text: shareText, url: previewUrl ?? url })
                .catch(() => {})
            }
          >
            Share…
          </button>
        )}
        <button className="ghost" onClick={() => setShowQr((s) => !s)}>
          {showQr ? "Hide QR" : "Show QR"}
        </button>
      </div>
      {ok && !inviteesRaw && <p className="ok-note">{ok}</p>}
      {showQr && (
        <div className="mt">
          <canvas
            ref={canvasRef}
            style={{ border: "1.5px solid var(--ink)", borderRadius: 8 }}
          />
        </div>
      )}

      {!pot.openJoin && isCreator && pot.state === 0 && (
        <div className="mt">
          <label className="field">
            <span>Add to the allowlist (one address per line)</span>
            <textarea
              value={inviteesRaw}
              onChange={(e) => setInviteesRaw(e.target.value)}
              placeholder={"0xabc…\n0xdef…"}
              rows={2}
            />
          </label>
          <button className="mt" disabled={!isConnected || isPending} onClick={invite}>
            {isPending ? "Sign in wallet…" : "Invite"}
          </button>
          {err && <p className="error-note">{err}</p>}
          {ok && <p className="ok-note">{ok}</p>}
        </div>
      )}
    </section>
  );
}
