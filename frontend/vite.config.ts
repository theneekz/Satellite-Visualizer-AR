import basicSsl from "@vitejs/plugin-basic-ssl";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig(() => ({
  // WebXR only runs in a secure context
  plugins: [react(), basicSsl()],
  server: {
    host: true,
    proxy: {
      "/v2": "http://localhost:8000",
    },
  },
}));
