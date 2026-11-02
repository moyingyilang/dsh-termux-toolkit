import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { elfMachine, releaseBundle } from '../src/release.mjs'

/** Write a minimal ELF header to a scratch file. */
function elfFile(t, { bits = 64, machine = 0xb7 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-termux-elf-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const path = join(dir, 'system.node')
  const header = Buffer.alloc(20)
  header.write('\x7fELF', 0, 'latin1')
  header[4] = bits === 64 ? 2 : 1
  header.writeUInt16LE(machine, 18)
  writeFileSync(path, header)
  return path
}

test('elfMachine reports the class and machine', (t) => {
  assert.deepEqual(elfMachine(elfFile(t, { bits: 64, machine: 0xb7 })), { bits: 64, machine: 0xb7, name: 'aarch64' })
  assert.deepEqual(elfMachine(elfFile(t, { bits: 32, machine: 0x28 })), { bits: 32, machine: 0x28, name: 'arm' })
  assert.equal(elfMachine(elfFile(t, { machine: 0x3e })).name, 'x86-64')
})

test('elfMachine ignores non-ELF files', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-termux-elf-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const path = join(dir, 'notes.txt')
  writeFileSync(path, 'hello')
  assert.equal(elfMachine(path), undefined)
})

test('releaseBundle writes a manifest and checksums', (t) => {
  const out = mkdtempSync(join(tmpdir(), 'dsh-termux-dist-'))
  t.after(() => rmSync(out, { recursive: true, force: true }))
  const bundle = releaseBundle(join(import.meta.dirname, 'fixtures', 'repo'), { out, log: () => {} })
  assert.ok(existsSync(join(bundle.directory, 'manifest.json')))
  assert.ok(existsSync(join(bundle.directory, 'checksums.txt')))
  assert.ok(existsSync(join(bundle.directory, 'bin', 'dsh-termux.mjs')))
  const manifest = JSON.parse(readFileSync(join(bundle.directory, 'manifest.json'), 'utf8'))
  assert.equal(manifest.platform, process.platform)
  assert.equal(manifest.arch, process.arch)
  assert.equal(manifest.binding, undefined, 'the fixture checkout has no compiled binding')
  assert.equal(manifest.files.length, bundle.files.length)
  const checksums = readFileSync(join(bundle.directory, 'checksums.txt'), 'utf8').trim().split('\n')
  assert.equal(checksums.length, bundle.files.length)
  for (const line of checksums) assert.match(line, /^[a-f0-9]{64}  \S/)
})

test('releaseBundle rejects a binding from another architecture', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-termux-checkout-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const bindingDir = join(root, 'native/system/node_modules/@deepseek-ai', `node-addon-system-android-${process.arch}`, 'bin')
  mkdirSync(bindingDir, { recursive: true })
  const wrong = process.arch === 'x64' ? 0xb7 : 0x3e
  cpSync(elfFile(t, { machine: wrong }), join(bindingDir, 'system.node'))
  assert.throws(() => releaseBundle(root, { out: join(root, 'dist'), log: () => {} }), /expected/)
})
