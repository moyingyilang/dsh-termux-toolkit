/** Apply the source patches, install, build, and compile the Android binding. */
import { compileAddon } from './android-addon.mjs'
import { applyPatches, inspectPatches, verifyPatches } from './patch-engine.mjs'
import { patches } from './patches/index.mjs'
import { resolvePnpm, runPnpm } from './pnpm.mjs'

/** Default heap the client compiler needs on a Termux device. */
export const DEFAULT_MEMORY_MB = 4096

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
  log(`pnpm run build (${environment.NODE_OPTIONS})`)
  const status = runPnpm(root, pnpm, ['run', 'build'], { env: environment })
  if (status !== 0) throw new Error(`dsh-termux: pnpm run build exited with ${String(status)}`)

  const addon = compileAddon(root, { headers: options.headers, cc: options.cc, force: options.force })
  log(addon.compiled ? `flock binding ${addon.path}` : `flock binding ${addon.path} (up to date)`)

  const missing = verifyPatches(root, patches)
  if (missing.length > 0) throw new Error(`dsh-termux: build lost a patch\n  ${missing.join('\n  ')}`)
  log('build complete: start with `dsh-termux start`')
}
