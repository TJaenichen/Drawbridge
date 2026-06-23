import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `base: "./"` keeps asset URLs relative so the bundle works when served by the
// monitor's own static server. In dev, proxy the SSE stream to a running monitor.
export default defineConfig({
  plugins: [react()],
  base: "./",
  server: {
    proxy: { "/events": { target: "http://127.0.0.1:4737", changeOrigin: true } },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
