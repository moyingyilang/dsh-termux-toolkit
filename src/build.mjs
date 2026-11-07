/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
/** Apply the source patches, install, build, and compile the Android binding. */
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { compileAddon } from './android-addon.mjs'
import { applyPatches, inspectPatches, verifyPatches } from './patch-engine.mjs'
import { buildSharp } from './sharp.mjs'
import { patches } from './patches/index.mjs'
import { resolvePnpm, runPnpm } from './pnpm.mjs'

/** Default heap cap for the sequential artifact build; the repository asks for 8192, which Android reclaims. */
export const DEFAULT_MEMORY_MB = 3072

/**
 * Append the heap size the TypeScript client build needs.
 * @param nodeOptions Existing `NODE_OPTIONS`, if any.
 * @param memoryMb Heap limit in MiB.
 * @returns `NODE_OPTIONS` carrying exactly one `--max-old-space-size`.
 */
export function withMemory(nodeOptions, memoryMb) {
  const kept = (nodeOptions ?? '').split(' ').filter((part) => part.length > 0 && !part.startsWith('--max-old-space-size'))
  return [...kept, `--max-old-space-size=${String(memoryMb)}`].join(' ')
}

/**
 * Patch the checkout, repairing anything a `git checkout` reverted.
 * @param root Checkout root.
 * @param log Progress sink; defaults to `console.log`.
 * @returns Patch ids that were applied.
 */
export function patchCheckout(root, log = console.log) {
  const inspections = inspectPatches(root, patches)
  for (const inspection of inspections) {
    log(`patch ${inspection.patch.id.padEnd(22)} ${inspection.state}`)
  }
  const { applied, kept } = applyPatches(root, patches)
  if (applied.length > 0) log(`applied: ${applied.join(', ')}`)
  if (kept.length > 0) log(`already applied: ${kept.join(', ')}`)
  return applied
}

/**
 * Run one child process in the checkout.
 * @param repo Checkout root.
 * @param command Executable.
 * @param args Arguments.
 * @param env Environment additions.
 * @returns Exit status; nonzero is thrown by the caller.
 */
function run(repo, command, args, env = {}) {
  const result = spawnSync(command, args, { cwd: repo, stdio: 'inherit', env: { ...process.env, ...env } })
  if (result.error !== undefined) throw result.error
  return result.status ?? 1
}

/**
 * Build the checkout's artifacts directly.
 *
 * The repository's own `build` script runs two 8 GiB TypeScript compilations and a
 * concurrent `build:check`. On a Termux device that budget is what the Android
 * low-memory killer reclaims, which takes the whole session down, so the toolkit
 * runs the artifact steps sequentially under one heap cap and leaves the check
 * pass to whoever wants it.
 * @param repo Checkout root.
 * @param pnpm Resolved pnpm.
 * @param options Heap cap, desktop bundle, and progress sink.
 * @returns Nothing; throws on the first failing step.
 */
export function buildArtifacts(repo, pnpm, options = {}) {
  const log = options.log ?? console.log
  const memoryMb = options.memoryMb ?? DEFAULT_MEMORY_MB
  const cap = `--max-old-space-size=${String(memoryMb)}`
  const tsc = join(repo, 'node_modules/typescript/bin/tsc')
  const steps = [
    ['compile referenced host projects', join(repo, 'node_modules/.bin/tsx'), ['scripts/compile-referenced-projects.ts', 'host-libraries']],
    [`tsc host (${cap})`, process.execPath, [cap, tsc, '-p', 'tsconfig.host.json']],
    [`tsc client (${cap})`, process.execPath, [cap, tsc, '-b', 'tsconfig.client.json']],
    ['bundle host', join(repo, 'node_modules/.bin/tsdown'), ['--config-loader', 'native', '--env.DSH_BUILD_FACE', 'host']],
    ['bundle client', join(repo, 'node_modules/.bin/tsdown'), ['--config-loader', 'native', '--env.DSH_BUILD_FACE', 'client']],
    ['build web', pnpm.command, [...pnpm.prefixArgs, 'run', 'build:web']],
  ]
  if (options.desktop === true) {
    steps.splice(4, 0, ['bundle desktop', pnpm.command, [...pnpm.prefixArgs, '--filter', '@deepseek-ai/dsh-desktop', 'run', 'bundle']])
  }
  for (const [label, command, args] of steps) {
    log(`build: ${label}`)
    const status = run(repo, command, args)
    if (status !== 0) throw new Error(`dsh-termux: ${label} exited with ${String(status)}`)
  }
  return { memoryMb }
}

/**
 * Install dependencies, build the checkout, and compile the flock binding.
 * @param root Checkout root.
 * @param options Command-line choices.
 * @returns Nothing; throws on the first failing step.
 */
export function buildRepo(root, options = {}) {
  const log = options.log ?? console.log
  const memoryMb = options.memoryMb ?? DEFAULT_MEMORY_MB
  patchCheckout(root, log)

  const pnpm = resolvePnpm(root)
  log(`pnpm ${String(pnpm.version)} (${pnpm.source})`)
  if (options.skipInstall !== true) {
    const installArgs = ['install', '--frozen-lockfile']
    if (options.scripts !== true) installArgs.push('--ignore-scripts')
    log(`pnpm ${installArgs.join(' ')}`)
    const status = runPnpm(root, pnpm, installArgs)
    if (status !== 0) throw new Error(`dsh-termux: pnpm install exited with ${String(status)}`)
  }

  const environment = { NODE_OPTIONS: withMemory(process.env.NODE_OPTIONS, memoryMb) }
  if (options.full === true || process.platform !== 'android') {
    log(`pnpm run build (${environment.NODE_OPTIONS})`)
    const status = runPnpm(root, pnpm, ['run', 'build'], { env: environment })
    if (status !== 0) throw new Error(`dsh-termux: pnpm run build exited with ${String(status)}`)
  } else {
    buildArtifacts(root, pnpm, { memoryMb, desktop: options.desktop === true, log })
  }

  const addon = compileAddon(root, { headers: options.headers, cc: options.cc, force: options.force })
  log(addon.compiled ? `flock binding ${addon.path}` : `flock binding ${addon.path} (up to date)`)

  const sharp = buildSharp(root, { log, force: options.force })
  if (sharp.built) log(`sharp binding ${sharp.path}`)
  else if (sharp.path !== undefined) log(`sharp binding ${sharp.path} (up to date)`)
  else log(`sharp: ${String(sharp.reason)}`)

  const missing = verifyPatches(root, patches)
  if (missing.length > 0) throw new Error(`dsh-termux: build lost a patch\n  ${missing.join('\n  ')}`)
  log('build complete: start with `dsh-termux start`')
}
