// Startet Vite (:5173) und die Express-API (:3100) parallel, ohne eigenes Paket.
//
// Vite macht Hot-Reload für das Frontend; die API wird hier bei Änderungen an
// server/ neu gestartet (fs.watch, rekursiv), damit eine Code-Änderung sofort
// in der Preview wirkt — ohne extra Watch-Paket.
//
// Beenden: Hermes `kill()` beendet den npm-Vorgang hart, bevor Node die
// SIGTERM-Handler (die killAll() aufrufen) ausführen dürfen. Die Enkel
// (Vite detached + API) würden sonst verwaist am Port hängen. Deshalb räumt
// killChild zusätzlich per `taskkill /T /F` (Windows) ab, der die ganze
// Prozessgruppe trifft. Fallback: c.kill().
const { spawn, spawnSync } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const root = path.join(__dirname, '..')
const isWindows = os.platform() === 'win32'
const children = []

function killChild(c) {
  if (!c || c.killed) return
  if (isWindows && c.pid) {
    // /T nimmt die ganze Prozessgruppe mit; synchron, damit der Port sofort
    // frei ist. stdio ignore, damit taskkill kein TTY benötigt.
    try {
      spawnSync('taskkill', ['/PID', String(c.pid), '/T', '/F'], { stdio: 'ignore' })
    } catch {}
  }
  try { c.kill() } catch {}
  c.killed = true
}

function killAll() {
  for (const c of children) killChild(c)
}

const vite = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js')], {
  cwd: root,
  // PT_FAKE wird nicht mehr gesetzt → echter Modus gegen die Steam-Pfade.
  // Wer die Fake-API braucht: `PT_FAKE=1 npm run dev` (wird durchgegereicht).
  env: process.env,
  stdio: 'inherit',
  detached: true
})
children.push(vite)

// --- API-Server mit Auto-Neustart bei Änderungen unter server/ ---
// Kein detached: so löst Node die exit-Handler zuverlässig aus und wir können
// die API bei einem Neustart sauber per kill() beenden (SIGTERM → SIGINT).
const SERVER_DIR = path.join(root, 'server')
let api = null
let restarting = false
let debounce = null

function startApi() {
  api = spawn(process.execPath, [path.join(root, 'server', 'index.js')], {
    cwd: root,
    // PT_FAKE nicht gesetzt → echter Modus (wird via process.env durchgereicht).
    env: process.env,
    stdio: 'inherit'
  })
  children.push(api)
  api.on('exit', (code) => {
    // Neustart (kill) → Code 1; sauberer Abbruch → 0. Beides kein Fehler.
    if (restarting) return
    if (code === 0 || code === 1 || code === 4294967295) return
    console.error(`[dev] API-Server unerwartet beendet (code ${code})`)
  })
}

startApi()

// fs.watch rekursiv: auf Windows nativ, auf POSIX von Node 20+ unterstützt.
// Bei jeder Änderung (auch in Unterverzeichnissen wie fixtures/) die API neu
// starten; Debounce, damit mehrere Schreibvorgänge nur einen Neustart auslösen.
try {
  fs.watch(SERVER_DIR, { recursive: true }, () => {
    if (restarting) return
    restarting = true
    clearTimeout(debounce)
    debounce = setTimeout(() => {
      killChild(api)
      startApi()
      restarting = false
    }, 150)
  })
  console.log('[dev] API-Server startet neu, wenn sich server/ ändert')
} catch (err) {
  console.error('[dev] Watch für server/ nicht verfügbar:', err.message)
}

function shutdown() {
  killAll()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

vite.on('exit', () => {
  killAll()
  process.exit(1)
})
