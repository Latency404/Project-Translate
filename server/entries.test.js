// entries.js — Fehler-Klassifikation (2.2: Rechtefehler sauber im UI melden).
const test = require('node:test')
const assert = require('node:assert')
const { classifyFsError } = require('./entries')

function fsErr(code, msg, cause) {
  const e = new Error(msg || `${code}: test`)
  e.code = code
  if (cause) e.cause = cause
  return e
}

test('classifyFsError: EPERM → 403 + deutsche Nachricht mit Pfad', () => {
  const err = fsErr('EPERM', 'EPERM: operation not permitted, open \'C:\\mods\\DE\\UI.json\'')
  const out = classifyFsError(err, 'C:\\mods\\DE\\UI.json')
  assert.equal(out.status, 403)
  assert.match(out.message, /^Target folder not writable: C:\/mods\/DE\/UI\.json/)
})

test('classifyFsError: EACCES (in cause-Chain) → 403', () => {
  const inner = fsErr('EACCES', 'EACCES: permission denied')
  const outer = fsErr('ENOENT', 'wrapper', inner)
  const out = classifyFsError(outer, 'X:/a/b')
  assert.equal(out.status, 403)
  assert.match(out.message, /not writable/)
})

test('classifyFsError: ENOENT → 404', () => {
  const out = classifyFsError(fsErr('ENOENT', 'ENOENT: no such file'), 'X:/fehlend')
  assert.equal(out.status, 404)
  assert.match(out.message, /Folder not found/)
})

test('classifyFsError: ENOTDIR → 500', () => {
  const out = classifyFsError(fsErr('ENOTDIR', 'ENOTDIR'), 'X:/pfad')
  assert.equal(out.status, 500)
  assert.match(out.message, /directory layout/)
})

test('classifyFsError: ohne fs-Code → unverändert', () => {
  const err = Object.assign(new Error('entries missing'), { status: 400 })
  const out = classifyFsError(err, 'X:/y')
  assert.equal(out.status, 400)
  assert.equal(out.message, 'entries missing')
})

test('classifyFsError: vorhandener Status bleibt erhalten', () => {
  const err = Object.assign(new Error('ENOTDIR'), { status: 500, code: 'ENOTDIR' })
  const out = classifyFsError(err, 'X:/y')
  assert.equal(out.status, 500)
})
