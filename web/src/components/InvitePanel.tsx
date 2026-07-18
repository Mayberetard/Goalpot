import { useEffect, useRef, useState } from "react";
import { useAccount } from "wagmi";
import { isAddress } from "viem";
import QRCode from "qrcode";
import { useWriteContract } from "wagmi";
import { goalPot, type Pot } from "../lib/hooks";

export function InvitePanel({ potId, pot }: { potId: bigint; pot: Pot }) {
  const { address, isConnected } = useAccount();
  const { writeContractAsync, isPending } = useWriteContract();
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [inviteesRaw, setInviteesRaw] = useState("");
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const url = `${window.location.origin}${window.location.pathname}#/pot/${potId}`;
  const isCreator = !!address && address.toLowerCase() === pot.creator.toLowerCase();
  const canShare = typeof navigator !== "undefined" && !!navigator.share;

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
      for (const a of list) {
        if (!isAddress(a)) throw new Error(`Not a valid address: ${a.slice(0, 20)}…`);
      }
      await writeContractAsync({
        ...goalPot,
        functionName: "inviteMembers",
        args: [potId, list as `0x${string}`[]],
      });
      setInviteesRaw("");
      setOk(`Invited ${list.length} address${list.length === 1 ? "" : "es"}.`);
    } catch (e) {
      setErr(e instanceof Error ? e.message.split("\n")[0] : String(e));
    }
  }

  return (
    <section className="sheet">
      <h2 className="sheet-title">Invite members</h2>
      <p className="hint">
        {pot.openJoin
          ? "Anyone with this link can join by depositing."
          : "Share the link with people you've invited — only allowlisted addresses can deposit."}
      </p>
      <div className="row mt">
        <button onClick={copy}>{copied ? "Copied ✓" : "Copy pot link"}</button>
        {canShare && (
          <button
            onClick={() =>
              navigator.share({ title: `Goalpot — ${pot.name}`, url }).catch(() => {})
            }
          >
            Share…
          </button>
        )}
        <button className="ghost" onClick={() => setShowQr((s) => !s)}>
          {showQr ? "Hide QR" : "Show QR"}
        </button>
      </div>
      {showQr && (
        <div className="mt">
          <canvas ref={canvasRef} style={{ border: "1.5px solid var(--ink)", borderRadius: 8 }} />
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
