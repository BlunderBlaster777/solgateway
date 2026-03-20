import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

dotenv.config();

const PRIVATE_KEY = process.env.PRIVATE_KEY ?? "0x" + "0".repeat(64);

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    // ── Sonic testnet ────────────────────────────────────────────────────────
    // Fill in the real RPC URL and chain ID once the Sonic testnet is live.
    // Wormhole support for Sonic must also be confirmed before going to mainnet.
    sonic: {
      url: process.env.SONIC_RPC_URL ?? "https://rpc.testnet.soniclabs.com",
      chainId: parseInt(process.env.SONIC_CHAIN_ID ?? "64165"),
      accounts: [PRIVATE_KEY],
    },
    // ── Local development (Hardhat node) ────────────────────────────────────
    localhost: {
      url: "http://127.0.0.1:8545",
    },
  },
  paths: {
    sources: "./src",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
};

export default config;
