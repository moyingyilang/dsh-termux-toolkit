/** Report whether this device and checkout can run the patched build. */
import { addonPath, addonPresent, probeAddon } from './android-addon.mjs'
import { inspectPatches } from './patch-engine.mjs'
import { patches } from './patches/index.mjs'
import { resolvePnpm } from './pnpm.mjs'
import { describeRepo } from './repo.mjs'

/**
 * Collect the facts the doctor prints.
 * @param root Checkout root.
 * @returns `{ lines, healthy }` where unhealthy means the checkout cannot run.
 */
export function doctor(root) {
  const repo = describeRepo(root)
  const lines = [
    `platform   ${process.platform}-${process.arch} (node ${process.version})`,
    `checkout   ${repo.root} ${repo.version}`,
    `build      ${repo.built ? 'apps/cli/lib/bin.js present' : 'not built: run `dsh-termux build`'}`,
  ]
  let healthy = true
  for (const inspection of inspectPatches(root, patches)) {
    if (inspection.state === 'unsupported') healthy = false
    lines.push(`patch      ${inspection.patch.id.padEnd(24)} ${inspection.state}`)
  }
  const binding = addonPath(root)
  if (addonPresent(root)) {
    const probe = probeAddon(root)
    if (!probe.ok) healthy = false
    lines.push(`flock      ${binding} ${probe.ok ? 'loads' : `fails: ${probe.error}`}`)
  } else {
    lines.push('flock      missing: run `dsh-termux build` or `dsh-termux patch` then build')
  }
  try {
    const pnpm = resolvePnpm(root)
    lines.push(`pnpm       ${String(pnpm.version)} (${pnpm.source})`)
  } catch (error) {
    lines.push(`pnpm       unavailable: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`)
  }
  if (process.platform !== 'android') {
    lines.push('note       not running on Android; the patches target android-arm64 only')
  }
  if (!repo.built || !addonPresent(root)) healthy = false
  return { lines, healthy }
}
