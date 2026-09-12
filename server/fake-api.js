// Fake-API: stellt für PT_FAKE=1 die Wurzel-Verzeichnisse bereit — server/fixtures/
// statt der Steam-Pfade. Die Routen in index.js bleiben identisch, nur die Wurzel
// wechselt. Damit arbeiten die Frontend-Slices ab 1.2 gegen die echte API-Form und
// der Tausch in Phase 2 ist eine Zeile.
const path = require('node:path')

// Wurzel-Ordner der Fake-API: server/fixtures/, optional per PT_FAKE_ROOT
// überschreibbar (Tests laufen auf einer eigenen Kopie).
const FIXTURES = process.env.PT_FAKE_ROOT || path.join(__dirname, 'fixtures')

function toPosix(p) {
  return String(p).replace(/\\/g, '/')
}

// Wurzel-Verzeichnisse der Fake-API (POSIX-Style).
function roots() {
  return {
    gameRoot: toPosix(path.join(FIXTURES, 'gameRoot')),
    workshopDir: toPosix(path.join(FIXTURES, 'workshop'))
  }
}

module.exports = { roots, toPosix, FIXTURES }
