/**
 * config/index.ts
 *
 * Single source of truth for network / contract configuration.
 * Vite exposes VITE_* env vars to the browser via import.meta.env.
 */

// ── Sonic (EVM) ────────────────────────────────────────────────────────────
export const SONIC_CONFIG = {
  rpcUrl:   import.meta.env.VITE_SONIC_RPC_URL    ?? "https://rpc.testnet.soniclabs.com",
  chainId:  parseInt(import.meta.env.VITE_SONIC_CHAIN_ID ?? "64165"),
  chainName: "Sonic Testnet",

  /** Deployed TestToken address – fill in after contract deployment. */
  testTokenAddress:  import.meta.env.VITE_TEST_TOKEN_ADDRESS  ?? "0x0000000000000000000000000000000000000000",

  /** Deployed BridgeSonic address – fill in after contract deployment. */
  bridgeSonicAddress: import.meta.env.VITE_BRIDGE_SONIC_ADDRESS ?? "0x0000000000000000000000000000000000000000",
};

// ── Solana ─────────────────────────────────────────────────────────────────
export const SOLANA_CONFIG = {
  rpcUrl:    import.meta.env.VITE_SOLANA_RPC_URL        ?? "https://api.devnet.solana.com",
  programId: import.meta.env.VITE_BRIDGE_SOLANA_PROGRAM ?? "BRDGso1ANAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",

  /** Derived WrappedTestToken mint PDA – fill in after anchor deploy. */
  wrappedMintAddress: import.meta.env.VITE_WRAPPED_MINT_ADDRESS ?? "",
};

// ── Wormhole ────────────────────────────────────────────────────────────────
export const WORMHOLE_CONFIG = {
  restApi: "https://api.testnet.wormhole.com",
};

// ── ABIs (minimal) ──────────────────────────────────────────────────────────
export const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

export const BRIDGE_SONIC_ABI = [
  "function lockAndSend(bytes32 recipientSolana, uint256 amount, uint32 nonce) payable returns (uint64 sequence)",
  "function receiveFromSolana(bytes calldata encodedVAA) external",
  "function messageFee() view returns (uint256)",
  "event TokensLocked(address indexed sender, bytes32 indexed recipientSolana, uint256 amount, uint64 wormholeSequence)",
];
