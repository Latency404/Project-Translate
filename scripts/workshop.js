// Baut aus dem Release-Paket ein fertiges Steam-Workshop-Item.
//
// Struktur nach dem Vorbild von <Zomboid>/Workshop/ModTemplate, die der
// Workshop-Upload im Spiel erwartet:
//
//   release/Workshop/ProjectTranslate/
//     workshop.txt                        Titel, Beschreibung, Tags
//     preview.png                         Vorschaubild im Workshop
//     Contents/mods/ProjectTranslate/
//       42/mod.info                       damit B42 das Item als Mod erkennt
//       42/poster.png
//       README.txt                        Anleitung + GitHub-Link
//       Start Project Translate.cmd       Starter (nutzt installiertes Node)
//       app/                              ohne runtime/node.exe: der Workshop
//                                         verbietet .exe/.dll/.bat/.sh/.so/.zip ...
//
// Der Ordner wird nach <Zomboid>/Workshop/ kopiert; hochgeladen wird er
// danach aus Project Zomboid heraus (Hauptmenue, Workshop).
//
// Texte mit Windows-Pfaden stehen in scripts/workshop-readme.txt, nicht hier:
// Backslashes in JS-Zeichenketten zu maskieren ist eine unnoetige Fehlerquelle.
//
// Aufruf: npm run workshop   (setzt npm run package voraus)
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const ITEM = 'ProjectTranslate'
const MOD_ID = 'ProjectTranslate'
const GITHUB = 'https://github.com/Latency404/Project-Translate'
const DESC =
  'Translate Project Zomboid B42 mods and the base game into your language, ' +
  'then build an installable translation mod.'

const SRC = path.join(ROOT, 'release', `ProjectTranslate-${pkg.version}`)
const OUT = path.join(ROOT, 'release', 'Workshop', ITEM)
const MOD = path.join(OUT, 'Contents', 'mods', MOD_ID)

if (!fs.existsSync(SRC)) {
  console.error(`Release-Paket fehlt: ${path.relative(ROOT, SRC)}`)
  console.error('Zuerst "npm run package" ausfuehren.')
  process.exit(1)
}

// Der Workshop lehnt diese Endungen ab (Upload-Fehler "Dateitypen nicht erlaubt").
const FORBIDDEN = new Set(['.exe', '.dll', '.bat', '.app', '.dylib', '.sh', '.so', '.zip'])
// Nicht ins Item: die Laufzeit (node.exe) und deren Pruefsummen.
const SKIP_TOP = new Set(['runtime', 'CHECKSUMS.txt'])

function copyDir(src, dest, top = true) {
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (top && SKIP_TOP.has(entry.name)) continue
    const from = path.join(src, entry.name)
    const to = path.join(dest, entry.name)
    if (entry.isDirectory()) copyDir(from, to, false)
    else if (entry.isFile()) fs.copyFileSync(from, to)
  }
}

function findForbidden(dir, found = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) findForbidden(p, found)
    else if (FORBIDDEN.has(path.extname(e.name).toLowerCase())) found.push(p)
  }
  return found
}

// Erstes vorhandenes Bild aus der Liste (erst Workshop/, dann server/assets/); null, wenn keins da ist.
function pickImage(names) {
  for (const n of names) {
    for (const dir of ['Workshop', path.join('server', 'assets')]) {
      const p = path.join(ROOT, dir, n)
      if (fs.existsSync(p)) return p
    }
  }
  return null
}

console.log(`1/4  Zielordner ${path.relative(ROOT, OUT)}`)
fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(path.join(MOD, '42'), { recursive: true })

console.log('2/4  App kopieren')
copyDir(SRC, MOD)

console.log('3/4  mod.info, workshop.txt, README')
fs.writeFileSync(
  path.join(MOD, '42', 'mod.info'),
  [
    'name=Project Translate',
    `id=${MOD_ID}`,
    `description=${DESC}`,
    'description=',
    'description=This is a tool, not a gameplay mod. It adds nothing to the game.',
    "description=The program is in this item's folder - see README.txt.",
    'poster=poster.png',
    ''
  ].join('\r\n'),
  'utf8'
)

const preview = pickImage(['project-translate-ad.png', 'project-translate-ad.jpg', 'project-translate-logo.png'])
if (preview) {
  fs.copyFileSync(preview, path.join(OUT, 'preview.png'))
  fs.copyFileSync(preview, path.join(MOD, '42', 'poster.png'))
  console.log(`     Vorschaubild: ${path.relative(ROOT, preview)}`)
} else {
  console.log('     WARNUNG: kein Vorschaubild in Workshop/ oder server/assets/ gefunden')
}

fs.writeFileSync(
  path.join(OUT, 'workshop.txt'),
  [
    'version=1',
    'title=Project Translate',
    `description=${DESC}`,
    'description=',
    'description=IMPORTANT: this is a standalone Windows program, not a gameplay mod.',
    "description=Subscribing does nothing in-game. To use it, open this item's folder",
    'description=and run "Start Project Translate.cmd". README.txt explains where to',
    'description=find that folder.',
    'description=',
    'description=Requires Node.js 22.2 or newer (free, from nodejs.org). If you would',
    'description=rather not install anything, download the self-contained version',
    'description=(Node included) from the GitHub releases page.',
    'description=',
    'description=Nothing is obfuscated and nothing is downloaded at run time; the start',
    'description=file is plain text you can read. The tool serves a page on 127.0.0.1',
    'description=so your browser can act as its window - your machine only.',
    'description=',
    `description=Source code and releases: ${GITHUB}`,
    'tags=Build 42;Misc',
    'visibility=public',
    ''
  ].join('\r\n'),
  'utf8'
)

// README aus der Vorlage, damit die Windows-Pfade darin unangetastet bleiben.
const readme = fs
  .readFileSync(path.join(__dirname, 'workshop-readme.txt'), 'utf8')
  .replaceAll('{VERSION}', pkg.version)
  .replaceAll('{GITHUB}', GITHUB)
fs.writeFileSync(path.join(MOD, 'README.txt'), readme, 'utf8')

// Startdatei fuer das Workshop-Item: nutzt das installierte Node statt node.exe.
fs.copyFileSync(path.join(__dirname, 'workshop-launcher.cmd'), path.join(MOD, 'Start Project Translate.cmd'))

const forbidden = findForbidden(OUT)
if (forbidden.length) {
  console.error('FEHLER: Dateien mit im Workshop verbotener Endung im Item:')
  for (const f of forbidden) console.error('  ' + path.relative(OUT, f))
  process.exit(1)
}

console.log('4/4  fertig')
let files = 0
let bytes = 0
;(function count(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) count(p)
    else {
      files++
      bytes += fs.statSync(p).size
    }
  }
})(OUT)

const target = ['%UserProfile%', 'Zomboid', 'Workshop'].join(path.sep)
console.log('')
console.log(`Workshop-Item: ${path.relative(ROOT, OUT)}`)
console.log(`               ${files} Dateien, ${(bytes / 1024 / 1024).toFixed(1)} MB`)
console.log('')
console.log(`Naechster Schritt: den Ordner ${ITEM} nach ${target} kopieren,`)
console.log('dann in Project Zomboid im Hauptmenue den Workshop-Upload starten.')
