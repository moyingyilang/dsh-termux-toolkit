/**
 * Resolve a pnpm build that can run on Android and run repository scripts with it.
 *
 * The checkout pins its package manager (`packageManager: pnpm@<version>`). pnpm
 * 10+ satisfies that pin by switching to the `@pnpm/exe` standalone binary, which
 * publishes no android-arm64 build, so the toolkit looks for the JavaScript
 * implementation instead and runs it with the current Node.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const MISSING_PNPM =
  'dsh-termux: pnpm is required to install and build the checkout. Install the JavaScript build:\n'
  + '    npm install -g pnpm@11.7.0'

/**
 * Read a manifest, tolerating a missing or malformed file.
 * @param path Absolute path.
 * @returns Parsed JSON, or `undefined`.
 */
function readManifest(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
}

/**
 * Read the pnpm version the checkout pins.
 * @param repo Checkout root.
 * @returns Pinned version, or `undefined` when the manifest does not pin pnpm.
 */
export function pinnedPnpmVersion(repo) {
  const manifest = readManifest(join(repo, 'package.json'))
  const field = typeof manifest?.packageManager === 'string' ? manifest.packageManager : ''
  return /^pnpm@(\d+\.\d+\.\d+)/.exec(field)?.[1]
}

/**
 * Global `node_modules` roots that may hold a JavaScript pnpm.
 * @returns Existing absolute directories, nearest candidate first.
 */
function npmRoots() {
  const roots = []
  if (process.env.DSH_TERMUX_NPM_ROOT !== undefined) roots.push(process.env.DSH_TERMUX_NPM_ROOT)
  const probe = spawnSync('npm', ['root', '-g'], { encoding: 'utf8' })
  if (probe.status === 0) roots.push(probe.stdout.trim())
  roots.push(join(dirname(process.execPath), '..', 'lib', 'node_modules'))
  roots.push(join(dirname(process.execPath), 'node_modules'))
  return [...new Set(roots)].filter((root) => root.length > 0 && existsSync(root))
}

/**
 * Probe a pnpm executable for its version, outside the checkout so the pin cannot
 * trigger a package-manager switch first.
 * @param command Executable or Node script to run.
 * @param prefixArgs Arguments before `--version`.
 * @returns Version string, or `undefined` when it cannot run.
 */
function probeVersion(command, prefixArgs) {
  const result = spawnSync(command, [...prefixArgs, '--version'], {
    cwd: tmpdir(),
    encoding: 'utf8',
    env: { ...process.env, pnpm_config_verify_deps_before_run: 'false' },
  })
  if (result.status !== 0) return undefined
  const line = `${result.stdout ?? ''}`.trim().split('\n').filter((entry) => entry.length > 0).pop() ?? ''
  return /^(\d+\.\d+\.\d+)$/.exec(line)?.[1]
}

/**
 * JavaScript pnpm builds installed on this host.
 * @returns `{ command, prefixArgs, version, source }` for each candidate.
 */
function candidates() {
  const found = []
  const explicit = process.env.DSH_TERMUX_PNPM
  if (explicit !== undefined) {
    const isScript = explicit.endsWith('.mjs') || explicit.endsWith('.cjs')
    const command = isScript ? process.execPath : explicit
    const prefixArgs = isScript ? [explicit] : []
    found.push({ command, prefixArgs, version: probeVersion(command, prefixArgs), source: 'DSH_TERMUX_PNPM' })
  }
  for (const root of npmRoots()) {
    for (const entry of ['pnpm.cjs', 'pnpm.mjs']) {
      const script = join(root, 'pnpm', 'bin', entry)
      if (!existsSync(script)) continue
      found.push({
        command: process.execPath,
        prefixArgs: [script],
        version: probeVersion(process.execPath, [script]),
        source: script,
      })
    }
  }
  const onPath = probeVersion('pnpm', [])
  if (onPath !== undefined) found.push({ command: 'pnpm', prefixArgs: [], version: onPath, source: 'PATH' })
  return found
}

/**
 * Resolve the pnpm build to drive the checkout.
 *
 * An exact match for the pinned version is required unless
 * `DSH_TERMUX_ALLOW_PNPM_MISMATCH=1` accepts another version.
 * @param repo Checkout root.
 * @returns `{ command, prefixArgs, version, source }`.
 */
export function resolvePnpm(repo) {
  const pinned = pinnedPnpmVersion(repo)
  const found = candidates().filter((candidate) => candidate.version !== undefined)
  if (pinned === undefined) {
    const fallback = found[0]
    if (fallback === undefined) throw new Error(MISSING_PNPM)
    return fallback
  }
  const exact = found.find((candidate) => candidate.version === pinned)
  if (exact !== undefined) return exact
  if (process.env.DSH_TERMUX_ALLOW_PNPM_MISMATCH === '1' && found[0] !== undefined) return found[0]
  const seen = found.length === 0
    ? 'none'
    : found.map((candidate) => `${String(candidate.version)} (${candidate.source})`).join(', ')
  throw new Error(
    `dsh-termux: the checkout pins pnpm@${pinned}, but no matching JavaScript pnpm was found (${seen}).\n`
    + '  Android has no @pnpm/exe binary, so install the JavaScript build once:\n'
    + `    npm install -g pnpm@${pinned}\n`
    + '  Then rerun this command. DSH_TERMUX_ALLOW_PNPM_MISMATCH=1 accepts another version.',
  )
}

/**
 * Run one pnpm command in the checkout.
 * @param repo Checkout root.
 * @param pnpm Resolved pnpm from {@link resolvePnpm}.
 * @param args Arguments after the executable.
 * @param options Extra environment for the child.
 * @returns The child's exit status; nonzero is returned, not thrown.
 */
export function runPnpm(repo, pnpm, args, options = {}) {
  const result = spawnSync(pnpm.command, [...pnpm.prefixArgs, ...args], {
    cwd: repo,
    stdio: 'inherit',
    env: { ...process.env, pnpm_config_verify_deps_before_run: 'false', ...options.env },
  })
  if (result.error !== undefined) throw result.error
  return result.status ?? 1
}
