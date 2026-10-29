import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri expects a fixed dev port (tauri.conf.json build.devUrl).
// `vite build --mode web` makes the browser test build: relative asset paths, output in dist-web/.
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  clearScreen: false,
  base: mode === "web" ? "./" : "/",
  build: { chunkSizeWarningLimit: 1500, outDir: mode === "web" ? "dist-web" : "dist" },
  server: { port: 1420, strictPort: true, watch: { ignored: ["**/src-tauri/**", "**/target/**"] } },
}));
