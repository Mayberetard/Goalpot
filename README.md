# GOALPOT — Group Savings Pots with DAO Release

![CI](https://github.com/Mayberetard/Goalpot/actions/workflows/ci.yml/badge.svg)

A coöperative savings ledger on **Monad**. Friends pool native MON toward a shared
goal, and the contract — not any person — decides what happens next:

| Situation | Outcome |
| --- | --- |
| **Goal reached** | The pot is released; the beneficiary claims it (minus the protocol fee). |
| **Deadline missed** | Pot flips to *Refunding*; every member pulls back their stake plus a share of any penalties. |
| **Member wants out early** | Needs a **deposit-weighted majority vote** of the other members. Leaving costs a penalty that **stays in the pot for everyone else**. |

Three pot types share that machinery: **Standard** (fund a shared thing),
**Streak** (commit to a deposit cadence — miss one and you forfeit to the members
who kept up), and **Charity** (crowdfund a named cause; donations are
irrevocable and refunded in full if the goal is missed).

## Live

| | |
| --- | --- |
| **App** | <https://goalpot-pi.vercel.app/> |
| **Factory (Monad testnet)** | _redeploy pending — see “Upgrading from v1” below_ |
| **v1 pot contract (legacy)** | [`0xE154E77956466e102F8fa1AF63046fC85A82C661`](https://testnet.monadexplorer.com/address/0xE154E77956466e102F8fa1AF63046fC85A82C661) |

To try it: get testnet MON from <https://faucet.monad.xyz>, open the app, connect
a wallet, and start or join a pot. Every number on screen is a live read from the
chain.

## Architecture

```
                       ┌──────────────────────┐
   user ── createXPot ▶│   GoalPotFactory     │  Ownable · treasury · feeBps (≤2%)
                       │  registry of pots    │  swappable implementations
                       └──────────┬───────────┘
                        EIP-1167  │ clone (≈45 bytes of proxy each)
             ┌────────────────────┼────────────────────┐
             ▼                    ▼                    ▼
      ┌─────────────┐      ┌─────────────┐      ┌─────────────┐
      │ StandardPot │      │  StreakPot  │      │ CharityPot  │   ← implementations
      └──────┬──────┘      └──────┬──────┘      └──────┬──────┘     (deployed once)
             └────────────────────┼────────────────────┘
                                  ▼
                        ┌───────────────────┐
                        │ GoalPot (abstract)│  deposits · membership · invites
                        │  shared machinery │  exit votes (quorum, abstain,
                        └───────────────────┘  delegation) · release · refunds
                                  │
                        reads feeInfo() ──▶ factory, at release time
```

**One pot = one contract.** A bug, a hostile beneficiary, or a stuck vote is
contained to a single pot instead of every pot ever created — and new pot types
ship as new implementations without touching pots already in flight. Clones cost
a fraction of a full deployment because they hold only proxy bytecode.

The factory owner can point at new implementations (future pots only — existing
clones are immutable) and tune the fee within the hard 2% cap. Neither power can
touch funds in an existing pot.

### Repository layout

```
contracts/
  src/GoalPot.sol          abstract base — all shared pot machinery
  src/StandardPot.sol      the original behaviour
  src/StreakPot.sol        fixed-cadence commitment savings
  src/CharityPot.sol       donation appeals
  src/GoalPotFactory.sol   clone factory, registry, protocol fee
  src/legacy/GoalPotV1.sol the deployed v1 monolith, kept for reference
web/
  src/                     React + Vite + wagmi front-end
  api/s.ts                 edge function: per-pot link previews (the only server)
```

## Quick start

### 1. Contracts

```bash
cd contracts
npm install
npm test                      # 70 tests across all pot types
cp .env.example .env          # then fill it in, see table below
npm run deploy:testnet        # deploys 3 implementations + the factory
```

| Variable (`contracts/.env`) | Required? | What to put there |
| --- | --- | --- |
| `PRIVATE_KEY` | **yes** | Export from a **new, throwaway wallet**, then fund it at <https://faucet.monad.xyz>. Never use a wallet holding real funds. |
| `MONAD_RPC_URL` | optional | Leave empty to use the public `https://testnet-rpc.monad.xyz`. |
| `TREASURY` | optional | Protocol fee recipient. Defaults to the deployer. |
| `FEE_BPS` | optional | Protocol fee in basis points, max 200. Defaults to 50 (0.5%). |

Verify all four contracts on Sourcify with the `hardhat verify` commands the
deploy script prints. For mainnet: `npm run deploy:mainnet`.

### 2. Web app

```bash
cd web
npm install
cp .env.example .env          # then fill it in, see table below
npm run dev
npm run build                 # static bundle in dist/
```

| Variable (`web/.env`) | Required? | What to put there |
| --- | --- | --- |
| `VITE_FACTORY_ADDRESS` | **yes** | The `GoalPotFactory:` address printed by `npm run deploy:testnet`. |
| `VITE_MONAD_NETWORK` | optional | `testnet` (default) or `mainnet`. |
| `VITE_RPC_URL` | optional | Override the chain's public RPC (local node, private endpoint). |
| `VITE_WC_PROJECT_ID` | optional | WalletConnect project id from <https://cloud.reown.com> — enables mobile wallets. |
| `VITE_ENS_RPC_URL` | optional | Ethereum mainnet RPC for ENS reverse lookups. Falls back to a public endpoint; failures degrade silently to `0x1234…abcd`. |
| `VITE_SITE_URL` | optional | Canonical site URL used in link-preview tags. |

On Vercel: project root `web/`, add `VITE_FACTORY_ADDRESS`, deploy.

### Local end-to-end demo (no faucet needed)

```bash
cd contracts && npx hardhat node                                          # terminal 1
cd contracts && npx hardhat run script/seed-local.js --network localhost  # terminal 2
cd web && VITE_FACTORY_ADDRESS=<printed factory> \
  VITE_RPC_URL=http://127.0.0.1:8545 npm run dev                          # terminal 3
```

The seed creates one pot of each type, including a live exit vote, a streak with
one member on track and one who missed a week, and a charity appeal with donor
messages.

### Upgrading from v1

v2 is a new deployment, not an upgrade: pots created by the v1 contract stay
where they are and keep working, but the app now talks to the factory. Deploy
the v2 stack, set `VITE_FACTORY_ADDRESS`, and redeploy the front-end.

## Pot types

### Standard — fund a shared thing

Everyone deposits toward one goal. Reaching it releases the pot to the
beneficiary named at creation (a trip organiser, a landlord, whoever is paying).
Members do **not** get their deposits back on success — success means the thing
got funded. Missing the deadline refunds everyone.

*Example:* five friends save 10 MON for a flat deposit. They hit it in month
four; the letting agent's address claims 9.95 MON (10 minus the 0.5% fee).

### Streak — commitment savings

Members deposit once per interval for a fixed number of intervals. Interval 0 is
the joining deposit, so nobody can join a streak already running. Miss an
interval and a configurable share of your stake (default 10%) is forfeited into
a reward pool; anyone can call `assessMisses(member)` to charge a member who
simply stopped showing up, so slacking can't hide.

At settlement the pool is split **in proportion to intervals met** — paid out
via `claimStreakReward()` after a successful release, or folded into the refund
if the goal is missed.

*Example:* four people commit 0.25 MON weekly for 12 weeks. One misses two
weeks and forfeits ~0.05 MON; the other three collect it in proportion to their
attendance.

### Charity — donation appeals

A named cause with an optional IPFS hash of registration documents. Donations
are **irrevocable** — `requestExit` reverts — so the only outcomes are the goal
being met (the charity claims the funds) or missed (every donor is refunded in
full). Donors can attach a public 140-character message; those live in the event
log and render as the donor wall. `CharityReleased` is emitted alongside the
normal release for transparency dashboards.

## Protocol fee

A fee is taken **only when a pot succeeds**:

- Default **0.5%** (50 bps), hard-capped at **2%** in the contract — `setFee`
  reverts above the cap, so no owner key can ever raise it further.
- Charged in `release()`, deducted from the released amount before the
  beneficiary is credited, and routed to the factory's treasury as a pull
  payment.
- **Never** charged on refunds, early exits, or streak forfeits. A pot that
  fails costs its members nothing.
- Read live from the factory at release time, so a fee change applies to pots
  that settle afterwards — and can never exceed the cap.

## Voting rules

Exit votes are weighted by deposit (a sybil with dust buys almost nothing) and
have three outcomes:

1. **Sole member** — zero eligible weight passes outright; there's nobody to ask.
2. **Absolute majority** — yes-weight > 50% of eligible weight executes
   immediately, without waiting for the window to close.
3. **After the window closes** — needs **25% quorum** (any choice, including
   abstain) *and* more yes than no. Without quorum the request fails and can be
   displaced by a new one.

**Abstain** is tracked separately and counts toward quorum without supporting the
exit. **Delegation** is one level deep: you may hand your weight to another
member, but they must not have delegated theirs away, and you can't delegate
while holding delegated weight — so no chains and no cycles. Delegation clears
automatically when a member exits or refunds.

## Security posture

- **Internal accounting only** — logic never reads `address(this).balance`, so
  force-fed value cannot fake goal progress. No `receive`/`fallback`.
- **Pull payments everywhere** — refunds, beneficiary payouts, protocol fees and
  streak rewards are all claimed, never pushed. No recipient can freeze
  settlement for anyone else.
- **Reentrancy** — a mutex on every value-moving function plus strict
  checks-effects-interactions ordering.
- **Bounded loops** — the only loops are invite lists (≤100 per call), streak
  interval assessment (≤52, fixed at creation), and paginated view functions.
- **Clone isolation** — one pot's failure state cannot touch another's funds.
- **Implementations are inert** — `_disableInitializers()` in the constructor
  means an implementation can never be initialized or hold funds directly.
- **Bounded inputs** — name ≤64 bytes, penalty ≤20%, fee ≤2%, voting window
  5 min–30 days, deposits bounded to `uint96` (checked before casting).
- **Custom errors + events on every transition** for cheap reverts and full
  off-chain auditability.

### Known trade-offs (documented on purpose)

- Vote weight is read at vote time and eligibility at request time; deposits made
  mid-vote don't retroactively change tallies. Fine at friend-group scale; a
  production version would snapshot per block.
- The beneficiary is fixed at creation. A malicious creator can only route
  *successful* pots to themselves — members see the beneficiary before
  depositing, and a missed goal always refunds.
- Streak misses are assessed lazily. A member who never returns is only charged
  once someone calls `assessMisses`; the UI does this implicitly on the next
  deposit, and settlement figures are correct either way.
- The leaderboard is compiled in the browser from event logs. Honest but slow
  once there are hundreds of pots — the shape (fetch → aggregate → render) is
  built so a real indexer can replace `useAggregates` with an API call.
- Dependency advisories in the WalletConnect stack (`axios`, `ws`) are known and
  tracked; the upstream fix needs a breaking wagmi v3 upgrade.

## Front-end

React 18 + Vite + wagmi/viem. Reads poll every ~6 s with request batching and no
refetch-on-focus storms. All user input is validated client-side *and* enforced
on-chain; the UI is a convenience, the contract is the law.

- **Pot types get their own UI**: a streak calendar with a 🔥 counter, a donor
  wall with a downloadable donation summary, an updates board on every pot.
- **Templates** pre-fill common configurations (wedding fund, group trip, house
  deposit, clean-water appeal, 30-day fitness challenge) — every field stays
  editable.
- **ENS names** resolve through an Ethereum mainnet client (names don't live on
  Monad), cached, with a silent fallback to shortened addresses.
- **Invite links are opaque** (`/#/p/9f3ac81d2e40`), so pots can't be enumerated
  by counting. The real access gate on invite-only pots is the on-chain
  allowlist.
- **Link previews**: `/s/<address>` is an edge function that serves per-pot Open
  Graph tags (live funding percentage, member count) then redirects into the SPA
  — hash routes can't carry crawler-visible metadata. Offered only for open
  pots, since it exposes the address. This is the single server-side piece; the
  app is otherwise fully static.
- **Dark mode**, responsive down to 375 px, and the passbook identity throughout:
  archival paper, oxblood and fir ink, rubber-stamp state badges, tabular
  numerals.

## Operational notes

- No database, no API keys, no session state — nothing to inject into and
  nothing to rate-limit server-side. The only upstreams are the Monad JSON-RPC
  endpoint and (optionally) an ENS RPC.
- Deployer key hygiene: `.env` is git-ignored; use a throwaway key for testnet.
- CI runs the contract suite and the web build on every pull request.
