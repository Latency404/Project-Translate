// Startet Vite (:5173) und die Express-API (:3100) parallel, ohne eigenes Paket.
const { spawn } = require('node:child_process')
const path = require('node:path')

const root = path.join(__dirname, '..')
const children = []

function killAll() {
  for (const c of children) {
    if (!c.killed) c.kill()
  }
}

const vite = spawn(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js')], {
  cwd: root,
  stdio: 'inherit'
})
children.push(vite)

const api = spawn(process.execPath, [path.join(root, 'server', 'index.js')], {
  cwd: root,
  stdio: 'inherit'
})
children.push(api)

process.on('SIGINT', () => {
  killAll()
  process.exit(0)
})
process.on('SIGTERM', () => {
  killAll()
  process.exit(0)
})

vite.on('exit', () => {
  killAll()
  process.exit(1)
})
api.on('exit', () => {
  killAll()
  process.exit(1)
})
