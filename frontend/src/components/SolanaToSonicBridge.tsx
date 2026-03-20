/**
 * SolanaToSonicBridge.tsx
 *
 * Flow:
 *  1. Connect Solana wallet (Phantom).
 *  2. Show WrappedTestToken (wTST) balance.
 *  3. User enters amount and EVM recipient address.
 *  4. Call bridge_solana.burn_and_send_back instruction.
 *  5. Display tx hash.
 *  6. Show relay instructions.
 */

import React, { useState, useEffect, useCallback } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, SYSVAR_CLOCK_PUBKEY } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import * as anchor from "@coral-xyz/anchor";
import { SOLANA_CONFIG, WORMHOLE_CONFIG } from "../config";

const BRIDGE_STATE_SEED    = Buffer.from("bridge_state");
const MINT_SEED            = Buffer.from("wrapped_mint");
const WORMHOLE_EMITTER_SEED = Buffer.from("emitter");

type Status = { type: "idle" | "pending" | "ok" | "error"; message?: string };

function shortAddress(addr: string) {
  return addr.slice(0, 6) + "…" + addr.slice(-4);
}

export default function SolanaToSonicBridge() {
  const { connection }           = useConnection();
  const { publicKey, connected } = useWallet();
  const wallet                   = useWallet();

  const [balance, setBalance]     = useState<string>("–");
  const [amount, setAmount]       = useState("");
  const [evmRecipient, setEvmRecipient] = useState("");
  const [txHash, setTxHash]       = useState<string | null>(null);
  const [status, setStatus]       = useState<Status>({ type: "idle" });

  // ── Program IDs ───────────────────────────────────────────────────────────
  const programId = new PublicKey(SOLANA_CONFIG.programId);

  // ── Derive PDAs ───────────────────────────────────────────────────────────
  const [bridgeStatePda] = PublicKey.findProgramAddressSync([BRIDGE_STATE_SEED], programId);
  const [wrappedMintPda] = PublicKey.findProgramAddressSync([MINT_SEED], programId);
  const [emitterPda]     = PublicKey.findProgramAddressSync([WORMHOLE_EMITTER_SEED], programId);

  // ── Load wTST balance ────────────────────────────────────────────────────
  const loadBalance = useCallback(async () => {
    if (!publicKey) return;
    try {
      const ata = getAssociatedTokenAddressSync(wrappedMintPda, publicKey);
      const info = await connection.getTokenAccountBalance(ata);
      setBalance((info.value.uiAmount ?? 0) + " wTST");
    } catch {
      setBalance("0 wTST");
    }
  }, [publicKey, connection, wrappedMintPda]);

  useEffect(() => { if (connected) loadBalance(); }, [connected, loadBalance]);

  // ── Burn & send ──────────────────────────────────────────────────────────
  const burnAndSend = useCallback(async () => {
    if (!publicKey || !wallet.signTransaction) return;
    if (!amount || parseFloat(amount) <= 0) {
      setStatus({ type: "error", message: "Enter a valid amount." });
      return;
    }
    const evmAddrClean = evmRecipient.replace(/^0x/, "");
    if (!/^[0-9a-fA-F]{40}$/.test(evmAddrClean)) {
      setStatus({ type: "error", message: "Invalid EVM recipient address (must be 20-byte hex)." });
      return;
    }

    try {
      setStatus({ type: "pending", message: "Building transaction…" });

      // Load IDL (assumed to be bundled/available as JSON import)
      // In production you would import this at build time.
      const idlResponse = await fetch("/bridge_solana.json");
      if (!idlResponse.ok) throw new Error("IDL not found. Copy target/idl/bridge_solana.json to frontend/public/");
      const idl = await idlResponse.json();

      const provider = new anchor.AnchorProvider(
        connection,
        wallet as anchor.Wallet,
        { commitment: "confirmed" }
      );
      anchor.setProvider(provider);
      const program = new anchor.Program(idl, provider);

      const amountBN = new anchor.BN(Math.floor(parseFloat(amount) * 1e9)); // 9 decimals
      const recipientEvmBytes = Array.from(Buffer.from(evmAddrClean, "hex")) as number[];
      const nonce = Math.floor(Math.random() * 2 ** 32);

      const userAta = getAssociatedTokenAddressSync(wrappedMintPda, publicKey);

      // Wormhole accounts (devnet addresses)
      const wormholeProgramId = new PublicKey("3u8hJUVTA4jH1wYAyUur7FFZVQ8H635K3tSHHF4ssjQ5");
      const [wormholeConfig]   = PublicKey.findProgramAddressSync([Buffer.from("Bridge")], wormholeProgramId);
      const [wormholeFeeCollector] = PublicKey.findProgramAddressSync([Buffer.from("fee_collector")], wormholeProgramId);
      const [wormholeSequence]     = PublicKey.findProgramAddressSync(
        [Buffer.from("Sequence"), emitterPda.toBuffer()],
        wormholeProgramId
      );
      // Message account: fresh keypair each time
      const messageKeypair = anchor.web3.Keypair.generate();

      setStatus({ type: "pending", message: "Awaiting wallet signature…" });

      const tx = await (program.methods as any)
        .burnAndSendBack(amountBN, recipientEvmBytes, nonce)
        .accounts({
          user:               publicKey,
          bridgeState:        bridgeStatePda,
          wrappedMint:        wrappedMintPda,
          userTokenAccount:   userAta,
          wormholeConfig,
          wormholeMessage:    messageKeypair.publicKey,
          wormholeEmitter:    emitterPda,
          wormholeSequence,
          wormholeFeeCollector,
          wormholeProgram:    wormholeProgramId,
          tokenProgram:       TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram:      SystemProgram.programId,
          clock:              SYSVAR_CLOCK_PUBKEY,
          rent:               SYSVAR_RENT_PUBKEY,
        })
        .signers([messageKeypair])
        .rpc();

      setTxHash(tx);
      setStatus({ type: "ok", message: "Tokens burned! See relay instructions below." });
      await loadBalance();
    } catch (err: unknown) {
      setStatus({ type: "error", message: (err as Error).message });
    }
  }, [publicKey, wallet, amount, evmRecipient, connection, bridgeStatePda, wrappedMintPda, emitterPda, loadBalance]);

  return (
    <div className="card">
      <h2 style={{ marginBottom: "1rem" }}>🔥 Solana → Sonic</h2>

      <div style={{ marginBottom: "1rem" }}>
        <WalletMultiButton />
      </div>

      {connected && publicKey && (
        <>
          <p style={{ fontSize: "0.85rem", color: "#94a3b8", marginBottom: "0.75rem" }}>
            Connected: <span style={{ color: "#f0f0f0" }}>{shortAddress(publicKey.toBase58())}</span>
          </p>
          <p style={{ marginBottom: "1rem" }}>Balance: <strong>{balance}</strong></p>

          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <div>
              <label style={{ fontSize: "0.85rem", color: "#94a3b8" }}>Amount (wTST)</label>
              <input
                type="number"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="e.g. 10"
                style={{ marginTop: "0.25rem" }}
              />
            </div>
            <div>
              <label style={{ fontSize: "0.85rem", color: "#94a3b8" }}>Recipient (EVM address, 0x…)</label>
              <input
                type="text"
                value={evmRecipient}
                onChange={(e) => setEvmRecipient(e.target.value)}
                placeholder="0xAbCd…"
                style={{ marginTop: "0.25rem" }}
              />
            </div>
            <button
              onClick={burnAndSend}
              disabled={status.type === "pending"}
              style={{ background: "#f97316", color: "#fff", alignSelf: "flex-start" }}
            >
              {status.type === "pending" ? "Processing…" : "Bridge back to Sonic →"}
            </button>
          </div>

          {status.type !== "idle" && (
            <p
              className={
                status.type === "ok"
                  ? "status-ok"
                  : status.type === "error"
                  ? "status-err"
                  : "status-info"
              }
              style={{ marginTop: "0.75rem" }}
            >
              {status.message}
            </p>
          )}

          {txHash && (
            <div style={{ marginTop: "0.75rem" }}>
              <p className="status-info">
                Tx:{" "}
                <a
                  href={`https://explorer.solana.com/tx/${txHash}?cluster=devnet`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {txHash}
                </a>
              </p>
            </div>
          )}

          {txHash && (
            <div
              className="card"
              style={{ marginTop: "1rem", borderColor: "#334155", background: "#0f172a" }}
            >
              <p style={{ fontWeight: 600, marginBottom: "0.5rem" }}>📋 Next step – Relay the VAA</p>
              <p style={{ fontSize: "0.85rem", color: "#94a3b8" }}>
                Run the following command to unlock tokens on Sonic:
              </p>
              <pre
                style={{
                  marginTop: "0.5rem",
                  padding: "0.75rem",
                  background: "#0d0d0d",
                  borderRadius: "6px",
                  fontSize: "0.8rem",
                  overflowX: "auto",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                }}
              >
                {`cd scripts
EMITTER=<your_emitter_pubkey> \\
SEQUENCE=<wormhole_sequence> \\
PRIVATE_KEY=<evm_private_key> \\
ts-node src/fetchVAASolanaToSonic.ts`}
              </pre>
              <p style={{ fontSize: "0.8rem", color: "#94a3b8", marginTop: "0.5rem" }}>
                The emitter pubkey and sequence are printed by the Anchor program.
                Check the transaction logs on{" "}
                <a
                  href={`https://explorer.solana.com/tx/${txHash}?cluster=devnet`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Solana Explorer
                </a>
                .
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
