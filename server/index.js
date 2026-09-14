// Einstieg: API-Routen + dient dist/ (Production).
//
// PT_FAKE=1 richtet die Routen auf server/fixtures/ statt auf die Steam-Pfade
// (server/fake-api.js). Die Routenform ist festgelegt (ARCHITECTURE.md) und darf
// sich nicht ändern — nur die dahinterliegende Wurzel.
//
// modId ist in der URL ein einzelner, encodeURIComponent-ierter Segment:
// Base Game "BASE", Workshop-Mod "2688538916/Coffee%20Machines%20Fix".
// Die Frontend (src/api.js) kodiert das; hier wird es von Express dekodiert.
const express = require('express')
const fs = require('node:fs')
const path = require('node:path')

const config = require('./config')
const fake = require('./fake-api')
const { scan } = require('./scanner')
const { saveBatch } = require('./entries')
const llm = require('./llm-io')
const { exportMod } = require('./mod-export')

const app = express()
const PORT = process.env.PORT || 3100
const FAKE = process.env.PT_FAKE === '1'
const FAKE_SERVE = FAKE && process.env.PT_FAKE_SERVE === '1'

const PROJECT_ROOT = path.join(__dirname, '..')
// export/-Verzeichnis: export/ im Projektroot (git-ignoriert); PT_EXPORT_ROOT
// erlaubt einen anderen Ort (Tests).
const EXPORT_ROOT = process.env.PT_EXPORT_ROOT || path.join(PROJECT_ROOT, 'export')
const LLM_ROOT = path.join(EXPORT_ROOT, 'llm')
const BACKUP_ROOT = path.join(EXPORT_ROOT, 'backups')
const MOD_EXPORT_DEFAULT = path.join(EXPORT_ROOT, 'mods')

// Fake-Mode: auch für Scan und Save die Fixture-Wurzel verwenden —
// roots() kennt den Modus, alle Routen nutzen sie. (config.json dient
// im Fake-Mode nur der targetLang, die Pfade bleiben Fixtures.)
function roots() {
  if (FAKE) return fake.roots()
  const c = config.load()
  return { gameRoot: c.gameRoot, workshopDir: c.workshopDir }
}

function targetLangOf(body, fallback) {
  const lang = body && body.targetLang
  return typeof lang === 'string' && lang.length >= 2 && lang.length <= 4 ? lang.toUpperCase() : fallback
}

function fail(res, status, message) {
  return res.status(status).json({ error: message })
}

app.use(express.json())

// --- Scan-State (in-memory-Cache) ---
let cache = null // { mods, entriesByModId }
let scanRunning = false
let scanProgress = { done: 0, total: 0, current: '' }
let scanError = null

// Fake-Mode: die Disk (Fixtures) ist die Quelle der Wahrheit. rescan()
// spiegelt sie in den Cache, damit der Editor (GET /entries) gespeicherte
// Änderungen sofort sieht. Im echten Modus (Phase 2) ist der Scan bewusst
// der einzige Punkt, der die Disk neu einliest.
function rescan() {
  const r = roots()
  rescanning = true
  return scan(r.gameRoot, r.workshopDir, config.load().targetLang)
    .then((result) => {
      cache = result
    })
    .finally(() => {
      rescanning = false
    })
}

// True, wenn die Disk gerade neu eingelesen wird (rescan) — PUTs, die
// währenddessen laufen, dürfen den Cache danach nicht alt machen.
let rescanning = false

app.get('/api/status', (req, res) => {
  const r = roots()
  res.json({
    gameFound: fs.existsSync(r.gameRoot),
    workshopFound: fs.existsSync(r.workshopDir),
    scanRunning,
    modCount: cache ? cache.mods.length : 0,
    error: scanError,
    scanProgress
  })
})

app.post('/api/scan', (req, res) => {
  if (scanRunning) return fail(res, 409, 'Ein Scan läuft bereits.')
  const r = roots()
  scanRunning = true
  scanError = null
  scanProgress = { done: 0, total: 0, current: '' }
  res.status(202).json({ scanRunning: true })
  scan(r.gameRoot, r.workshopDir, config.load().targetLang, {
    onProgress: (p) => {
      scanProgress = p
    }
  })
    .then((result) => {
      cache = result
      scanRunning = false
    })
    .catch((err) => {
      scanRunning = false
      scanError = err && err.message ? err.message : 'Scan fehlgeschlagen'
    })
})

app.get('/api/mods', (req, res) => {
  if (!cache) return fail(res, 404, 'Noch kein Scan durchgeführt — POST /api/scan.')
  const mods = cache.mods.map((m) => ({ ...m, poster: posterUrl(m) }))
  res.json({ mods })
})

// --- Base-Game-Poster (Ressource aus Resources/) ---
// Das Logo des Basisspiels liegt als statische Ressource im Projekt
// (Resources/projectzomboidlogo.jpg) und wird unabhängig vom Scan als
// /base-game-poster.jpg gedient. Die Library zeigt es für den BASE-Mod.
const BASE_POSTER_FILE = path.join(PROJECT_ROOT, 'Resources', 'projectzomboidlogo.jpg')
app.get('/base-game-poster.jpg', (req, res) => {
  if (!fs.existsSync(BASE_POSTER_FILE)) return fail(res, 404, 'Poster nicht gefunden')
  res.type('image/jpeg').sendFile(BASE_POSTER_FILE)
})

// --- Workshop-Poster im echten Modus (Phase 2) ---
// modId kommt als Query-Parameter (?m=<modId>) — der modId enthält "/" und
// " " (PublishedFileID/Name) und würde als Route-Segment Probleme machen.
// Der Dateipfad wird NICHT aus der URL gelesen, sondern aus dem gecachten Mod
// (serverseitig erzeugt) — dadurch kein Pfad-Traversing. Nur Bilder (*.png)
// werden gedient, so wie posterFor() sie anlegt.
app.get('/mod-poster', (req, res) => {
  const id = typeof req.query.m === 'string' ? req.query.m : ''
  const mod = cache ? cache.mods.find((m) => m.id === id) : null
  const file = mod && mod.poster
  if (!file || !file.toLowerCase().endsWith('.png')) return fail(res, 404, 'Poster nicht gefunden')
  if (!fs.existsSync(file)) return fail(res, 404, 'Poster nicht gefunden')
  res.type('image/png').sendFile(file)
})

function getMod(res, modId) {
  if (!cache) {
    fail(res, 404, 'Noch kein Scan durchgeführt — POST /api/scan.')
    return null
  }
  const mod = cache.mods.find((m) => m.id === modId)
  if (!mod) {
    fail(res, 404, `Mod nicht gefunden: ${modId}`)
    return null
  }
  mod.posterUrl = posterUrl(mod)
  return mod
}

app.get('/api/mods/:modId/entries', (req, res) => {
  const mod = getMod(res, req.params.modId)
  if (!mod) return
  const all = cache.entriesByModId[mod.id] || []
  const search = req.query.search ? String(req.query.search).toLowerCase() : ''
  const page = Math.max(1, parseInt(req.query.page, 10) || 1)
  const pageSize = Math.min(500, Math.max(1, parseInt(req.query.pageSize, 10) || 50))
  const filtered = search
    ? all.filter((e) => e.key.toLowerCase().includes(search) || e.original.toLowerCase().includes(search))
    : all
  const start = (page - 1) * pageSize
  res.json({
    modId: mod.id,
    total: filtered.length,
    page,
    pageSize,
    entries: filtered.slice(start, start + pageSize)
  })
})

app.put('/api/mods/:modId/entries', (req, res) => {
  const mod = getMod(res, req.params.modId)
  if (!mod) return
  const wasRescanning = rescanning
  let result
  try {
    result = saveBatch(mod, req.body && req.body.entries, config.load().targetLang, BACKUP_ROOT)
  } catch (err) {
    return fail(res, err.status || 500, err.message || 'Speichern fehlgeschlagen')
  }
  if (FAKE) {
    // rescan spiegelt die Disk in den Cache. War zu Beginn des PUTs ein
    // rescan aktiv, ist sein Snapshot (start < PUT-Schreib) veraltet —
    // danach erneut einspielen, damit der PUT im Cache landet.
    void rescan().then(
      () => { if (wasRescanning) void rescan() },
      () => {},
    )
  }
  res.json(result)
})

// --- Config ---
app.get('/api/config', (req, res) => {
  res.json(config.load())
})

app.post('/api/config', (req, res) => {
  const body = req.body || {}
  const saved = config.save(body)
  res.json(saved)
})

// --- LLM-Export / -Import ---
app.post('/api/export/llm', (req, res) => {
  const body = req.body || {}
  const modIds = Array.isArray(body.modIds) ? body.modIds : []
  const lang = targetLangOf(body, config.load().targetLang)
  const mods = (cache ? cache.mods : []).filter((m) => modIds.includes(m.id))
  if (!mods.length) return fail(res, 400, 'Keine gültigen Mod-Auswahl.')
  try {
    const result = llm.exportLlm(mods, lang, LLM_ROOT)
    res.json({ targetLang: lang, written: result.written })
  } catch (err) {
    fail(res, 500, err.message || 'LLM-Export fehlgeschlagen')
  }
})

function importDirOf(req) {
  const body = req.body || {}
  if (body.dir && typeof body.dir === 'string') return body.dir
  return path.join(LLM_ROOT, config.load().targetLang)
}

app.get('/api/import/llm/preview', (req, res) => {
  const dir = (req.query.dir && String(req.query.dir)) || path.join(LLM_ROOT, config.load().targetLang)
  const mods = cache ? cache.mods : []
  res.json(llm.importPreview(dir, mods, config.load().targetLang))
})

app.post('/api/import/llm/apply', (req, res) => {
  const dir = importDirOf(req)
  const mods = cache ? cache.mods : []
  const wasRescanning = rescanning
  let result
  try {
    result = llm.importApply(dir, mods, config.load().targetLang, BACKUP_ROOT)
  } catch (err) {
    return fail(res, err.status || 500, err.message || 'Import fehlgeschlagen')
  }
  if (FAKE) {
    // Wie beim PUT: laufender rescan hätte einen alten Snapshot —
    // danach erneut einspielen.
    void rescan().then(
      () => { if (wasRescanning) void rescan() },
      () => {},
    )
  }
  res.json(result)
})

// --- Mod-Export ---
app.post('/api/export/mod', (req, res) => {
  const body = req.body || {}
  const modIds = Array.isArray(body.modIds) ? body.modIds : []
  const targetDir = body.targetDir && typeof body.targetDir === 'string' ? body.targetDir : MOD_EXPORT_DEFAULT
  const lang = targetLangOf(body, config.load().targetLang)
  const mods = (cache ? cache.mods : []).filter((m) => modIds.includes(m.id))
  if (!mods.length) return fail(res, 400, 'Keine gültigen Mod-Auswahl.')
  try {
    const results = mods.map((m) => exportMod(m, lang, targetDir))
    res.json({ targetLang: lang, targetDir: config.toPosix(targetDir), results })
  } catch (err) {
    fail(res, 500, err.message || 'Mod-Export fehlgeschlagen')
  }
})

// --- Mod-Poster (Fake-API) ---
// Base-Game-Logo ist eine statische Projekt-Ressource (Resources/), die in
// jedem Modus über die feste Route /base-game-poster.jpg gelöst wird.
// Server-Pfad des Posters → API-URL (über schreibgeschütztes Feld `poster`
// im /api/mods-Response). In Fake-Mode liegt das Poster unter server/fixtures/
// und wird über /fixtures/ gedient. Im echten Modus dient die Route
// /mod-poster?m=<modId> die Datei von der Disk (s. oben).
function posterUrl(mod) {
  if (mod.isBaseGame) return '/base-game-poster.jpg'
  if (!mod.poster) return null
  if (FAKE) {
    const rel = path.relative(fake.FIXTURES, mod.poster).split(path.sep).join('/')
    return '/fixtures/' + rel
  }
  return '/mod-poster?m=' + encodeURIComponent(mod.id)
}

// --- Fake-API: Mod-Poster aus server/fixtures/ über /fixtures/ dienen ---
// Vor dem dist/-Block registrieren: die SPA-Catchall-Route würde sonst
// /fixtures/-Pfade auf index.html (text/html) abfangen und die Poster
// im Browser kaputt.
if (FAKE_SERVE) {
  app.use('/fixtures', express.static(path.join(fake.FIXTURES)))
}

// --- Production: gebautes Frontend dienen ---
const DIST = path.join(PROJECT_ROOT, 'dist')
if (fs.existsSync(DIST)) {
  app.use(express.static(DIST))
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api')) {
      return res.sendFile(path.join(DIST, 'index.html'))
    }
    next()
  })
}

// --- Letzter Fehlerfang: API-Fehler immer als { error } ---
app.use('/api', (err, req, res, next) => {
  if (res.headersSent) return next(err)
  fail(res, err.status || 500, err.message || 'Unbekannter Fehler')
})

app.listen(PORT, () => {
  console.log(`API auf http://localhost:${PORT} (Fake: ${FAKE})`)
})

module.exports = app
