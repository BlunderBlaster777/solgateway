# SolGateway — Sonic ↔ Solana Token Bridge

A minimal cross‑chain token bridge prototype between **Sonic testnet** (EVM-compatible) and **Solana devnet**, using **Wormhole** as the cross‑chain messaging layer.

---

## Architecture

```
┌─────────────────────────────────────┐        ┌────────────────────────────────────────┐
│           Sonic Testnet (EVM)        │        │           Solana Devnet                 │
│                                     │        │                                        │
│  TestToken (TST ERC-20)             │        │  WrappedTestToken (wTST, SPL token)    │
│  BridgeSonic.sol                    │        │  bridge_solana (Anchor program)         │
│   └─ lockAndSend()   ─────────────────────►  │   └─ process_from_sonic()              │
│   └─ receiveFromSolana()  ◄─────────────────  │   └─ burn_and_send_back()             │
│                                     │  VAA   │                                        │
└─────────────────────────────────────┘        └────────────────────────────────────────┘
                                   Wormhole Guardians
```

### Sonic → Solana flow
1. User approves `BridgeSonic` to spend their `TST`.
2. `BridgeSonic.lockAndSend()` transfers tokens to itself and publishes a Wormhole message with `action=1 | recipient | amount`.
3. Wormhole Guardians sign the VAA.
4. The relay script fetches the VAA from the Wormhole API and calls `bridge_solana.process_from_sonic()`.
5. The Solana program verifies the VAA and mints `wTST` to the recipient.

### Solana → Sonic flow
1. User calls `bridge_solana.burn_and_send_back()` which burns `wTST` and publishes a Wormhole message with `action=2 | recipient_evm | amount`.
2. Wormhole Guardians sign the VAA.
3. The relay script fetches the VAA and calls `BridgeSonic.receiveFromSolana()`.
4. `BridgeSonic` verifies the VAA and releases `TST` to the recipient.

---

## Repository structure

```
solgateway/
├── contracts/                  # Hardhat project (Solidity)
│   ├── src/
│   │   ├── TestToken.sol       # ERC-20 test token (TST)
│   │   ├── IWormhole.sol       # Minimal Wormhole core bridge interface
│   │   └── BridgeSonic.sol     # Lock/unlock bridge contract
│   ├── scripts/deploy.ts       # Hardhat deployment script
│   ├── test/BridgeSonic.test.ts
│   └── hardhat.config.ts
│
├── solana/                     # Anchor project (Rust)
│   ├── programs/bridge_solana/src/lib.rs   # Anchor program
│   └── Anchor.toml
│
├── frontend/                   # Vite + React + TypeScript
│   └── src/
│       ├── App.tsx
│       ├── config/index.ts     # ⚠ Fill in contract addresses here
│       └── components/
│           ├── SonicToSolanaBridge.tsx
│           └── SolanaToSonicBridge.tsx
│
├── scripts/                    # Node.js VAA relay scripts
│   └── src/
│       ├── config.ts           # ⚠ Fill in addresses / RPC URLs here
│       ├── fetchVAASonicToSolana.ts
│       └── fetchVAASolanaToSonic.ts
│
└── README.md
```

---

## Prerequisites

| Tool | Version |
|------|---------|
| Node.js | ≥ 20 |
| Yarn / npm | any recent |
| Rust + Cargo | stable |
| Solana CLI | ≥ 1.18 |
| Anchor CLI | 0.30.1 |
| MetaMask | any |
| Phantom Wallet | any (Solana devnet) |

---

## Step 1 — Configuration

All network and contract addresses are stored in two files.  
Fill these in **before** deploying:

| File | Purpose |
|------|---------|
| `scripts/src/config.ts` | Used by relay scripts and the Hardhat deploy script |
| `frontend/src/config/index.ts` | Used by the React frontend (read via `VITE_*` env vars) |

### Wormhole note on Sonic

Sonic is not yet officially listed in Wormhole's testnet. During development you can:
- Point the EVM contracts at any Wormhole-supported EVM testnet (e.g., **Ethereum Sepolia**, `chainId=10002`).
- Once Sonic is listed, update `WORMHOLE_EVM_CHAIN_ID` and `WORMHOLE_CORE_BRIDGE_EVM` in `config.ts`.

---

## Step 2 — Deploy Solidity contracts

```bash
cd contracts
npm install
```

Create a `.env` file:

```env
PRIVATE_KEY=0x<your_evm_private_key>
SONIC_RPC_URL=https://rpc.testnet.soniclabs.com
SONIC_CHAIN_ID=64165
WORMHOLE_CORE_BRIDGE_EVM=0x4a8bc80Ed5a4067f1CCf107057b8270E0cC11A78   # Sepolia placeholder
WORMHOLE_EVM_CHAIN_ID=10002
```

```bash
npm run compile
npm run deploy:sonic
```

Note the printed **TestToken** and **BridgeSonic** addresses.  
Update `scripts/src/config.ts` and `frontend/src/config/index.ts` (or set env vars).

### Run unit tests

```bash
npm test
```

---

## Step 3 — Deploy Solana program

```bash
cd solana
# Make sure you have a devnet keypair funded with SOL
solana config set --url devnet
solana airdrop 2

anchor build
anchor deploy
```

After deployment, Anchor prints the **program ID**.  
Replace the placeholder in:
- `solana/Anchor.toml` → `bridge_solana = "..."`
- `solana/programs/bridge_solana/src/lib.rs` → `declare_id!("...")`
- `scripts/src/config.ts` → `SOLANA_CONFIG.programId`
- `frontend/src/config/index.ts` → `SOLANA_CONFIG.programId`

### Initialize the bridge

Run from a client script or Anchor test:

```typescript
await program.methods
  .initializeBridge(
    sonicWormholeChainId,           // e.g., 10002
    Array.from(sonicEmitterBytes)   // bytes32 from BridgeSonic.sol address
  )
  .accounts({ ... })
  .rpc();
```

Note the **WrappedTestToken mint address** (the `wrapped_mint` PDA) and update `VITE_WRAPPED_MINT_ADDRESS`.

### Copy the IDL to the frontend

The Solana frontend component loads the Anchor IDL at runtime from `/bridge_solana.json`.

```bash
cp solana/target/idl/bridge_solana.json frontend/public/bridge_solana.json
```

---

## Step 4 — Run the frontend

```bash
cd frontend
npm install
```

Create a `.env` file:

```env
VITE_SONIC_RPC_URL=https://rpc.testnet.soniclabs.com
VITE_SONIC_CHAIN_ID=64165
VITE_TEST_TOKEN_ADDRESS=0x<deployed_test_token>
VITE_BRIDGE_SONIC_ADDRESS=0x<deployed_bridge_sonic>
VITE_BRIDGE_SOLANA_PROGRAM=<deployed_program_id>
VITE_WRAPPED_MINT_ADDRESS=<wrapped_mint_pda>
```

```bash
npm run dev
```

Open `http://localhost:5173`.

---

## Step 5 — Install relay scripts

```bash
cd scripts
npm install
```

---

## Step 6 — Bridge: Sonic → Solana

### Using the UI
1. Open the frontend.
2. Click **Connect EVM Wallet** and switch to the Sonic testnet.
3. Enter the amount of TST and your Solana recipient pubkey.
4. Click **Bridge to Solana →**.
5. Follow the relay instructions shown on screen.

### Using the relay script directly

After the `lockAndSend` transaction is confirmed, run:

```bash
cd scripts
EMITTER=0x<BridgeSonic_address> \
SEQUENCE=<wormhole_sequence_from_tx_log> \
RECIPIENT=<solana_recipient_pubkey> \
SOLANA_KEYPAIR=~/.config/solana/id.json \
ts-node src/fetchVAASonicToSolana.ts
```

The script:
1. Fetches the signed VAA from `https://api.testnet.wormhole.com`.
2. Calls `bridge_solana.process_from_sonic` on Solana devnet.
3. The program mints `wTST` to the recipient's associated token account.

---

## Step 7 — Bridge: Solana → Sonic

### Using the UI
1. Connect Phantom wallet (devnet).
2. Enter the amount of wTST and your EVM recipient address.
3. Click **Bridge back to Sonic →**.
4. Follow the relay instructions shown on screen (sequence number is in Solana Explorer logs).

### Using the relay script directly

```bash
cd scripts
EMITTER=<solana_emitter_pubkey> \
SEQUENCE=<wormhole_sequence> \
PRIVATE_KEY=<evm_private_key_hex> \
ts-node src/fetchVAASolanaToSonic.ts
```

The script:
1. Fetches the signed VAA from the Wormhole API.
2. Calls `BridgeSonic.receiveFromSolana(encodedVAA)` on Sonic.
3. The contract verifies the VAA and releases TST to the EVM recipient.

---

## Security notes

This is a **prototype** intended for testnet use.

- No access control on `process_from_sonic` (anyone can relay a valid VAA).
- No fee handling beyond the Wormhole message fee.
- Amount handling assumes values fit in `u64`; no overflow checks.
- Private keys should **never** be committed; always use `.env` files.

---

## License

MIT
