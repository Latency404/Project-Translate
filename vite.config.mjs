import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// PORT ist hier der API-Port — scripts/dev.js setzt ihn ausdrücklich.
// 127.0.0.1 statt "localhost": die API bindet ausdrücklich nur an die
// Loopback-Adresse (s. server/index.js), und auf Node 17+ kann "localhost"
// zuerst zu ::1 aufgelöst werden → ECONNREFUSED, obwohl die API läuft.
const API = `http://127.0.0.1:${process.env.PORT || 3100}`

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Fester Port — nie rutschen: strictPort lässt Vite fehlschlagen,
    // statt bei Belegung einen anderen Port zu wählen.
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': API,
      // Bild-Routen der API — ohne Proxy fiele Vite in den SPA-Fallback zurück
      // und <img> erhielte index.html statt PNG/JPG.
      '/mod-poster': API,
      '/base-game-poster.jpg': API
    }
  }
})
