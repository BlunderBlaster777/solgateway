/**
 * SonicToSolanaBridge.tsx
 *
 * Flow:
 *  1. Connect EVM wallet (MetaMask or any injected provider).
 *  2. Show TestToken (TST) balance.
 *  3. User enters amount and their Solana recipient address.
 *  4. Approve BridgeSonic to spend tokens, then call lockAndSend().
 *  5. Display tx hash and Wormhole sequence.
 *  6. Show relay instructions.
 */

import React, { useState, useEffect, useCallback } from "react";
import { BrowserProvider, Contract, parseUnits, formatUnits, zeroPadValue, getBytes } from "ethers";
import { PublicKey } from "@solana/web3.js";
import { SONIC_CONFIG, ERC20_ABI, BRIDGE_SONIC_ABI } from "../config";

type Status = { type: "idle" | "pending" | "ok" | "error"; message?: string };

export default function SonicToSolanaBridge() {
  const [evmAddress, setEvmAddress]   = useState<string | null>(null);
  const [balance, setBalance]         = useState<string>("–");
  const [amount, setAmount]           = useState("");
  const [recipient, setRecipient]     = useState("");
  const [txHash, setTxHash]           = useState<string | null>(null);
  const [sequence, setSequence]       = useState<string | null>(null);
  const [status, setStatus]           = useState<Status>({ type: "idle" });

  // ── Connect EVM wallet ──────────────────────────────────────────────────
  const connectEVM = useCallback(async () => {
    if (!window.ethereum) {
      setStatus({ type: "error", message: "No EVM wallet detected. Install MetaMask." });
      return;
    }
    try {
      const provider = new BrowserProvider(window.ethereum);
      await provider.send("eth_requestAccounts", []);

      // Switch / add Sonic testnet
      try {
        await window.ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: "0x" + SONIC_CONFIG.chainId.toString(16) }],
        });
      } catch (switchErr: unknown) {
        // Chain not added yet – add it
        if ((switchErr as { code?: number }).code === 4902) {
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: "0x" + SONIC_CONFIG.chainId.toString(16),
                chainName: SONIC_CONFIG.chainName,
                rpcUrls: [SONIC_CONFIG.rpcUrl],
                nativeCurrency: { name: "Sonic", symbol: "S", decimals: 18 },
              },
            ],
          });
        }
      }

      const signer  = await provider.getSigner();
      const address = await signer.getAddress();
      setEvmAddress(address);
    } catch (err: unknown) {
      setStatus({ type: "error", message: (err as Error).message });
    }
  }, []);

  // ── Load TST balance ─────────────────────────────────────────────────────
  const loadBalance = useCallback(async () => {
    if (!evmAddress || !window.ethereum) return;
    try {
      const provider = new BrowserProvider(window.ethereum);
      const token    = new Contract(SONIC_CONFIG.testTokenAddress, ERC20_ABI, provider);
      const raw      = await token.balanceOf(evmAddress);
      const dec      = await token.decimals();
      setBalance(formatUnits(raw, dec) + " TST");
    } catch {
      setBalance("error");
    }
  }, [evmAddress]);

  useEffect(() => { loadBalance(); }, [loadBalance]);

  // ── Bridge ───────────────────────────────────────────────────────────────
  const bridge = useCallback(async () => {
    if (!window.ethereum || !evmAddress) return;
    if (!amount || parseFloat(amount) <= 0) {
      setStatus({ type: "error", message: "Enter a valid amount." });
      return;
    }
    let recipientPubkey: PublicKey;
    try {
      recipientPubkey = new PublicKey(recipient);
    } catch {
      setStatus({ type: "error", message: "Invalid Solana recipient address." });
      return;
    }

    try {
      setStatus({ type: "pending", message: "Approving tokens…" });

      const provider = new BrowserProvider(window.ethereum);
      const signer   = await provider.getSigner();

      const token  = new Contract(SONIC_CONFIG.testTokenAddress,  ERC20_ABI,      signer);
      const bridge = new Contract(SONIC_CONFIG.bridgeSonicAddress, BRIDGE_SONIC_ABI, signer);

      const decimals   = await token.decimals();
      const amountWei  = parseUnits(amount, decimals);

      // 1. Approve
      const approveTx = await token.approve(SONIC_CONFIG.bridgeSonicAddress, amountWei);
      await approveTx.wait();

      setStatus({ type: "pending", message: "Locking tokens and publishing Wormhole message…" });

      // 2. Encode Solana pubkey as bytes32
      const recipientBytes = recipientPubkey.toBytes();          // 32 bytes
      const recipientHex   = zeroPadValue(getBytes(recipientBytes), 32);

      // 3. lockAndSend
      const fee = await provider.getBalance(SONIC_CONFIG.bridgeSonicAddress).catch(() => 0n);
      // Wormhole message fee (some chains charge; pass 0 if none)
      const nonce    = Math.floor(Math.random() * 2 ** 32);
      const lockTx   = await bridge.lockAndSend(recipientHex, amountWei, nonce, { value: 0n });
      const receipt  = await lockTx.wait();

      setTxHash(receipt.hash);

      // Extract sequence from event logs
      const iface   = new Contract(SONIC_CONFIG.bridgeSonicAddress, BRIDGE_SONIC_ABI, provider).interface;
      for (const log of receipt.logs) {
        try {
          const parsed = iface.parseLog(log);
          if (parsed?.name === "TokensLocked") {
            setSequence(parsed.args.wormholeSequence.toString());
          }
        } catch {
          // not our event
        }
      }

      setStatus({ type: "ok", message: "Tokens locked! See relay instructions below." });
      await loadBalance();
    } catch (err: unknown) {
      setStatus({ type: "error", message: (err as Error).message });
    }
  }, [evmAddress, amount, recipient, loadBalance]);

  return (
    <div className="card">
      <h2 style={{ marginBottom: "1rem" }}>🔒 Sonic → Solana</h2>

      {!evmAddress ? (
        <button onClick={connectEVM} style={{ background: "#6366f1", color: "#fff" }}>
          Connect EVM Wallet
        </button>
      ) : (
        <>
          <p style={{ fontSize: "0.85rem", color: "#94a3b8", marginBottom: "0.75rem" }}>
            Connected: <span style={{ color: "#f0f0f0" }}>{evmAddress}</span>
          </p>
          <p style={{ marginBottom: "1rem" }}>Balance: <strong>{balance}</strong></p>

          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <div>
              <label style={{ fontSize: "0.85rem", color: "#94a3b8" }}>Amount (TST)</label>
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
              <label style={{ fontSize: "0.85rem", color: "#94a3b8" }}>Recipient (Solana pubkey)</label>
              <input
                type="text"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                placeholder="e.g. 7aBc…"
                style={{ marginTop: "0.25rem" }}
              />
            </div>
            <button
              onClick={bridge}
              disabled={status.type === "pending"}
              style={{ background: "#6366f1", color: "#fff", alignSelf: "flex-start" }}
            >
              {status.type === "pending" ? "Processing…" : "Bridge to Solana →"}
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
              <p className="status-info">Tx: {txHash}</p>
              {sequence && <p className="status-info">Wormhole sequence: {sequence}</p>}
            </div>
          )}

          {sequence && (
            <div
              className="card"
              style={{ marginTop: "1rem", borderColor: "#334155", background: "#0f172a" }}
            >
              <p style={{ fontWeight: 600, marginBottom: "0.5rem" }}>📋 Next step – Relay the VAA</p>
              <p style={{ fontSize: "0.85rem", color: "#94a3b8" }}>
                Run the following command to complete the bridge (mints tokens on Solana):
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
EMITTER=${SONIC_CONFIG.bridgeSonicAddress} \\
SEQUENCE=${sequence} \\
RECIPIENT=${recipient} \\
SOLANA_KEYPAIR=~/.config/solana/id.json \\
ts-node src/fetchVAASonicToSolana.ts`}
              </pre>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Make TypeScript happy about window.ethereum
declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ethereum?: any;
  }
}
