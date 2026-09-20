// Einstieg: API-Routen + dient dist/ (Production).
//
// PT_FAKE=1 richtet die Routen auf server/fixtures/ statt auf die Steam-Pfade
// (server/fake-api.js). Die Routenform ist festgelegt (CLAUDE.md) und darf
// sich nicht ändern — nur die dahinterliegende Wurzel.
//
// modId ist in der URL ein einzelner, encodeURIComponent-ierter Segment:
// Base Game "BASE", Workshop-Mod "2000000002/Coffee%20Corner".
// Die Frontend (src/api.js) kodiert das; hier wird es von Express dekodiert.
//
// Mehrsprachigkeit: der Scan-Cache hält ALLE zuletzt gescannten Zielsprachen
// gleichzeitig (mod.translatedCounts / entry.translations+preFilled sind
// Objekte je Sprache). GET /api/mods und GET /api/mods/:modId/entries
// projizieren das nach außen weiterhin FLACH (translatedCount / translation /
// preFilled) für genau eine angefragte Sprache (?lang=, Default activeLang) —
// das Frontend bleibt so nah am bisherigen, einsprachigen Stand.
const express = require('express')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')

const config = require('./config')
const langs = require('./langs')
const fake = require('./fake-api')
const { scan } = require('./scanner')
const { saveBatch, resetToGame, classifyFsError } = require('./entries')
const guard = require('./guard')
const { listBackups, restoreBackup, freshStamp } = require('./backups')
const llm = require('./llm-io')
const scanStore = require('./scan-store')
const { exportModsBundle } = require('./mod-export')
const { buildZip, collectFiles } = require('./zip')

const app = express()
const PORT = process.env.PORT || 3100
const FAKE = process.env.PT_FAKE === '1'
const FAKE_SERVE = FAKE && process.env.PT_FAKE_SERVE === '1'

const PROJECT_ROOT = path.join(__dirname, '..')
// export/-Verzeichnis: export/ im Projektroot (git-ignoriert); PT_EXPORT_ROOT
// erlaubt einen anderen Ort (Tests).
const EXPORT_ROOT = process.env.PT_EXPORT_ROOT || path.join(PROJECT_ROOT, 'export')
const BACKUP_ROOT = path.join(EXPORT_ROOT, 'backups')
// Arbeitsordner: hier landen alle Übersetzungen des Nutzers. Game- und
// Workshop-Ordner werden von der App nur gelesen (s. guard.js).
const WORK_ROOT = path.join(EXPORT_ROOT, 'work')
const MOD_EXPORT_DEFAULT = path.join(EXPORT_ROOT, 'mods')
const SCAN_CACHE_FILE = path.join(EXPORT_ROOT, 'scan-cache.json')

// Fake-Mode: auch für Scan und Save die Fixture-Wurzel verwenden —
// roots() kennt den Modus, alle Routen nutzen sie. (config.json dient
// im Fake-Mode nur den Zielsprachen, die Pfade bleiben Fixtures.)
function roots() {
  if (FAKE) return fake.roots()
  const c = config.load()
  return { gameRoot: c.gameRoot, workshopDir: c.workshopDir }
}

// Eine Zielsprachen-Angabe aus einem Request-Body lesen: bevorzugt das Array
// `targetLangs`; rückwärtskompatibel wird ein einzelnes `targetLang` (String)
// als [targetLang] gelesen (s. CLAUDE.md). Fehlt beides, gilt fallback (i. d. R.
// die konfigurierten targetLangs). Validiert zusätzlich gegen die bekannten
// PZ-Sprachen (server/langs.js) — ein Tippfehler wie "ZZ" bricht sonst erst
// beim Schreiben der Export-Dateien unbemerkt. Rückgabe wie resolveCacheLang:
// { langs } oder { error }.
function langsArrayOf(body, fallback) {
  let list
  if (Array.isArray(body.targetLangs) && body.targetLangs.length) {
    list = body.targetLangs.map((l) => String(l).toUpperCase())
  } else if (typeof body.targetLang === 'string' && body.targetLang) {
    list = [body.targetLang.toUpperCase()]
  } else {
    list = fallback
  }
  const unknown = list.filter((l) => !langs.isKnownLang(l))
  if (unknown.length) {
    return { error: `Unknown target language: ${unknown.join(', ')}.` }
  }
  return { langs: list }
}

function sameLangSet(a, b) {
  if (a.length !== b.length) return false
  const setA = new Set(a)
  return b.every((x) => setA.has(x))
}

// Zweites Netz: jedes Schreiben in Spiel/Workshop bricht mit 403 ab (guard.js).
guard.setProtectedRoots(() => {
  const r = roots()
  return [r.gameRoot, r.workshopDir]
})

function fail(res, status, message) {
  return res.status(status).json({ error: message })
}

// Default-Limit von express.json() ist 100kb — ein LLM-Import-Bundle für viele
// Mods/Einträge überschreitet das leicht ("request entity too large").
app.use(express.json({ limit: '200mb' }))

// --- CSRF-Härtung für schreibende API-Routen ---
// Eine fremde Seite kann einen "einfachen" Cross-Origin-Request schicken (ein
// <form>-POST oder fetch mit Content-Type: text/plain) — das braucht keinen
// Preflight, express.json() parst so einen Body nicht (falscher Content-Type),
// req.body bleibt {} und z. B. POST /api/reset-translations würde trotzdem
// ungewollt ALLE Übersetzungen zurücksetzen. Die Frontend (src/api.js) sendet
// für JEDEN Call, auch ohne Body, ausdrücklich Content-Type: application/json
// — das erzwingt bei echten Cross-Origin-Requests einen Preflight, den diese
// API nie beantwortet (keine CORS-Header). Schreibende Methoden ohne diesen
// Content-Type werden deshalb hart abgelehnt.
app.use('/api', (req, res, next) => {
  const writes = req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH' || req.method === 'DELETE'
  if (writes && !req.is('application/json')) {
    return fail(res, 415, 'Content-Type must be application/json.')
  }
  next()
})

// --- Scan-State (in-memory-Cache) ---
// cache = { mods, entriesByModId, langs } — `langs` sind die targetLangs, mit
// denen zuletzt gescannt wurde (nur für diese Sprachen halten
// translatedCounts/translations/preFilled verlässliche Werte).
let cache = null
let scanRunning = false
let scanProgress = { done: 0, total: 0, current: '' }
let scanError = null

// Scan-Stand auf die Platte legen (nach jedem Scan/Rescan), gebündelt: läuft ein
// Schreiben, wird danach genau einmal mit dem dann aktuellen Stand nachgeschrieben.
let persistRunning = false
let persistAgain = false
function persistCache() {
  if (!cache) return
  if (persistRunning) {
    persistAgain = true
    return
  }
  persistRunning = true
  const r = roots()
  const meta = { gameRoot: r.gameRoot, workshopDir: r.workshopDir, langs: cache.langs }
  scanStore
    .save(SCAN_CACHE_FILE, meta, cache)
    .catch((err) => console.error(`Scan-Stand konnte nicht gespeichert werden: ${err.message}`))
    .finally(() => {
      persistRunning = false
      if (persistAgain) {
        persistAgain = false
        persistCache()
      }
    })
}

// Die Disk ist die Quelle der Wahrheit: nach jedem Schreiben (PUT / Reset)
// spiegelt rescan() die Disk in den Cache, damit der Editor (GET /entries)
// gespeicherte Änderungen sofort sieht — in Fake- und echtem Modus gleich.
function rescan() {
  rescanning = true
  return runScan()
    .then(persistCache)
    .finally(() => {
      rescanning = false
    })
}

// Liest Spiel/Workshop/Arbeitsordner neu ein und setzt den Cache. Flags,
// Fortschritt und Persistieren machen die Aufrufer.
function runScan(extraOpts) {
  const r = roots()
  const cfg = config.load()
  return scan(r.gameRoot, r.workshopDir, cfg.targetLangs, config.SOURCE_LANG, { workRoot: WORK_ROOT, ...extraOpts }).then(
    (result) => {
      cache = { ...result, langs: [...cfg.targetLangs] }
    }
  )
}

// Antwort erst nach dem Rescan senden. War beim Start ein Rescan aktiv, ist
// dessen Snapshot veraltet — dann noch einmal einspielen.
function rescanThen(wasRescanning, respond) {
  return rescan()
    .then(() => (wasRescanning ? rescan() : undefined))
    .catch(() => {})
    .finally(respond)
}

// Gemeinsame Auswahl der Export-Routen: { mods, targetLangs } oder null
// (dann ist die 400-Antwort schon gesendet).
function exportSelection(body, res) {
  const modIds = Array.isArray(body.modIds) ? body.modIds : []
  const resolvedLangs = langsArrayOf(body, config.load().targetLangs)
  if (resolvedLangs.error) {
    fail(res, 400, resolvedLangs.error)
    return null
  }
  const mods = (cache ? cache.mods : []).filter((m) => modIds.includes(m.id))
  if (!mods.length) {
    fail(res, 400, 'No valid mod selection.')
    return null
  }
  return { mods, targetLangs: resolvedLangs.langs }
}

// True, wenn die Disk gerade neu eingelesen wird (rescan) — PUTs, die
// währenddessen laufen, dürfen den Cache danach nicht alt machen.
let rescanning = false

app.get('/api/status', (req, res) => {
  const r = roots()
  const cfg = config.load()
  res.json({
    gameFound: config.isGameRoot(r.gameRoot),
    workshopFound: config.isWorkshopDir(r.workshopDir),
    configSaved: fs.existsSync(config.CONFIG_PATH),
    scanRunning,
    modCount: cache ? cache.mods.length : 0,
    error: scanError,
    scanProgress,
    targetLangs: cfg.targetLangs,
    activeLang: cfg.activeLang
  })
})

app.post('/api/scan', (req, res) => {
  if (scanRunning) return fail(res, 409, 'A scan is already running.')
  startScan()
  res.status(202).json({ scanRunning: true })
})

// Startet einen Scan im Hintergrund (Fortschritt über /api/status).
function startScan() {
  scanRunning = true
  scanError = null
  scanProgress = { done: 0, total: 0, current: '' }
  runScan({
    onProgress: (p) => {
      scanProgress = p
    }
  })
    .then(() => {
      scanRunning = false
      persistCache()
    })
    .catch((err) => {
      scanRunning = false
      scanError = err && err.message ? err.message : 'Scan failed.'
    })
}

// Distincte Quelldateien (version/file) eines Mods: Map "version/file" →
// { version, file }. Pro Eintragsliste einmal berechnet (der Cache tauscht die
// Listen bei jedem Scan aus).
const sourceFilesMemo = new WeakMap()
function sourceFilesOf(mod) {
  const entries = cache.entriesByModId[mod.id] || []
  let files = sourceFilesMemo.get(entries)
  if (!files) {
    files = new Map()
    for (const e of entries) {
      const key = `${e.version}/${e.file}`
      if (!files.has(key)) files.set(key, { version: e.version, file: e.file })
    }
    sourceFilesMemo.set(entries, files)
  }
  return files
}

// filesCount = Anzahl distincter Quelldateien — für den "N Files"-Badge auf der
// Mods-Seite. Gleiche Ableitung wie die Reset-Translations-Route unten.
function filesCountOf(mod) {
  return sourceFilesOf(mod).size
}

// Sprachcode aus einem Request-Wert: Großbuchstaben oder fallback.
function langOf(value, fallback) {
  return typeof value === 'string' && value ? value.toUpperCase() : fallback
}

// ?lang=-Query lesen und gegen den Cache validieren (Default: activeLang).
// Eine Sprache, mit der zuletzt nicht gescannt wurde, liefert einen lesbaren
// Fehler statt stiller undefined-Felder (translatedCounts/translations kennen
// nur die beim letzten Scan aktiven Sprachen).
function resolveCacheLang(req, cfg) {
  const raw = langOf(req.query.lang, cfg.activeLang)
  if (!cache.langs.includes(raw)) {
    return { error: `Language not scanned: ${raw}. Run a scan after selecting it as a target language.` }
  }
  return { lang: raw }
}

// mod.translatedCounts (Objekt je Sprache) → flaches translatedCount für eine
// Sprache; die Objekt-Form selbst wird nicht nach außen gegeben.
function projectModForLang(mod, lang) {
  const { translatedCounts, ...rest } = mod
  return { ...rest, translatedCount: (translatedCounts && translatedCounts[lang]) ?? 0 }
}

// entry.translations/preFilled (Objekte je Sprache) → flaches
// translation/preFilled für eine Sprache.
function projectEntryForLang(entry, lang) {
  const { translations, preFilled, ...rest } = entry
  return {
    ...rest,
    translation: translations && translations[lang] !== undefined ? translations[lang] : null,
    preFilled: !!(preFilled && preFilled[lang])
  }
}

app.get('/api/mods', (req, res) => {
  if (!cache) return fail(res, 404, 'No scan yet. Search for mods in Settings first.')
  const cfg = config.load()
  const resolved = resolveCacheLang(req, cfg)
  if (resolved.error) return fail(res, 400, resolved.error)
  const mods = cache.mods.map((m) => ({
    ...projectModForLang(m, resolved.lang),
    poster: posterUrl(m),
    filesCount: filesCountOf(m)
  }))
  res.json({ mods })
})

// --- Base-Game-Poster (Ressource aus Resources/) ---
// Das Logo des Basisspiels liegt als statische Ressource im Projekt
// (Resources/projectzomboidlogo.jpg) und wird unabhängig vom Scan als
// /base-game-poster.jpg gedient. Die Mods-Seite zeigt es für den BASE-Mod.
const BASE_POSTER_FILE = path.join(PROJECT_ROOT, 'Resources', 'projectzomboidlogo.jpg')
app.get('/base-game-poster.jpg', (req, res) => {
  if (!fs.existsSync(BASE_POSTER_FILE)) return fail(res, 404, 'Poster not found.')
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
  if (!file || !file.toLowerCase().endsWith('.png')) return fail(res, 404, 'Poster not found.')
  if (!fs.existsSync(file)) return fail(res, 404, 'Poster not found.')
  res.type('image/png').sendFile(file)
})

function getMod(res, modId) {
  if (!cache) {
    fail(res, 404, 'No scan yet. Search for mods in Settings first.')
    return null
  }
  const mod = cache.mods.find((m) => m.id === modId)
  if (!mod) {
    fail(res, 404, `Mod not found: ${modId}.`)
    return null
  }
  return mod
}

// Lua-Fundstellen der Keys (Kontext für Platzhalter im Editor) und die Wörter aus
// dem Mod-Code je Mod; einmal pro Scan-Cache gelesen, weil der Editor Seiten
// nachlädt.
const usageMemo = new WeakMap()
function usageFor(mod) {
  let perMod = usageMemo.get(cache)
  if (!perMod) usageMemo.set(cache, (perMod = new Map()))
  if (!perMod.has(mod.id)) {
    let found = new Map()
    let words = null
    try {
      found = llm.modUsageFound(mod, config.SOURCE_LANG)
      words = llm.modMentionedWords(mod, config.SOURCE_LANG)
    } catch {
      /* Hinweise sind optional */
    }
    perMod.set(mod.id, { found, words })
  }
  return perMod.get(mod.id)
}

// Nur Kategorien, die das Spiel nicht von selbst nach Namensschema liest
// (Sandbox_, ItemName_, Fluid_, UI_optionscreen_binding_, UI_trait_ … holt die
// Engine ohne Lua-Code). Bei ContextMenu/Tooltip bleibt ein Key, den der
// Mod-Code nie nennt, verdächtig: evtl. ungenutzt. Die Engine liest auch hier
// ein paar Schemata selbst (EvolvedRecipe).
const CODE_USED_CATEGORIES = new Set(['contextmenu', 'tooltip'])
const ENGINE_KEY_PREFIXES = ['ContextMenu_EvolvedRecipe_']
function categoryOf(file) {
  const m = /([^/]+?)(?:_EN)?\.(?:json|txt)$/i.exec(file || '')
  return m ? m[1].toLowerCase() : ''
}
// true = der Mod-Code nennt den Key nirgends; false = genannt oder nicht belastbar.
// Als genannt gilt auch ein Key, der mit einem Wort aus dem Code beginnt
// (Prefix, z. B. "ContextMenu_FenceSheets_AddSheet" .. richtung, oder "KEY" ..
// "_tooltip"): dann baut der Code ihn vermutlich zusammen.
function notInModCode(entry, words) {
  if (!words || !CODE_USED_CATEGORIES.has(categoryOf(entry.file))) return false
  if (!/^[A-Za-z0-9_]+$/.test(entry.key) || words.has(entry.key)) return false
  if (ENGINE_KEY_PREFIXES.some((p) => entry.key.startsWith(p))) return false
  for (const w of words) {
    if (w.length >= 8 && entry.key.startsWith(w)) return false
  }
  return true
}

// Der Editor holt die Treffer seitenweise — den Filter über alle Einträge nur
// einmal je (Eintragsliste, Sprache, Suchtext) rechnen.
let lastSearch = null
function searchEntries(all, lang, search) {
  if (lastSearch && lastSearch.all === all && lastSearch.lang === lang && lastSearch.search === search) {
    return lastSearch.filtered
  }
  const filtered = all.filter((e) => {
    const t = e.translations && e.translations[lang]
    return (
      e.key.toLowerCase().includes(search) ||
      e.original.toLowerCase().includes(search) ||
      (typeof t === 'string' && t.toLowerCase().includes(search))
    )
  })
  lastSearch = { all, lang, search, filtered }
  return filtered
}

app.get('/api/mods/:modId/entries', (req, res) => {
  const mod = getMod(res, req.params.modId)
  if (!mod) return
  const cfg = config.load()
  const resolved = resolveCacheLang(req, cfg)
  if (resolved.error) return fail(res, 400, resolved.error)
  const lang = resolved.lang
  const all = cache.entriesByModId[mod.id] || []
  const search = req.query.search ? String(req.query.search).toLowerCase() : ''
  const page = Math.max(1, parseInt(req.query.page, 10) || 1)
  const pageSize = Math.min(500, Math.max(1, parseInt(req.query.pageSize, 10) || 50))
  // Treffer im Schlüssel, im Originaltext oder in der (gespeicherten) Übersetzung
  // der angefragten Sprache.
  const filtered = search ? searchEntries(all, lang, search) : all
  const start = (page - 1) * pageSize
  res.json({
    modId: mod.id,
    total: filtered.length,
    page,
    pageSize,
    entries: filtered.slice(start, start + pageSize).map((e) => {
      const projected = projectEntryForLang(e, lang)
      const { found, words } = usageFor(mod)
      const uses = found.get(e.key)
      if (uses) projected.usage = uses
      if (notInModCode(e, words)) projected.notInCode = true
      return projected
    })
  })
})

// Aktive Sprache wechseln — der ganze Zweck des Mehrsprachen-Umbaus: KEIN
// Rescan, KEINE Pfadprüfung, nur die Config-Datei aktualisieren. Der Cache
// bleibt komplett unangetastet (er hält ohnehin schon alle targetLangs).
app.post('/api/active-lang', (req, res) => {
  const body = req.body || {}
  const cfg = config.load()
  const lang = langOf(body.lang, '')
  if (!lang || !cfg.targetLangs.includes(lang)) {
    return fail(res, 400, `Unknown target language: ${body.lang}.`)
  }
  const saved = config.save({ ...cfg, activeLang: lang })
  res.json({ activeLang: saved.activeLang })
})

// Alle Übersetzungen (je Sprache, global über jeden gescannten Mod) auf den
// Stand im Spiel/Workshop zurücksetzen: die Arbeitsdateien werden gelöscht
// (s. resetToGame in entries.js). Übersetzungen, die schon im Spiel/Workshop
// liegen, bleiben dabei erhalten; Spiel und Workshop selbst werden nie
// angefasst.
app.post('/api/reset-translations', (req, res) => {
  if (!cache) return fail(res, 404, 'No scan yet. Search for mods in Settings first.')
  const cfg = config.load()
  const body = req.body || {}
  const rawLangs = Array.isArray(body.langs)
    ? body.langs
    : typeof body.langs === 'string' && body.langs
      ? [body.langs]
      : null
  const langs = rawLangs && rawLangs.length
    ? [...new Set(rawLangs.map((l) => String(l).toUpperCase()))]
    : cfg.targetLangs
  const unknown = langs.filter((l) => !cfg.targetLangs.includes(l))
  if (unknown.length) return fail(res, 400, `Unknown target language: ${unknown.join(', ')}.`)

  const wasRescanning = rescanning
  let resetCount = 0
  let modCount = 0
  // Ein eigener Speicherpunkt für den ganzen Reset — so lässt er sich über
  // "Restore Backup" gezielt rückgängig machen.
  const resetStamp = freshStamp(BACKUP_ROOT)
  try {
    for (const mod of cache.mods) {
      let modChanged = false
      for (const { version, file } of sourceFilesOf(mod).values()) {
        for (const lang of langs) {
          const changed = resetToGame(mod, version, file, lang, BACKUP_ROOT, WORK_ROOT, resetStamp)
          if (changed > 0) {
            resetCount += changed
            modChanged = true
          }
        }
      }
      if (modChanged) modCount += 1
    }
  } catch (err) {
    return fail(res, err.status || 500, classifyFsError(err, WORK_ROOT).message)
  }
  rescanThen(wasRescanning, () => res.json({ resetCount, modCount }))
})

// --- Speicherpunkte ("Restore Backup" in Settings) ---
// Liste neueste zuerst. Alte Punkte aus der Zeit, als die App noch in
// Spiel/Workshop schrieb, sind nicht wiederherstellbar (s. server/backups.js).
app.get('/api/backups', (req, res) => {
  res.json({ backups: listBackups(BACKUP_ROOT, WORK_ROOT) })
})

// Spielt einen Punkt zurück — nur in den Arbeitsordner (s. backups.js). Gibt es
// einen Cache, spiegelt ein Rescan danach die Disk wie nach jedem PUT.
app.post('/api/backups/:id/restore', (req, res) => {
  const wasRescanning = rescanning
  let result
  try {
    result = restoreBackup(BACKUP_ROOT, req.params.id, WORK_ROOT)
  } catch (err) {
    return fail(res, err.status || 500, classifyFsError(err, BACKUP_ROOT).message)
  }
  if (!cache) return res.json(result)
  rescanThen(wasRescanning, () => res.json(result))
})

app.put('/api/mods/:modId/entries', (req, res) => {
  const mod = getMod(res, req.params.modId)
  if (!mod) return
  const cfg = config.load()
  const body = req.body || {}
  const lang = langOf(body.lang, cfg.activeLang)
  if (!cfg.targetLangs.includes(lang)) return fail(res, 400, `Unknown target language: ${lang}.`)
  const wasRescanning = rescanning
  let result
  try {
    result = saveBatch(mod, body.entries, lang, BACKUP_ROOT, WORK_ROOT)
  } catch (err) {
    return fail(res, err.status || 500, classifyFsError(err, WORK_ROOT).message)
  }
  // rescan spiegelt die Disk in den Cache — wird GEMACHT, damit der Client
  // den frischen Cache direkt nach dem Speichern liest (vorher: Rescan lief
  // im Hintergrund und der Editor las für ~1 s alte Werte). War zu Beginn
  // des PUTs ein rescan aktiv, ist sein Snapshot (start < PUT-Schreib)
  // veraltet — danach erneut einspielen.
  rescanThen(wasRescanning, () => res.json(result))
})

// --- Config ---
app.get('/api/config', (req, res) => {
  res.json(config.load())
})

app.post('/api/config', (req, res) => {
  const body = req.body || {}
  const errors = config.validate(body)
  if (errors.length) return fail(res, 400, errors.join(' '))
  const before = config.load()
  const saved = config.save(body)
  // Der Cache hält Übersetzungen nur für die Sprachen, mit denen zuletzt
  // gescannt wurde — ändert sich die Menge der targetLangs oder WO gesucht
  // wird (gameRoot/workshopDir), ist er ungültig. Verwerfen statt
  // stillschweigend veraltet lassen: GET /api/mods liefert danach 404 ("kein
  // Scan"), worauf die Mods-Seite automatisch neu scannt. Ein reiner
  // activeLang-Wechsel ändert weder targetLangs noch die Wurzeln und darf den
  // Cache deshalb NIE verwerfen — das ist der ganze Sinn von
  // POST /api/active-lang.
  if (
    !sameLangSet(saved.targetLangs, before.targetLangs) ||
    saved.gameRoot !== before.gameRoot ||
    saved.workshopDir !== before.workshopDir
  ) {
    // Gab es schon einen Scan, läuft der neue automatisch im Hintergrund —
    // der Nutzer muss nicht selbst neu suchen.
    const hadScan = cache !== null
    cache = null
    if (hadScan && !scanRunning) startScan()
  }
  res.json(saved)
})

// --- LLM-Export / -Import ---
// Export bündelt alle ausgewählten Mods in EINE Datei (JSON-String); die
// Frontend lädt sie über den Browser-Save-Dialog herunter — es wird NICHTS auf
// die Disk geschrieben.
app.post('/api/export/llm', (req, res) => {
  const body = req.body || {}
  const selection = exportSelection(body, res)
  if (!selection) return
  const { mods, targetLangs } = selection
  try {
    // Optionaler Freitext des Nutzers als Kontext für die KI (gekürzt).
    const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 2000) : ''
    const result = llm.exportLlmBundle(mods, config.SOURCE_LANG, targetLangs, { notes })
    res.json(result)
  } catch (err) {
    fail(res, err.status || 500, err.message || 'LLM export failed.')
  }
})

// Import: die Frontend sendet den Text einer einzigen Datei (aus dem
// Browser-Open-Dialog) im Body als { text }. Preview teilt sich mit dem Export
// die Normalisierung (neues translations-Format / alte Bundle-/Mod-Docs-Form).
function importDocsOf(body) {
  return llm.normalizeImportInput(body && body.text)
}

// Liefert zusätzlich `matches` (rekonstruierte entryIds + Übersetzung + Sprache)
// — es gibt bewusst keine /apply-Route mehr: der Import schreibt nichts auf die
// Platte, die Frontend übernimmt `matches` als dirty Einträge (s. llm-io.js).
//
// Sprachen, die in der hochgeladenen Datei auftauchen, aber NICHT konfiguriert
// sind (nicht in cfg.targetLangs), dürfen nicht in `matches` landen — der
// Editor könnte sie nie anzeigen oder speichern, sie wären unsichtbarer
// Ballast im "Zu Prüfen"-Status. Sie werden vor importPreview() herausgefiltert
// und stattdessen als `unknownLangs` gemeldet. Der leere Sprach-Key "" (Alt-
// format ohne erkannte Sprache) wird auf activeLang abgebildet — activeLang
// ist per Konstruktion immer in targetLangs enthalten, taucht deshalb nie in
// unknownLangs auf.
app.post('/api/import/llm/preview', (req, res) => {
  const { docsByLang, error, detectedTargetLangs } = importDocsOf(req.body)
  if (error) return fail(res, 400, error)
  const mods = cache ? cache.mods : []
  const cfg = config.load()

  const knownDocsByLang = {}
  const unknownLangs = []
  for (const [langKey, docs] of Object.entries(docsByLang)) {
    const effectiveLang = langKey === '' ? cfg.activeLang : langKey
    if (!cfg.targetLangs.includes(effectiveLang)) {
      unknownLangs.push(effectiveLang)
      continue
    }
    knownDocsByLang[langKey] = docs
  }

  const preview = llm.importPreview(knownDocsByLang, mods, cfg.activeLang, config.SOURCE_LANG)
  res.json({ ...preview, detectedTargetLangs, unknownLangs })
})

// --- Mod-Export ---
// Alle ausgewählten Mods werden in EINE installierbare Mod gebündelt (ein
// Ordner, der ALLE ausgewählten Sprachen enthält — je Sprache ein eigener
// Sprachordner, s. mod-export.js). Die Routenform bleibt: { modIds, targetDir,
// targetLangs } → { targetLangs, targetDir, results } (results enthält genau
// das eine Bundle).
app.post('/api/export/mod', (req, res) => {
  const body = req.body || {}
  const targetDir = body.targetDir && typeof body.targetDir === 'string' ? body.targetDir : MOD_EXPORT_DEFAULT
  const selection = exportSelection(body, res)
  if (!selection) return
  const { mods, targetLangs } = selection
  try {
    const result = exportModsBundle(mods, targetLangs, targetDir, config.SOURCE_LANG, WORK_ROOT)
    res.json({ targetLangs: result.targetLangs, targetDir: config.toPosix(targetDir), results: [result] })
  } catch (err) {
    fail(res, err.status || 500, err.message || 'Mod export failed.')
  }
})

// Export Mod als ZIP-Download (App.jsx, globaler "Export Mod"-Button): baut
// die Mod wie /api/export/mod (alle ausgewählten Sprachen in EINEM Mod) in
// einen frischen Temp-Ordner, packt ihn in eine ZIP (server/zip.js, kein
// externes Paket) und liefert sie als Binär-Antwort — der Browser übernimmt
// danach ganz normal "Speichern unter" (derselbe Mechanismus wie beim
// LLM-Export). Der Temp-Ordner ist nur ein Zwischenschritt und wird danach
// wieder gelöscht.
app.post('/api/export/mod/zip', (req, res) => {
  const body = req.body || {}
  const selection = exportSelection(body, res)
  if (!selection) return
  const { mods, targetLangs } = selection

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pt-export-'))
  try {
    const { targetPath } = exportModsBundle(mods, targetLangs, tmpRoot, config.SOURCE_LANG, WORK_ROOT)
    const files = collectFiles(targetPath, tmpRoot)
    const zipBuffer = buildZip(files)
    const zipName = path.basename(targetPath) + '.zip'
    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`)
    res.send(zipBuffer)
  } catch (err) {
    fail(res, err.status || 500, err.message || 'Mod export failed.')
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true })
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
  fail(res, err.status || 500, err.message || 'Unknown error.')
})

// Express 5 reicht Listen-Fehler (z. B. EADDRINUSE) an den Callback durch —
// ohne diese Prüfung stünde "API auf ..." im Log, obwohl nichts lauscht.
//
// Ausdrücklich 127.0.0.1 statt des Default (alle Interfaces, "::"): sonst
// kann jeder im selben LAN Backups zurückspielen, Übersetzungen ändern oder über /api/export/mod einen beliebigen targetDir
// beschreiben lassen. Auf Node 17+ löst "localhost" u. U. zuerst zu ::1 auf —
// deshalb binden wir auf die Adresse, nicht auf den Namen.
// Letzten Scan-Stand laden (falls er zu den aktuellen Einstellungen passt).
{
  const r = roots()
  cache = scanStore.load(SCAN_CACHE_FILE, { gameRoot: r.gameRoot, workshopDir: r.workshopDir, langs: config.load().targetLangs })
}

app.listen(PORT, '127.0.0.1', (err) => {
  if (err) {
    console.error(`API konnte Port ${PORT} nicht öffnen: ${err.message}`)
    process.exit(2)
  }
  const url = `http://127.0.0.1:${PORT}`
  console.log(`API auf ${url} (Fake: ${FAKE})`)
  // Nur das portable Paket setzt PT_OPEN_BROWSER; im Entwicklungsbetrieb
  // passiert hier nichts. Der Browser geht erst auf, wenn der Port wirklich
  // lauscht - vorher landet der Nutzer auf einer Fehlerseite.
  //
  // Bewusst explorer.exe statt eines versteckten `cmd /c start`: ein
  // unsichtbares Shell-Fenster, das eine weitere Anwendung startet, ist genau
  // das Muster, auf das Virenscanner-Heuristiken ansprechen.
  if (process.env.PT_OPEN_BROWSER === '1' && process.platform === 'win32') {
    try {
      spawn('explorer.exe', [url], { detached: true, stdio: 'ignore' }).unref()
    } catch {
      /* Browser oeffnen ist Komfort, kein Grund den Start abzubrechen */
    }
  }
})

module.exports = app
