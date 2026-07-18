# GOALPOT — Group Savings Pot with DAO Release

A coöperative savings ledger on **Monad**. Friends pool native MON toward a shared
goal. The contract — not any person — decides what happens next:

| Situation | Outcome |
| --- | --- |
| **Goal reached** | Anyone can trigger release; the whole pot goes to the beneficiary. |
| **Deadline missed** | Pot flips to *Refunding*; every member pulls back their stake (plus a pro-rata share of any penalties). |
| **Member wants out early** | Needs a **deposit-weighted majority vote** of the other members. Leaving costs a penalty (e.g. 5%) that **stays in the pot for everyone else**. |

Built for the [Spark hackathon](https://buildanything.so/hackathons/spark). The
DAO-gated early exit is the differentiator: your savings are committed, but never
hostage — the group can always vote you out humanely.

## Repository layout

```
contracts/   Solidity (GoalPot.sol) + Hardhat tests + deploy scripts
web/         React + Vite + wagmi front-end ("passbook ledger" identity)
```

Every number in the UI — progress bars, deposits, member list, vote tallies — is
read live from the contract via JSON-RPC. There are no hardcoded values; without a
deployed contract the app renders a setup notice.

## Quick start

### 1. Contracts

```bash
cd contracts
npm install
npm test                      # 16 tests over release/refund/vote paths
cp .env.example .env          # then fill it in, see table below
npm run deploy:testnet        # deploys to Monad testnet (chain id 10143)
npx hardhat verify --network monadTestnet <ADDRESS>   # Sourcify verification
```

| Variable (`contracts/.env`) | Required? | What to put there |
| --- | --- | --- |
| `PRIVATE_KEY` | **yes** | Export from a **new, throwaway wallet** (MetaMask → account details → show private key), then fund that wallet at <https://faucet.monad.xyz>. Never use a wallet holding real funds. |
| `MONAD_RPC_URL` | optional | Leave empty to use the public `https://testnet-rpc.monad.xyz`; set it only if you have your own RPC endpoint. |

For mainnet: `npm run deploy:mainnet`.

### 2. Web app

```bash
cd web
npm install
cp .env.example .env          # then fill it in, see table below
npm run dev                   # local dev
npm run build                 # static bundle in dist/ — host on Vercel/Netlify/Pages
```

| Variable (`web/.env`) | Required? | What to put there |
| --- | --- | --- |
| `VITE_GOALPOT_ADDRESS` | **yes** | Copy the address printed by `npm run deploy:testnet` (the line `GoalPot deployed at: 0x…`). |
| `VITE_MONAD_NETWORK` | optional | `testnet` (default) or `mainnet`. |
| `VITE_RPC_URL` | optional | Override the chain's public RPC — useful for a local node or a private endpoint. Leave empty otherwise. |
| `VITE_WC_PROJECT_ID` | optional | WalletConnect project id — create one free at <https://cloud.reown.com>. Enables the "connect any mobile wallet" QR/deep-link option. Without it, desktop uses the browser extension and mobile users get MetaMask/Phantom in-app-browser links. |

**Wallet support**: the Connect button opens a wallet picker — browser extension
(MetaMask, Rabby, Phantom…), WalletConnect (if `VITE_WC_PROJECT_ID` is set), and
on mobile, deep links that reopen the app inside MetaMask's or Phantom's in-app
browser. Deep links require the app to be on a public URL (they can't reach
`localhost`).

Hosting is a static SPA: on Vercel set the project root to `web/`, add the
`VITE_GOALPOT_ADDRESS` env var, done.

### Local end-to-end demo (no faucet needed)

```bash
cd contracts && npx hardhat node                                  # terminal 1
cd contracts && npx hardhat run script/seed-local.js --network localhost   # terminal 2
cd web && VITE_GOALPOT_ADDRESS=<printed address> \
  VITE_RPC_URL=http://127.0.0.1:8545 npm run dev                  # terminal 3
```

The local node mirrors Monad testnet's chain id, so the app needs no code changes.

## Contract design

`contracts/src/GoalPot.sol` — a single contract managing many pots.

- **Pot lifecycle**: `Active → Released` (goal met) or `Active → Refunding`
  (deadline passed, goal unmet). Both transitions are permissionless: anyone can
  call `release`/`startRefunds` once the conditions hold, so funds can never be
  stranded by an absent creator.
- **Joining**: pots are **open** (anyone with the link can deposit) or
  **invite-only** (creator manages an on-chain allowlist, seeded at creation and
  extendable while the pot is active). The pot page has an invite panel with a
  shareable link, native share sheet, and QR code. Invite-only matters because
  votes are deposit-weighted — it stops strangers from buying voting power in a
  friend group's pot.
- **Membership** = having deposited at least the pot's `minDeposit` (sybil floor).
  Top-ups of any size after that.
- **Early exit**: `requestExit` opens a vote (one live request per pot, bounded
  window). Other members vote with their **deposit weight**; the request passes
  when yes-weight exceeds half the weight that was eligible when it opened.
  `executeExit` pays the requester `deposit × (1 − penalty)` and parks the penalty
  in the pot's `penaltyPool`.
- **Penalty routing**: the pool counts toward the goal while the pot is live; on
  release it goes to the beneficiary; on refund it is split pro-rata among the
  members who stayed. Loyalty literally pays.

### Security posture

- **Internal accounting only** — logic never reads `address(this).balance`, so
  force-fed value (e.g. via `selfdestruct`) cannot fake goal progress. There is no
  `receive`/`fallback`; direct transfers revert.
- **Reentrancy** — a mutex on every value-moving function, plus strict
  checks-effects-interactions ordering (state zeroed before transfer).
- **Pull payments** — refunds are claimed per-member against a snapshot taken when
  refunding starts, so payout math is order-independent and one member's revert
  can't block anyone else.
- **No unbounded loops in state-changing paths** — member lists are only iterated
  in paginated view functions; a pot with thousands of members still settles in O(1)
  per claim.
- **Vote-sybil resistance** — deposit-weighted voting plus a minimum first deposit;
  packing the member list with dust wallets buys almost no voting power.
- **Bounded inputs** — name ≤ 64 bytes, penalty ≤ 20%, voting window 5 min–30 days,
  deadline must be in the future, deposits bounded to `uint96`
  (checked before casting).
- **Custom errors + events on every transition** for cheap reverts and full
  off-chain auditability.

### Known trade-offs (documented on purpose)

- Vote weight is captured at vote time and eligibility at request time; deposits
  made mid-vote don't retroactively change tallies. Acceptable for
  friendly-group scale; a production version would snapshot per-block.
- The beneficiary is fixed at creation. A malicious creator can only ever route
  *successful* pots to themselves — members can see the beneficiary before
  depositing, and a missed goal always refunds.
- If a passed exit's payout transfer reverts (contract-wallet requester), the
  request stays open until the window lapses; the requester can retry from an
  EOA-compatible wallet.

## Front-end

React 18 + Vite + wagmi/viem. Reads poll every ~6 s with request batching, no
refetch-on-focus storms — polite to the public RPC. All user input is validated
client-side (address checksums, `parseEther` bounds) *and* enforced on-chain; the
UI is a convenience, the contract is the law. The visual identity is a
**bank-passbook ledger** — archival paper, oxblood and fir ink, rubber-stamp
state badges, tabular numerals — no dark-purple gradient dashboards here.

## Operational notes

- The web app is fully static: no backend, no database, no API keys — nothing to
  inject into and nothing to rate-limit server-side. The only upstream is the
  Monad JSON-RPC endpoint (swappable via `VITE_RPC_URL`).
- Deployer key hygiene: `.env` is git-ignored; use a throwaway key for testnet.
- Contract is verified via Monad's Sourcify instance (`hardhat verify`), so the
  explorer shows readable source next to every transaction.
