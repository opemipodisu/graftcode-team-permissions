import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import { resolve } from "path";

export default defineConfig({
  plugins: [react(), nodePolyfills({ exclude: ["crypto"] })],
  resolve: {
    alias: {
      crypto: resolve("./src/crypto-shim.js"),
    },
  },
});
