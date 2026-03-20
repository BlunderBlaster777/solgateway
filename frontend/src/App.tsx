import React, { useMemo } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import "@solana/wallet-adapter-react-ui/styles.css";
import { SOLANA_CONFIG } from "./config";
import SonicToSolanaBridge from "./components/SonicToSolanaBridge";
import SolanaToSonicBridge from "./components/SolanaToSonicBridge";

export default function App() {
  const wallets = useMemo(() => [new PhantomWalletAdapter()], []);

  return (
    <ConnectionProvider endpoint={SOLANA_CONFIG.rpcUrl}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <div style={{ maxWidth: 700, margin: "0 auto", padding: "2rem 1rem" }}>
            <h1 style={{ marginBottom: "0.25rem" }}>🌉 SolGateway</h1>
            <p style={{ color: "#94a3b8", marginBottom: "2rem" }}>
              Sonic Testnet ↔ Solana Devnet — powered by Wormhole
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
              <SonicToSolanaBridge />
              <SolanaToSonicBridge />
            </div>
          </div>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
