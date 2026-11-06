import basicSsl from "@vitejs/plugin-basic-ssl";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig(() => ({
  // WebXR only runs in a secure context
  plugins: [react(), basicSsl()],
  // satellite.js references its optional WebAssembly builds, which use top-level await; the
  // default "iife" worker format can't bundle that.
  worker: { format: "es" as const },
  server: {
    host: true,
    proxy: {
      "/v2": "http://localhost:8000",
    },
  },
}));
