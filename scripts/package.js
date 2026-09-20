// Baut das portable Release-Paket: ein Ordner, der ohne Installation laeuft.
//
// Ergebnis (release/, git-ignoriert):
//
//   ProjectTranslate-<version>/
//     Start Project Translate.cmd   Doppelklick startet alles
//     README.txt
//     runtime/node.exe              mitgelieferte Node-Laufzeit
//     app/                          server/, dist/, express
//     (config.json und export/ legt die App beim ersten Start hier an)
//
// ... und dieselbe Struktur als ZIP daneben. Gezippt wird mit server/zip.js,
// dem projekteigenen Writer - kein zusaetzliches Paket.
//
// Aufruf: npm run package
const fs = require('node:fs')
const path = require('node:path')
const { execSync } = require('node:child_process')
const { buildZip, collectFiles } = require('../server/zip')

const ROOT = path.join(__dirname, '..')
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const NAME = `ProjectTranslate-${pkg.version}`
const RELEASE = path.join(ROOT, 'release')
const OUT = path.join(RELEASE, NAME)
const APP = path.join(OUT, 'app')

// npm ueber die Shell aufrufen: unter Windows ist npm eine .cmd, die
// execFileSync seit Node 20 nicht mehr direkt startet. Die Befehle sind feste
// Zeichenketten, es kommt nichts von aussen hinein.
function log(msg) {
  console.log(msg)
}

// Kopiert einen Ordner rekursiv; `skip(relativerPfad, name)` laesst Dateien aus.
function copyDir(src, dest, skip = () => false) {
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name)
    const to = path.join(dest, entry.name)
    if (skip(path.relative(ROOT, from).split(path.sep).join('/'), entry.name)) continue
    if (entry.isDirectory()) copyDir(from, to, skip)
    else if (entry.isFile()) fs.copyFileSync(from, to)
  }
}

// 1. Oberflaeche bauen (dist/), damit das Paket nie einen alten Stand mitnimmt.
log('1/6  Oberflaeche bauen (vite build)')
execSync('npm run build', { cwd: ROOT, stdio: 'inherit' })

// 2. Frischer Zielordner.
log(`2/6  Zielordner ${path.relative(ROOT, OUT)}`)
fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(APP, { recursive: true })

// 3. App kopieren. Tests und Test-Hilfen bleiben draussen; server/fixtures
//    bleibt drin, damit PT_FAKE=1 auch im Paket funktioniert (44 KB).
log('3/6  server/ und dist/ kopieren')
copyDir(path.join(ROOT, 'server'), path.join(APP, 'server'), (rel, name) =>
  name.endsWith('.test.js') || name === 'fixtures-inject.js'
)
copyDir(path.join(ROOT, 'dist'), path.join(APP, 'dist'))

// package.json ohne devDependencies und ohne Skripte, die im Paket nichts
// nuetzen - npm install --omit=dev braucht nur den dependencies-Block.
const appPkg = {
  name: pkg.name,
  version: pkg.version,
  private: true,
  description: pkg.description,
  engines: pkg.engines,
  dependencies: pkg.dependencies
}
fs.writeFileSync(path.join(APP, 'package.json'), JSON.stringify(appPkg, null, 2) + '\n', 'utf8')

// 4. Laufzeit-Abhaengigkeiten (nur express) in den Zielordner installieren.
log('4/6  Laufzeit-Abhaengigkeiten installieren (npm install --omit=dev)')
execSync('npm install --omit=dev --no-audit --no-fund --silent', { cwd: APP, stdio: 'inherit' })
fs.rmSync(path.join(APP, 'package-lock.json'), { force: true })

// 5. Node-Laufzeit mitliefern. process.execPath ist die node.exe, mit der
//    dieses Skript laeuft - unter Windows eine in sich geschlossene Datei.
log('5/6  Node-Laufzeit mitliefern')
fs.mkdirSync(path.join(OUT, 'runtime'), { recursive: true })
fs.copyFileSync(process.execPath, path.join(OUT, 'runtime', path.basename(process.execPath)))

// Startdatei. CRLF, weil cmd.exe das erwartet. Die App legt config.json und
// export/ neben die Startdatei statt nach app/ - dort findet der Nutzer sie.
const cmd = [
  '@echo off',
  'setlocal',
  'cd /d "%~dp0"',
  'set "PT_CONFIG_PATH=%~dp0config.json"',
  'set "PT_EXPORT_ROOT=%~dp0export"',
  'echo Project Translate is starting...',
  'echo Close this window to stop it.',
  'echo.',
  'start "" /b cmd /c "timeout /t 2 /nobreak >nul & start "" http://127.0.0.1:3100"',
  '"%~dp0runtime\node.exe" "%~dp0app\server\index.js"',
  'echo.',
  'echo Project Translate has stopped.',
  'pause'
].join('\r\n') + '\r\n'
fs.writeFileSync(path.join(OUT, 'Start Project Translate.cmd'), cmd, 'utf8')

const readme = [
  `Project Translate ${pkg.version}`,
  '',
  'Translate Project Zomboid B42 mods and the base game, then build an',
  'installable translation mod.',
  '',
  'HOW TO RUN',
  '  Double-click "Start Project Translate.cmd".',
  '  Your browser opens at http://127.0.0.1:3100.',
  '  Close the black console window to stop the tool.',
  '',
  'NOTHING TO INSTALL',
  '  The Node runtime is included in runtime\. Nothing is written outside',
  '  this folder.',
  '',
  'YOUR FILES',
  '  config.json   your settings (created on first start)',
  '  export\work   your translations',
  '  export\mods   the translation mods you build',
  '  export\backups  restore points',
  '  Keep this folder when you update - copy in the new version and keep',
  '  config.json and export\.',
  '',
  'GAME FOLDERS ARE READ-ONLY',
  '  The tool only reads your Project Zomboid and Workshop folders. It never',
  '  writes there. To use a translation, export it as a mod and install that.',
  '',
  'REQUIREMENTS',
  '  Windows, Project Zomboid B42.',
  '',
  `Author: Latency404`
].join('\r\n') + '\r\n'
fs.writeFileSync(path.join(OUT, 'README.txt'), readme, 'utf8')

// 6. ZIP daneben legen (projekteigener Writer, s. server/zip.js).
log('6/6  ZIP schreiben')
const zipPath = path.join(RELEASE, `${NAME}.zip`)
fs.writeFileSync(zipPath, buildZip(collectFiles(OUT, RELEASE)))

const mb = (p) => (fs.statSync(p).size / 1024 / 1024).toFixed(1)
log('')
log(`Fertig: ${path.relative(ROOT, OUT)}`)
log(`        ${path.relative(ROOT, zipPath)} (${mb(zipPath)} MB)`)
