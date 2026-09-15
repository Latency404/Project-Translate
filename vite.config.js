import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Fester Port — nie rutschen: strictPort lässt Vite fehlschlagen,
    // statt bei Belegung einen anderen Port zu wählen.
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:3100',
      // Bild-Routen der API — ohne Proxy fiele Vite in den SPA-Fallback zurück
      // und <img> erhielte index.html statt PNG/JPG.
      '/mod-poster': 'http://localhost:3100',
      '/base-game-poster.jpg': 'http://localhost:3100'
    }
  }
})
