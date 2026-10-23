/**
 * Start the patched Web UI with the flags the Android build needs.
 *
 * The launcher passes `--expose-internals`, which the resolver fallback patch
 * relies on, and keeps the instance's state in its own DSH_HOME so it never
 * shares sessions with an npm-installed dsh.
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { createConnection } from 'node:net'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { addonPresent, compileAddon } from './android-addon.mjs'
import { verifyPatches } from './patch-engine.mjs'
import { patches } from './patches/index.mjs'

/** Default listen port of the source build. */
export const DEFAULT_PORT = 3081

/**
 * Whether something already accepts TCP connections on the port.
 * @param port Listen port.
 * @returns True when a listener answers.
 */
export function isServing(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: '127.0.0.1' })
    socket.setTimeout(1500)
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('timeout', () => {
      socket.destroy()
      resolve(false)
    })
    socket.once('error', () => resolve(false))
  })
}

/**
 * Pids of this checkout's Web instances listening on a port.
 * @param port Listen port.
 * @returns Process ids; empty when the port belongs to something else.
 */
export function ownersOf(port) {
  const owners = []
  let entries
  try {
    entries = readdirSync('/proc')
  } catch {
    return owners
  }
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue
    let args
    try {
      args = readFileSync(`/proc/${entry}/cmdline`, 'utf8').split('\0').filter((part) => part.length > 0)
    } catch {
      continue
    }
    if (!args.some((argument) => argument.endsWith('apps/cli/lib/bin.js'))) continue
    const portIndex = args.indexOf('--port')
    if (portIndex === -1 || args[portIndex + 1] !== String(port)) continue
    if (!args.includes('web')) continue
    owners.push(Number(entry))
  }
  return owners
}

/**
 * Signal the instances owning a port and wait for the listener to disappear.
 * @param port Listen port.
 * @returns True when the port became free.
 */
async function stopOwners(port) {
  for (const pid of ownersOf(port)) {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      /* the instance already exited between the scan and the signal */
    }
  }
  for (let attempt = 0; attempt < 40; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 250))
    if (!(await isServing(port))) return true
  }
  return false
}

/**
 * Validate the checkout, then start the Web UI.
 * @param root Checkout root.
 * @param options Port, restart, DSH_HOME, and progress sink.
 * @returns The child's exit code.
 */
export async function startWeb(root, options = {}) {
  const log = options.log ?? console.log
  const missing = verifyPatches(root, patches)
  if (missing.length > 0) {
    throw new Error(`dsh-termux: the checkout is not patched\n  ${missing.join('\n  ')}\n  Run \`dsh-termux build\` first.`)
  }
  if (!existsSync(join(root, 'apps/cli/lib/bin.js'))) {
    throw new Error('dsh-termux: the checkout is not built; run `dsh-termux build` first')
  }
  if (!addonPresent(root)) {
    const addon = compileAddon(root, { headers: options.headers, cc: options.cc })
    log(`dsh-termux: compiled the flock binding ${addon.path}`)
  }

  const port = options.port ?? DEFAULT_PORT
  if (await isServing(port)) {
    const owners = ownersOf(port)
    if (options.restart !== true) {
      throw new Error(
        `dsh-termux: port ${port} already serves HTTP`
        + (owners.length > 0 ? ` (pid ${owners.join(', ')}); open its token URL or rerun with --restart` : '')
        + (owners.length === 0 ? '; another process owns the port, pick a free one' : ''),
      )
    }
    log(`dsh-termux: stopping pid ${owners.join(', ')} on port ${String(port)}`)
    if (!(await stopOwners(port))) throw new Error(`dsh-termux: port ${String(port)} is still held after 10s`)
  }

  const dshHome = options.dshHome ?? join(homedir(), '.dsh-src')
  log(`dsh-termux: DSH_HOME=${dshHome}`)
  log(`dsh-termux: node --expose-internals apps/cli/lib/bin.js web --port ${String(port)} --no-open`)
  const child = spawn(
    process.execPath,
    ['--expose-internals', 'apps/cli/lib/bin.js', 'web', '--port', String(port), '--no-open'],
    { cwd: root, stdio: 'inherit', env: { ...process.env, DSH_HOME: dshHome } },
  )
  const forward = (signal) => () => child.kill(signal)
  process.on('SIGINT', forward('SIGINT'))
  process.on('SIGTERM', forward('SIGTERM'))
  return new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve(signal === null ? code ?? 0 : 0))
  })
}
