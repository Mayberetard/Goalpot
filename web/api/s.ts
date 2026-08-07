/**
 * Per-pot link preview. Social crawlers don't execute JavaScript and never see
 * a URL fragment, so `/#/p/<slug>` can't carry per-pot Open Graph tags. This
 * serverless function serves a tiny HTML shell at `/s/<address>` with OG tags
 * filled in from live chain data, then redirects real browsers into the SPA.
 *
 * It is stateless and read-only — the "no backend" rule stands; this is the
 * shareable-card exception.
 */
import { createPublicClient, http, formatEther, isAddress } from "viem";
import { defineChain } from "viem";

export const config = { runtime: "edge" };

const CHAIN_ID = Number(process.env.VITE_MONAD_NETWORK === "mainnet" ? 143 : 10143);
const RPC =
  process.env.VITE_RPC_URL ||
  (CHAIN_ID === 143 ? "https://rpc.monad.xyz" : "https://testnet-rpc.monad.xyz");
const SITE = process.env.VITE_SITE_URL || "https://goalpot-pi.vercel.app";

const chain = defineChain({
  id: CHAIN_ID,
  name: CHAIN_ID === 143 ? "Monad" : "Monad Testnet",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});

const POT_ABI = [
  { type: "function", name: "name", inputs: [], outputs: [{ type: "string" }], stateMutability: "view" },
  { type: "function", name: "goal", inputs: [], outputs: [{ type: "uint96" }], stateMutability: "view" },
  { type: "function", name: "totalDeposited", inputs: [], outputs: [{ type: "uint96" }], stateMutability: "view" },
  { type: "function", name: "penaltyPool", inputs: [], outputs: [{ type: "uint96" }], stateMutability: "view" },
  { type: "function", name: "memberCount", inputs: [], outputs: [{ type: "uint32" }], stateMutability: "view" },
  { type: "function", name: "potType", inputs: [], outputs: [{ type: "uint8" }], stateMutability: "view" },
] as const;

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const fmt = (wei: bigint) => {
  const s = formatEther(wei);
  const [i, f = ""] = s.split(".");
  const t = f.slice(0, 3).replace(/0+$/, "");
  return t ? `${i}.${t}` : i;
};

function page(title: string, description: string, redirectTo: string) {
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"/>
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}"/>
<meta property="og:type" content="website"/>
<meta property="og:site_name" content="Goalpot"/>
<meta property="og:title" content="${esc(title)}"/>
<meta property="og:description" content="${esc(description)}"/>
<meta property="og:image" content="${SITE}/og.png"/>
<meta property="og:image:width" content="1200"/>
<meta property="og:image:height" content="630"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${esc(title)}"/>
<meta name="twitter:description" content="${esc(description)}"/>
<meta name="twitter:image" content="${SITE}/og.png"/>
<meta http-equiv="refresh" content="0; url=${esc(redirectTo)}"/>
<link rel="canonical" href="${esc(redirectTo)}"/>
</head><body>
<p>Opening <a href="${esc(redirectTo)}">${esc(title)}</a>…</p>
<script>location.replace(${JSON.stringify(redirectTo)});</script>
</body></html>`;
}

const TYPE_WORD: Record<number, string> = { 0: "savings pot", 1: "commitment streak", 2: "charity appeal" };

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const address = (url.searchParams.get("a") || url.pathname.split("/").pop() || "").trim();
  const home = `${SITE}/`;

  if (!isAddress(address)) {
    return new Response(
      page("Goalpot — Cooperative Savings Ledger on Monad", "Group savings pots with DAO-gated early exit.", home),
      { headers: { "content-type": "text/html; charset=utf-8" } }
    );
  }

  try {
    const client = createPublicClient({ chain, transport: http(RPC, { batch: true }) });
    const contract = { address: address as `0x${string}`, abi: POT_ABI } as const;
    const [name, goal, deposited, penalty, members, potType] = await Promise.all([
      client.readContract({ ...contract, functionName: "name" }),
      client.readContract({ ...contract, functionName: "goal" }),
      client.readContract({ ...contract, functionName: "totalDeposited" }),
      client.readContract({ ...contract, functionName: "penaltyPool" }),
      client.readContract({ ...contract, functionName: "memberCount" }),
      client.readContract({ ...contract, functionName: "potType" }),
    ]);

    const balance = (deposited as bigint) + (penalty as bigint);
    const goalWei = goal as bigint;
    const pctFunded = goalWei > 0n ? Number((balance * 10000n) / goalWei) / 100 : 0;
    const remaining = goalWei > balance ? goalWei - balance : 0n;
    const n = Number(members);

    const title = `${name} — ${pctFunded.toFixed(0)}% funded on Goalpot`;
    const description =
      `${n} member${n === 1 ? "" : "s"} · ${fmt(balance)} MON raised · ` +
      (remaining > 0n ? `${fmt(remaining)} MON to goal` : "goal reached") +
      ` · a ${TYPE_WORD[Number(potType)] ?? "pot"} on Monad.`;

    // The SPA still owns the interactive view; send humans to the hash route.
    return new Response(page(title, description, `${SITE}/#/pot/${address}`), {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "public, max-age=60, s-maxage=60",
      },
    });
  } catch {
    return new Response(
      page("Goalpot — Cooperative Savings Ledger on Monad", "Group savings pots on Monad with DAO-gated early exit.", home),
      { headers: { "content-type": "text/html; charset=utf-8" } }
    );
  }
}
