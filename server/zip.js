// Minimaler ZIP-Writer (kein Store-only, DEFLATE via zlib) — bewusst ohne
// externes Paket (CLAUDE.md: "Keine neuen Pakete ohne Rückfrage"). Node hat
// mit `zlib.deflateRawSync` + `zlib.crc32` (seit Node 22/24) alles, was der
// ZIP-Standard (PKWARE APPNOTE) für ein simples, unverschlüsseltes,
// unsegmentiertes Archiv braucht: lokale Dateiheader + zentrales Verzeichnis
// + End-of-Central-Directory-Record.
'use strict'
const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')

function dosDateTime(date) {
  const dosTime =
    (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)
  const dosDate =
    (((date.getFullYear() - 1980) & 0x7f) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  return { dosTime, dosDate }
}

// entries: [{ name: 'posix/relative/path', data: Buffer }]
function buildZip(entries) {
  const now = dosDateTime(new Date())
  const localParts = []
  const centralParts = []
  let offset = 0

  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8')
    const crc = zlib.crc32(data)
    const deflated = zlib.deflateRawSync(data)
    const useDeflate = deflated.length < data.length
    const payload = useDeflate ? deflated : data
    const method = useDeflate ? 8 : 0

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0) // local file header signature
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0, 6) // flags
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(now.dosTime, 10)
    local.writeUInt16LE(now.dosDate, 12)
    local.writeUInt32LE(crc >>> 0, 14)
    local.writeUInt32LE(payload.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28) // extra field length
    localParts.push(local, nameBuf, payload)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0) // central directory header signature
    central.writeUInt16LE(20, 4) // version made by
    central.writeUInt16LE(20, 6) // version needed
    central.writeUInt16LE(0, 8) // flags
    central.writeUInt16LE(method, 10)
    central.writeUInt16LE(now.dosTime, 12)
    central.writeUInt16LE(now.dosDate, 14)
    central.writeUInt32LE(crc >>> 0, 16)
    central.writeUInt32LE(payload.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt16LE(0, 30) // extra field length
    central.writeUInt16LE(0, 32) // comment length
    central.writeUInt16LE(0, 34) // disk number start
    central.writeUInt16LE(0, 36) // internal attrs
    central.writeUInt32LE(0, 38) // external attrs
    central.writeUInt32LE(offset, 42) // relative offset of local header
    centralParts.push(central, nameBuf)

    offset += local.length + nameBuf.length + payload.length
  }

  const centralSize = centralParts.reduce((n, b) => n + b.length, 0)
  const centralOffset = offset

  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0) // end of central dir signature
  eocd.writeUInt16LE(0, 4) // disk number
  eocd.writeUInt16LE(0, 6) // disk with central dir
  eocd.writeUInt16LE(entries.length, 8) // entries on this disk
  eocd.writeUInt16LE(entries.length, 10) // total entries
  eocd.writeUInt32LE(centralSize, 12)
  eocd.writeUInt32LE(centralOffset, 16)
  eocd.writeUInt16LE(0, 20) // comment length

  return Buffer.concat([...localParts, ...centralParts, eocd])
}

// Rekursiv alle Dateien unter `root` einsammeln, mit POSIX-Pfaden relativ zu
// `baseDir` (üblicherweise der Elternordner von `root`, damit die ZIP beim
// Entpacken den Mod-Ordner selbst enthält).
function collectFiles(root, baseDir) {
  const out = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile()) {
        const rel = path.relative(baseDir, full).split(path.sep).join('/')
        out.push({ name: rel, data: fs.readFileSync(full) })
      }
    }
  }
  walk(root)
  return out
}

module.exports = { buildZip, collectFiles }
