# Gavel - Trustless P2P Exchange on Sui

A peer-to-peer trading platform on Sui blockchain providing trustless escrow and atomic swap primitives. Swaps are fully intermediary-free; escrows use a designated arbiter only for dispute resolution, with timelock fallback guaranteeing asset recovery.

**Track:** Sui Track

## Features

- **Escrow** - Three-party arbitrated transactions with mutual confirmation, recipient reject, dispute resolution, and timelock refund
- **Coin Swap** - Atomic coin-for-asset exchanges with `phantom CoinType` type-level enforcement and on-chain minimum price
- **Object Swap** - Atomic object-for-object exchanges with optional exact object ID targeting
- **Role-based UI** - Context-aware actions based on user role (creator, recipient, arbiter)
- **On-chain event timeline** - Full transaction history reconstructed from chain events

## Architecture

```
contracts/                    # Sui Move smart contracts
├── sources/
│   ├── escrow.move           # Escrow with arbiter dispute resolution
│   ├── swap.move             # Coin-specialized atomic swap
│   └── object_swap.move      # Object-for-object atomic swap
frontend/                     # React dApp
├── src/
│   ├── pages/                # Landing, Create, List, Detail pages
│   ├── components/           # Reusable UI components
│   ├── hooks/                # useEscrow, useSwap, useObjectSwap
│   ├── utils/                # Helper functions
│   ├── types/                # TypeScript interfaces
│   └── constants.ts          # Contract addresses & enums
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Smart Contracts | Move 2024 (Sui Framework) |
| Frontend | React 19, TypeScript 5.9, Vite 7.3 |
| Styling | Tailwind CSS 4.1 |
| Animation | Framer Motion 12 |
| Blockchain SDK | @mysten/sui 2.3, @mysten/dapp-kit-react 1.0 |
| Testing | Vitest 4.0, @testing-library/react 16.3 |
| Linting | ESLint 9, Prettier 3.5 |

## Prerequisites

- [Sui CLI](https://docs.sui.io/guides/developer/getting-started/sui-install) >= 1.65.1
- [Node.js](https://nodejs.org/) >= 20
- [pnpm](https://pnpm.io/) >= 9

## Quick Start

### 1. Clone the repository

```bash
git clone <repo-url>
cd sui_vibe_hackathon_2026
```

### 2. Build and test smart contracts

```bash
make move-build       # Build contracts
make move-test        # Run Move unit tests
```

### 3. Deploy contracts (Testnet)

```bash
# Ensure Sui CLI is configured for testnet
sui client switch --env testnet

# Publish contracts
sui client publish --gas-budget 100000000 contracts

# Note the Package ID from the output
```

### 4. Configure frontend

Update the `PACKAGE_ID` in `frontend/src/constants.ts` with your published package ID:

```typescript
export const PACKAGE_ID = "0x<your-package-id>";
```

### 5. Run frontend

```bash
cd frontend
pnpm install
pnpm dev              # Start dev server at http://localhost:5173
```

### 6. Production build

```bash
make fe-build         # Output in frontend/dist/
```

Deploy the `frontend/dist/` directory to any static hosting service (Vercel, Netlify, etc.).

## Smart Contracts

All contracts are written in **Move 2024** syntax and deployed on **Sui Testnet**.

### Escrow (`gavel::escrow`)

Single-direction asset escrow with three-party arbitration. `Escrow<T: key + store>` supports any asset type.

- **Parties:** Creator (depositor), Recipient (beneficiary), Arbiter (dispute resolver)
- **Flow:** Active → Released / Refunded / Disputed → Destroyed
- **Mutual Confirm:** Creator and Recipient both confirm → auto-release asset to Recipient
- **Recipient Reject:** Recipient voluntarily declines → asset refunded to Creator
- **Dispute:** Either party (who hasn't confirmed) raises dispute → Arbiter resolves: release to Recipient or refund to Creator
- **Dispute Timeout Fallback:** If Arbiter is unreachable, Creator can reclaim after `DISPUTE_TIMEOUT_MS` (30 days)
- **Timelock Refund:** Creator reclaims asset after `timeout_ms` if no confirmation
- **Confirm-then-Dispute Prevention:** A party who has confirmed cannot dispute

### Coin Swap (`gavel::swap`)

Atomic coin-for-asset exchange. `Swap<T: key + store, phantom CoinType>` encodes both the deposited asset type and the expected payment coin at the type level.

- **Flow:** Pending → Executed / Cancelled → Destroyed
- **Atomic Execution:** Recipient's payment and asset receipt happen in one transaction — no "locked but unexecuted" limbo
- **On-chain Price:** `requested_amount` enforces minimum price on-chain; overpayment is accepted (full amount goes to Creator)
- **Timeout Race:** `execute_swap` has no clock check — consensus ordering decides the race between execute and cancel

### Object Swap (`gavel::object_swap`)

Atomic object-for-object exchange. `ObjectSwap<T: key + store, phantom U: key + store>` encodes both sides' object types at the type level.

- **Flow:** Pending → Executed / Cancelled → Destroyed
- **Exact Match:** Optional `requested_object_id` enforces the Recipient must provide a specific object
- **Open Match:** When `requested_object_id` is None, any object of type U satisfies the swap
- **Timeout Race:** Same consensus-ordering semantics as Coin Swap

### Deployed Addresses (Testnet)

| Item | Value |
|------|-------|
| Package ID | `0xf03f9338e341f9d3c58fdfeebc7c808c3dce7ce7f2b01a87dc7d3021b9a0967e` |
| Network | Sui Testnet (Chain ID: 4c78adac) |
| Explorer | [View on Suiscan](https://suiscan.xyz/testnet/object/0xf03f9338e341f9d3c58fdfeebc7c808c3dce7ce7f2b01a87dc7d3021b9a0967e) |

## Available Commands

```bash
# Contracts
make move-build           # Build Move contracts
make move-test            # Run Move tests
make move-check           # Lint contracts
make move-publish-dry     # Dry-run publish

# Frontend
make fe-dev               # Dev server with HMR
make fe-build             # Production build
make fe-test              # Run frontend tests
make fe-coverage          # Test coverage report
make fe-lint              # ESLint check
make fe-fmt               # Format code with Prettier

# CI
make ci                   # Minimal output, fast failure
make verify               # Full test suite + lint + SLOC check
```

## Usage

### Connect Wallet

1. Open the Gavel website
2. Click **"Connect Wallet"** in the top-right corner
3. Select your wallet (Sui Wallet, Suiet, etc.) and approve the connection

> You need Testnet SUI for gas fees. Get test tokens from the [Sui Faucet](https://faucet.testnet.sui.io/) or your wallet's built-in faucet.

### Escrow (Arbitrated Transaction)

A three-party mechanism involving a **Creator**, **Recipient**, and **Arbiter**.

1. **Create** - Creator deposits an asset, specifies recipient, arbiter, description, and timeout
2. **Confirm** - Both parties confirm to auto-release the asset to recipient
3. **Reject** - Recipient voluntarily declines, asset refunded to creator
4. **Dispute** - Either party (who hasn't confirmed) raises a dispute
5. **Resolve** - Arbiter decides: release to recipient or refund to creator
6. **Timelock Refund** - Creator reclaims the asset after timeout (or after dispute timeout if arbiter is unreachable)

```
Creator deposits asset
        │
   ┌────▼────┐
   │  Active  │──── Both Confirm ────────→ Released (to Recipient)
   │         │──── Recipient Reject ────→ Refunded (to Creator)
   │         │──── Creator Timelock ────→ Refunded (to Creator)
   └────┬────┘
        │ Dispute
   ┌────▼─────┐
   │ Disputed  │──── Arbiter Resolve ───→ Released or Refunded
   │          │──── Dispute Timeout ───→ Refunded (to Creator)
   └──────────┘
```

### Swap (Atomic Exchange)

A trustless two-party exchange — no arbiter needed.

**Coin Swap:**
1. **Create** - Creator deposits an asset, sets the requested coin type and amount
2. **Execute** - Recipient pays the requested amount; both assets swap atomically
3. **Cancel** - Creator reclaims the asset after timeout if not executed

**Object Swap:**
1. **Create** - Creator deposits an object (e.g. NFT), optionally specifies a target object ID
2. **Execute** - Recipient provides a matching object; both swap atomically
3. **Cancel** - Creator reclaims after timeout

```
Creator deposits asset
        │
   ┌────▼─────┐
   │  Pending  │──── Recipient Execute ───→ Executed (both sides swap)
   └────┬─────┘
        │ Timeout + Cancel
        ▼
    Cancelled (asset returned to Creator)
```

> For a detailed walkthrough with screenshots, see [docs/usage_guide.md](docs/usage_guide.md).

## Future Roadmap

- **Mainnet Deployment** - Migrate contracts and frontend to Sui Mainnet
- **Multi-Asset Escrow** - Support depositing multiple assets in a single escrow
- **Batch Swap** - Bundle multiple assets into one atomic swap transaction
- **Public Swap Marketplace** - Discoverable open swap offers anyone can fulfill (not just designated recipients)
- **On-chain Reputation** - Track arbiter resolution history and success rates as verifiable on-chain credentials
- **Mobile Support** - Responsive PWA with mobile wallet deep-linking
- **Notification System** - On-chain event subscriptions with email/push alerts for pending actions

## AI Tool Disclosure

This project was developed with assistance from the following AI tools:

- **Claude Code** (Anthropic): Used for code generation, architecture design, debugging, and documentation
- **Cursor IDE**: AI-powered code editor with inline completions and chat assistance

## License

This project is open source. See [LICENSE](LICENSE) for details.

## Acknowledgments

Built with ❤️ for Vibe Sui Spring Fest 2026