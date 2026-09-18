import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Zweiter Dev-Server (z. B. für Claudes Browser-Tests): PT_VITE_PORT und PORT
// setzen, dann kollidiert er nicht mit dem Dev-Server des Nutzers.
const VITE_PORT = Number(process.env.PT_VITE_PORT) || 5173
const API = `http://localhost:${process.env.PORT || 3100}`

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Fester Port — nie rutschen: strictPort lässt Vite fehlschlagen,
    // statt bei Belegung einen anderen Port zu wählen.
    port: VITE_PORT,
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
