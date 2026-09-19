// Schreibschutz für Spiel- und Workshop-Ordner.
//
// Die App liest dort nur. Jede Stelle, die Dateien schreibt (Speichern, Reset,
// Restore, Mod-Export), ruft assertWritable() mit dem Zielpfad auf; liegt der
// Pfad in einer geschützten Wurzel, bricht sie mit einem Fehler ab. Das ist ein
// zweites Netz unter dem Design (Arbeitsordner statt Schreiben im Spiel) —
// falls ein künftiger Fehler doch einen Spielpfad erwischt.
const path = require('node:path')

// Liefert die aktuellen Wurzeln: () => [gameRoot, workshopDir]. index.js setzt
// sie beim Start (die Config kann sich zur Laufzeit ändern, darum ein Getter).
let rootsProvider = () => []

function setProtectedRoots(provider) {
  rootsProvider = provider
}

function norm(p) {
  const r = path.resolve(String(p))
  return process.platform === 'win32' ? r.toLowerCase() : r
}

function isInside(root, target) {
  const rel = path.relative(norm(root), norm(target))
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

// Wirft (403), wenn target in Spiel- oder Workshop-Ordner liegt.
function assertWritable(target) {
  for (const root of rootsProvider()) {
    if (root && isInside(root, target)) {
      throw Object.assign(
        new Error('Refusing to write into the game or workshop folder. Project Translate only reads there.'),
        { status: 403, _classified: true }
      )
    }
  }
}

module.exports = { setProtectedRoots, assertWritable, isInside }
