/** Locate and describe the DeepSeek Harness checkout the toolkit patches. */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const CHECKOUT_MARKERS = [
  'package.json',
  'apps/cli/package.json',
  'native/system/packages/entry/src/flock.ts',
  'packages/boot/app-boot/src/profile-resolution/resolver.ts',
]

/**
 * Read a package manifest.
 * @param path Absolute path to a `package.json`.
 * @returns Parsed manifest fields the toolkit reads.
 */
export function readManifest(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

/**
 * Whether a directory is a DeepSeek Harness checkout the patches target.
 * @param directory Candidate directory.
 * @returns True when every marker exists and the root package is a dsh root.
 */
export function isCheckout(directory) {
  if (!CHECKOUT_MARKERS.every((marker) => existsSync(join(directory, marker)))) return false
  const manifest = readManifest(join(directory, 'package.json'))
  return typeof manifest.name === 'string' && manifest.name.startsWith('@deepseek-ai/')
}

/**
 * Candidate directories from the working directory upward.
 * @param start Directory to start from.
 * @returns Absolute ancestor directories, nearest first.
 */
function ancestors(start) {
  const result = []
  let current = resolve(start)
  for (;;) {
    result.push(current)
    const parent = dirname(current)
    if (parent === current) return result
    current = parent
  }
}

/**
 * Resolve the checkout to patch.
 *
 * Order: `--repo`, `DSH_TERMUX_REPO`, the working directory and its ancestors,
 * then `~/deepseek-harness`. The first checkout found wins, so running the
 * toolkit inside a harness tree needs no argument.
 * @param explicit Repository passed on the command line, if any.
 * @returns Absolute checkout path.
 */
export function locateRepo(explicit) {
  const candidates = []
  if (explicit !== undefined) candidates.push(resolve(explicit))
  else {
    if (process.env.DSH_TERMUX_REPO !== undefined) candidates.push(resolve(process.env.DSH_TERMUX_REPO))
    candidates.push(...ancestors(process.cwd()))
    candidates.push(join(homedir(), 'deepseek-harness'))
  }
  for (const candidate of candidates) if (isCheckout(candidate)) return candidate
  throw new Error(
    explicit !== undefined || process.env.DSH_TERMUX_REPO !== undefined
      ? `dsh-termux: ${String(explicit ?? process.env.DSH_TERMUX_REPO)} is not a DeepSeek Harness checkout`
      : 'dsh-termux: no DeepSeek Harness checkout found; pass --repo or set DSH_TERMUX_REPO',
  )
}

/**
 * Describe a checkout: version, pinned package manager, and build artifacts.
 * @param root Checkout root.
 * @returns Facts the doctor report prints.
 */
export function describeRepo(root) {
  const manifest = readManifest(join(root, 'package.json'))
  return {
    root,
    version: String(manifest.version ?? 'unknown'),
    packageManager: String(manifest.packageManager ?? 'unpinned'),
    built: existsSync(join(root, 'apps/cli/lib/bin.js')),
  }
}
