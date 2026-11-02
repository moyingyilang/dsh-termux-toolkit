/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
/**
 * Local release build, in the same spirit as the JMNeXt desktop packaging:
 * assemble one directory per platform-architecture on the building host, verify
 * what can be verified structurally, and state what was not run.
 */
import { createHash } from 'node:crypto'
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

/** ELF `e_machine` values for the architectures this toolkit can report on. */
const ELF_MACHINES = new Map([
  [0x28, 'arm'],
  [0x3e, 'x86-64'],
  [0xb7, 'aarch64'],
])

/** Toolkit root, from this module's location. */
const TOOLKIT_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

/** Files and directories that make up the published toolkit. */
const SHIPPED = ['bin', 'src', 'docs', 'package.json', 'README.md', 'README.zh.md', 'LICENSE']

/**
 * Read one ELF file's class and machine.
 * @param path Absolute file path.
 * @returns `{ bits, machine, name }`, or `undefined` for a non-ELF file.
 */
export function elfMachine(path) {
  const header = readFileSync(path)
  if (header.length < 20 || header[0] !== 0x7f || header[1] !== 0x45 || header[2] !== 0x4c || header[3] !== 0x46) {
    return undefined
  }
  const machine = header.readUInt16LE(18)
  return { bits: header[4] === 2 ? 64 : 32, machine, name: ELF_MACHINES.get(machine) ?? `unknown:0x${machine.toString(16)}` }
}

/** Architecture name this Node build reports, in ELF terms. */
function expectedMachine() {
  return { arm64: 'aarch64', x64: 'x86-64', arm: 'arm' }[process.arch] ?? process.arch
}

/**
 * Digest one file.
 * @param path Absolute path.
 * @returns Lowercase hex SHA-256.
 */
function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/**
 * Every regular file below a directory, as paths relative to it.
 * @param directory Absolute directory.
 * @returns POSIX relative paths, sorted.
 */
function walk(directory) {
  const files = []
  const visit = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) visit(path)
      else files.push(relative(directory, path))
    }
  }
  visit(directory)
  return files
}

/**
 * Build one release directory for the host platform and architecture.
 *
 * The toolkit itself is architecture-independent; the only compiled piece is
 * the Android flock binding, and it is included only when the checkout has one.
 * @param root DeepSeek Harness checkout the binding is read from.
 * @param options Output directory and progress sink.
 * @returns `{ directory, version, binding, files }` describing the artifact.
 */
export function releaseBundle(root, options = {}) {
  const log = options.log ?? console.log
  const out = options.out ?? join(TOOLKIT_ROOT, 'dist')
  const version = JSON.parse(readFileSync(join(TOOLKIT_ROOT, 'package.json'), 'utf8')).version
  const label = `${process.platform}-${process.arch}`
  const directory = join(out, `${label}-${version}`)
  mkdirSync(directory, { recursive: true })

  for (const entry of SHIPPED) {
    const source = join(TOOLKIT_ROOT, entry)
    if (!existsSync(source)) continue
    cpSync(source, join(directory, entry), { recursive: statSync(source).isDirectory() })
  }

  const bindingSource = join(root, 'native/system/node_modules/@deepseek-ai', `node-addon-system-android-${process.arch}`, 'bin/system.node')
  let binding
  if (existsSync(bindingSource)) {
    const elf = elfMachine(bindingSource)
    const expected = expectedMachine()
    if (elf === undefined) throw new Error(`release: ${bindingSource} is not an ELF binary`)
    if (elf.name !== expected) {
      throw new Error(`release: ${basename(bindingSource)} is ${elf.name}, expected ${expected} for ${process.arch}`)
    }
    mkdirSync(join(directory, 'native/flock'), { recursive: true })
    copyFileSync(bindingSource, join(directory, 'native/flock/system.node'))
    binding = { path: 'native/flock/system.node', elf: elf.name, bits: elf.bits, sha256: sha256(bindingSource) }
    log(`release: binding ${elf.name} ${String(elf.bits)}-bit`)
  } else {
    binding = undefined
    log('release: no compiled flock binding in the checkout; the archive is source-only')
  }

  const files = walk(directory).map((path) => ({
    path,
    bytes: statSync(join(directory, path)).size,
    sha256: sha256(join(directory, path)),
  }))
  const manifest = {
    name: 'dsh-termux-toolkit',
    version,
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    createdAt: new Date().toISOString(),
    binding,
    verification: binding === undefined
      ? 'No compiled binding in this artifact; run `dsh-termux build` on the target device.'
      : `ELF ${binding.elf} ${String(binding.bits)}-bit; not executed on other architectures.`,
    files,
  }
  writeFileSync(join(directory, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  writeFileSync(join(directory, 'checksums.txt'), `${files.map((file) => `${file.sha256}  ${file.path}`).join('\n')}\n`)
  return { directory, version, binding, files }
}
