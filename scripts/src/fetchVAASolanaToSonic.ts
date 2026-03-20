/**
 * fetchVAASolanaToSonic.ts
 *
 * Relay script: Solana → Sonic
 *
 * Usage:
 *   EMITTER=<base58_emitter_pubkey> SEQUENCE=<number> \
 *   PRIVATE_KEY=<hex_evm_private_key> \
 *   ts-node src/fetchVAASolanaToSonic.ts
 *
 * What this script does:
 *  1. Fetches the signed VAA from the Wormhole Guardian API.
 *  2. Calls BridgeSonic.receiveFromSolana(encodedVAA) on Sonic.
 */

import axios from "axios";
import { ethers } from "ethers";
import { WORMHOLE_CONFIG, SONIC_CONFIG } from "./config";

// Minimal ABI for BridgeSonic.receiveFromSolana
const BRIDGE_SONIC_ABI = [
  "function receiveFromSolana(bytes calldata encodedVAA) external",
];

async function main() {
  // ── Load inputs from env ─────────────────────────────────────────────────
  const emitter    = process.env.EMITTER    ?? "";
  const sequence   = process.env.SEQUENCE   ?? "0";
  const privateKey = process.env.PRIVATE_KEY ?? "";

  if (!emitter) {
    console.error("Set EMITTER=<base58_solana_emitter_pubkey>");
    process.exit(1);
  }
  if (!privateKey) {
    console.error("Set PRIVATE_KEY=<hex_evm_private_key>");
    process.exit(1);
  }

  console.log(`Fetching VAA for Solana emitter=${emitter} sequence=${sequence}…`);

  // ── 1. Encode Solana emitter as hex (base58 → bytes → hex) ───────────────
  const bs58 = await import("bs58");
  const emitterBytes  = bs58.default.decode(emitter);
  const emitterHex    = Buffer.from(emitterBytes).toString("hex").padStart(64, "0");

  const vaaUrl = `${WORMHOLE_CONFIG.restApi}/v1/signed_vaa/${WORMHOLE_CONFIG.solana.wormholeChainId}/${emitterHex}/${sequence}`;
  const response = await axios.get<{ vaaBytes: string }>(vaaUrl);
  const vaaBase64 = response.data.vaaBytes;
  const vaaHex    = "0x" + Buffer.from(vaaBase64, "base64").toString("hex");

  console.log(`VAA fetched (${vaaHex.length / 2 - 1} bytes).`);

  // ── 2. Connect to Sonic (EVM) ────────────────────────────────────────────
  const provider = new ethers.JsonRpcProvider(SONIC_CONFIG.rpcUrl);
  const signer   = new ethers.Wallet(privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`, provider);

  const bridge = new ethers.Contract(
    SONIC_CONFIG.bridgeSonicAddress,
    BRIDGE_SONIC_ABI,
    signer
  );

  // ── 3. Submit VAA to BridgeSonic.receiveFromSolana ───────────────────────
  console.log("Submitting VAA to BridgeSonic.receiveFromSolana…");
  const tx = await bridge.receiveFromSolana(vaaHex);
  const receipt = await tx.wait();

  console.log("✅ receiveFromSolana tx:", receipt.hash);
  console.log("   Block:", receipt.blockNumber);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
