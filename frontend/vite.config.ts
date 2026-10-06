import basicSsl from '@vitejs/plugin-basic-ssl'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  // `vite --mode xr` serves over HTTPS on the LAN so a headset can open it: WebXR only runs in a
  // secure context, and a self-signed certificate is enough for that.
  plugins: [react(), ...(mode === 'xr' ? [basicSsl()] : [])],
  server: {
    host: mode === 'xr' ? true : undefined,
    // The API is fetched same-origin and proxied, so it also works from another device (and over
    // HTTPS) without the backend being reachable directly.
    proxy: {
      '/v2': 'http://localhost:8000',
    },
  },
}))
