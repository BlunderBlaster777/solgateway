/**
 * config.ts – Centralised configuration for both the scripts and the frontend.
 *
 * Fill in the placeholder values once you have deployed the contracts/program
 * and confirmed Wormhole support for the Sonic testnet.
 */

// ── Sonic (EVM) ───────────────────────────────────────────────────────────────
export const SONIC_CONFIG = {
  /** Sonic testnet RPC endpoint. Replace with the real URL. */
  rpcUrl: process.env.SONIC_RPC_URL ?? "https://rpc.testnet.soniclabs.com",

  /** Sonic testnet chain ID (EIP-155). */
  chainId: parseInt(process.env.SONIC_CHAIN_ID ?? "64165"),

  /** Deployed TestToken contract address. Fill in after `hardhat deploy`. */
  testTokenAddress: process.env.TEST_TOKEN_ADDRESS ?? "0x0000000000000000000000000000000000000000",

  /** Deployed BridgeSonic contract address. Fill in after `hardhat deploy`. */
  bridgeSonicAddress: process.env.BRIDGE_SONIC_ADDRESS ?? "0x0000000000000000000000000000000000000000",
};

// ── Solana ────────────────────────────────────────────────────────────────────
export const SOLANA_CONFIG = {
  /** Solana devnet RPC URL. */
  rpcUrl: process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com",

  /**
   * Deployed bridge_solana program ID.
   * Replace with the real program ID after `anchor deploy`.
   */
  programId: process.env.BRIDGE_SOLANA_PROGRAM_ID ?? "BRDGso1ANAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",

  /** WrappedTestToken SPL mint address (derived PDA; populated after deploy). */
  wrappedMintAddress: process.env.WRAPPED_MINT_ADDRESS ?? "",
};

// ── Wormhole ──────────────────────────────────────────────────────────────────
export const WORMHOLE_CONFIG = {
  /** Wormhole Guardiand REST API for fetching VAAs. */
  restApi: "https://api.testnet.wormhole.com",

  evm: {
    /**
     * Wormhole Core Bridge address on the Sonic / EVM chain.
     *
     * NOTE: Sonic is not yet officially listed in Wormhole's testnet.
     * Use the address for an EVM testnet that Wormhole supports (e.g., Ethereum Sepolia)
     * during development, and replace this with the real Sonic address once available.
     *
     * Ethereum Sepolia Core Bridge (example): 0x4a8bc80Ed5a4067f1CCf107057b8270E0cC11A78
     */
    coreBridgeAddress: process.env.WORMHOLE_CORE_BRIDGE_EVM ?? "0x4a8bc80Ed5a4067f1CCf107057b8270E0cC11A78",

    /**
     * Wormhole chain id assigned to the Sonic / EVM chain.
     * Use the correct chain id from https://docs.wormhole.com/wormhole/reference/constants
     * For Ethereum Sepolia (placeholder): 10002
     */
    wormholeChainId: parseInt(process.env.WORMHOLE_EVM_CHAIN_ID ?? "10002"),
  },

  solana: {
    /**
     * Wormhole Core Bridge program id on Solana devnet.
     * Source: https://docs.wormhole.com/wormhole/reference/constants
     */
    coreBridgeProgramId: "3u8hJUVTA4jH1wYAyUur7FFZVQ8H635K3tSHHF4ssjQ5",

    /** Wormhole chain id for Solana (always 1). */
    wormholeChainId: 1,

    /**
     * Wormhole emitter address of the deployed bridge_solana program (bytes32).
     * Computed as: sha256("wormhole_emitter" || program_id) or the PDA directly.
     * Fill in after `anchor deploy` and deriving the emitter PDA.
     */
    bridgeProgramEmitter: process.env.BRIDGE_SOLANA_EMITTER
      ? Buffer.from(process.env.BRIDGE_SOLANA_EMITTER, "hex")
      : Buffer.alloc(32),
  },
};
