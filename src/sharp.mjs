/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
/**
 * Build sharp against the system libvips.
 *
 * sharp ships prebuilt binaries for darwin, linux (glibc and musl), and win32
 * only. On android-arm64 its loader falls back to a source build beside the
 * package, which needs a C++ toolchain and libvips headers; Termux provides
 * both through `pkg install libvips`.
 */
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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
 * Locate the installed sharp package below the checkout's pnpm store.
 * @param repo Checkout root.
 * @returns Absolute sharp package directory, or `undefined`.
 */
export function sharpPackageDir(repo) {
  const manifest = readManifest(join(repo, 'packages/attachment/attachment-local/package.json'))
  const range = manifest?.dependencies?.sharp
  if (typeof range !== 'string') return undefined
  const version = range.replace(/^[^0-9]*/, '')
  let entries
  try {
    entries = readdirSync(join(repo, 'node_modules/.pnpm'))
  } catch {
    return undefined
  }
  const store = entries.find((entry) => entry === `sharp@${version}` || entry.startsWith(`sharp@${version}_`))
  return store === undefined ? undefined : join(repo, 'node_modules/.pnpm', store, 'node_modules', 'sharp')
}

/**
 * Find the source-built binding sharp's loader prefers.
 * @param directory sharp package directory.
 * @returns Absolute binding path, or `undefined` when no local build exists.
 */
export function sharpBindingPath(directory) {
  const release = join(directory, 'src/build/Release')
  const version = readManifest(join(directory, 'package.json'))?.version
  if (typeof version !== 'string' || !existsSync(release)) return undefined
  const name = readdirSync(release).find((entry) => entry.startsWith('sharp-') && entry.endsWith(`-${version}.node`))
  return name === undefined ? undefined : join(release, name)
}

/**
 * Locate node-gyp's JavaScript entry, because the source build spawns it by name.
 * @param repo Checkout root.
 * @returns Absolute `node-gyp.js` path, or `undefined`.
 */
function findNodeGyp(repo) {
  try {
    for (const entry of readdirSync(join(repo, 'node_modules/.pnpm'))) {
      if (!entry.startsWith('node-gyp@')) continue
      const candidate = join(repo, 'node_modules/.pnpm', entry, 'node_modules/node-gyp/bin/node-gyp.js')
      if (existsSync(candidate)) return candidate
    }
  } catch {
    return undefined
  }
  return undefined
}

/**
 * Report whether the checkout can process images on this host.
 * @param repo Checkout root.
 * @returns `{ state, detail }` with state `ready`, `missing`, or `unsupported`.
 */
export function sharpStatus(repo) {
  const directory = sharpPackageDir(repo)
  if (directory === undefined) return { state: 'missing', detail: 'sharp is not installed' }
  const binding = sharpBindingPath(directory)
  if (binding !== undefined) return { state: 'ready', detail: binding }
  return { state: 'missing', detail: 'no local build; run `dsh-termux build` (needs libvips)' }
}

/**
 * Compile sharp against the system libvips when no local binding exists.
 * @param repo Checkout root.
 * @param options Force a rebuild, and a progress sink.
 * @returns `{ built, path?, reason? }` describing what happened.
 */
export function buildSharp(repo, options = {}) {
  const log = options.log ?? console.log
  const directory = sharpPackageDir(repo)
  if (directory === undefined) return { built: false, reason: 'sharp is not installed; run `dsh-termux build` with an install first' }
  const existing = sharpBindingPath(directory)
  if (existing !== undefined && options.force !== true) return { built: false, path: existing }

  const cpp = spawnSync('pkg-config', ['--modversion', 'vips-cpp'], { encoding: 'utf8' })
  if (cpp.error !== undefined || cpp.status !== 0) {
    return { built: false, reason: 'system libvips is missing; run `pkg install libvips` for image attachments' }
  }
  const nodeGyp = findNodeGyp(repo)
  if (nodeGyp === undefined) return { built: false, reason: 'node-gyp is not installed below the checkout' }

  const shimDir = mkdtempSync(join(tmpdir(), 'dsh-termux-gyp-'))
  const shim = join(shimDir, 'node-gyp')
  writeFileSync(shim, `#!/bin/sh\nexec "${process.execPath}" "${nodeGyp}" "$@"\n`)
  chmodSync(shim, 0o755)
  log(`sharp: building against libvips ${cpp.stdout.trim()}`)
  const result = spawnSync(process.execPath, ['install/build.js'], {
    cwd: directory,
    stdio: 'inherit',
    env: {
      ...process.env,
      PATH: `${shimDir}:${process.env.PATH ?? ''}`,
      SHARP_FORCE_GLOBAL_LIBVIPS: '1',
      npm_config_build_from_source: 'true',
    },
  })
  rmSync(shimDir, { recursive: true, force: true })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) return { built: false, reason: `sharp exited with ${String(result.status)}` }
  const built = sharpBindingPath(directory)
  if (built === undefined) return { built: false, reason: 'sharp reported success but produced no binding' }
  return { built: true, path: built }
}
