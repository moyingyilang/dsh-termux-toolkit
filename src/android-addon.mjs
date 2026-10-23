/** Build and locate the Android flock binding the patched entry resolves. */
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** Repository-relative path of the binding entry for an architecture. */
function addonDirectory(root, arch) {
  return join(root, 'native/system/node_modules/@deepseek-ai', `node-addon-system-android-${arch}`)
}

/**
 * Path the patched flock entry loads on this host.
 * @param root Checkout root.
 * @param arch Host architecture, defaulting to the running one.
 * @returns Absolute path of `bin/system.node`.
 */
export function addonPath(root, arch = process.arch) {
  return join(addonDirectory(root, arch), 'bin', 'system.node')
}

/**
 * Whether a compiled binding is present.
 * @param root Checkout root.
 * @returns True when the entry would find a binding.
 */
export function addonPresent(root) {
  return existsSync(addonPath(root))
}

/**
 * Resolve Node's development headers for the running interpreter.
 * @param override Header directory passed on the command line, if any.
 * @returns Absolute header directory that contains `node_api.h`.
 */
export function resolveHeaders(override) {
  const candidates = []
  if (override !== undefined) candidates.push(override)
  if (process.env.DSH_TERMUX_NODE_HEADERS !== undefined) candidates.push(process.env.DSH_TERMUX_NODE_HEADERS)
  candidates.push(join(dirname(process.execPath), '..', 'include', 'node'))
  candidates.push('/usr/include/node')
  for (const candidate of candidates) if (existsSync(join(candidate, 'node_api.h'))) return candidate
  throw new Error(
    'dsh-termux: no Node-API headers found; install the matching node headers or pass --headers',
  )
}

/**
 * Compile the checked-in flock binding into the platform package the entry resolves.
 *
 * The compile writes beside the destination and renames, so a failed build never
 * leaves a truncated addon for the next start to dlopen.
 * @param root Checkout root.
 * @param options Compiler, header directory, and whether to rebuild unconditionally.
 * @returns Whether a compile ran and the binding path.
 */
export function compileAddon(root, options = {}) {
  const arch = options.arch ?? process.arch
  const source = join(root, 'native/system/packages/entry/src/flock.c')
  const headers = resolveHeaders(options.headers)
  const directory = addonDirectory(root, arch)
  const output = addonPath(root, arch)
  const cc = options.cc ?? process.env.DSH_TERMUX_CC ?? 'cc'
  if (!options.force && existsSync(output) && statSync(output).mtimeMs >= statSync(source).mtimeMs) {
    return { compiled: false, path: output }
  }
  mkdirSync(dirname(output), { recursive: true })
  const manifest = join(directory, 'package.json')
  if (!existsSync(manifest)) {
    writeFileSync(manifest, `${JSON.stringify({
      name: `@deepseek-ai/node-addon-system-android-${arch}`,
      version: readEntryVersion(root),
      private: true,
      os: ['android'],
      cpu: [arch],
    }, null, 2)}\n`)
  }
  const temporary = `${output}.build-${String(process.pid)}`
  const result = spawnSync(cc, [
    '-std=c11', '-O2', '-Wall', '-Wextra', '-Werror', '-fPIC', '-fvisibility=hidden',
    '-DNAPI_VERSION=8', '-I', headers, '-shared', '-o', temporary, source,
  ], { stdio: 'inherit' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`dsh-termux: ${cc} exited with ${String(result.status)} while building ${source}`)
  }
  renameSync(temporary, output)
  return { compiled: true, path: output }
}

/**
 * Read the entry package version the generated platform package should mirror.
 * @param root Checkout root.
 * @returns Version string, or `0.0.0` when the manifest is unreadable.
 */
function readEntryVersion(root) {
  try {
    const manifest = JSON.parse(readFileSync(join(root, 'native/system/packages/entry/package.json'), 'utf8'))
    return String(manifest.version ?? '0.0.0')
  } catch {
    return '0.0.0'
  }
}

/**
 * Load the binding the way the patched entry does.
 * @param root Checkout root.
 * @returns `{ ok: true }` or `{ ok: false, error }` from the dlopen attempt.
 */
export function probeAddon(root) {
  const require = createRequire(import.meta.url)
  try {
    require(addonPath(root))
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
