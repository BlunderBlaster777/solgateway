import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  define: {
    // Required by @solana/web3.js in browser
    "process.env": {},
    global: "globalThis",
  },
  resolve: {
    alias: {
      stream: "stream-browserify",
    },
  },
});
