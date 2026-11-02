/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

const CLI = join(import.meta.dirname, '..', 'bin', 'dsh-termux.mjs')
const FIXTURES = join(import.meta.dirname, 'fixtures', 'repo')

/** Run the CLI and capture its output. */
function cli(args) {
  const result = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

test('version prints the package version', () => {
  const result = cli(['version'])
  assert.equal(result.status, 0)
  assert.match(result.stdout, /^dsh-termux \d+\.\d+\.\d+\n$/)
})

test('help lists every command', () => {
  const result = cli(['--help'])
  assert.equal(result.status, 0)
  for (const command of ['doctor', 'patch', 'build', 'start', 'version']) {
    assert.match(result.stdout, new RegExp(`\\b${command}\\b`))
  }
})

test('an unknown command is a usage error', () => {
  const result = cli(['frobnicate'])
  assert.equal(result.status, 2)
  assert.match(result.stderr, /unknown command "frobnicate"/)
})

test('patch --check reports pending patches without writing', () => {
  const result = cli(['patch', '--check', '--repo', FIXTURES])
  assert.equal(result.status, 0, result.stderr)
  assert.equal((result.stdout.match(/pending/g) ?? []).length, 7)
})

test('patch --check fails on a drifted checkout', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-termux-cli-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  cpSync(FIXTURES, root, { recursive: true })
  writeFileSync(join(root, 'native/system/packages/entry/src/flock.ts'), '// upstream changed\n')
  const result = cli(['patch', '--check', '--repo', root])
  assert.equal(result.status, 1)
  assert.match(result.stderr, /no longer contains a unique upstream anchor/)
})

test('patch applies the patches and can be re-run', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-termux-cli-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  cpSync(FIXTURES, root, { recursive: true })
  const first = cli(['patch', '--repo', root])
  assert.equal(first.status, 0, first.stderr)
  assert.match(first.stdout, /applied: flock-android/)
  const second = cli(['patch', '--repo', root])
  assert.equal(second.status, 0, second.stderr)
  assert.match(second.stdout, /already applied/)
  const check = cli(['patch', '--check', '--repo', root])
  assert.equal((check.stdout.match(/applied/g) ?? []).length, 7)
})

test('shell --print emits the shortcut without touching an rc file', () => {
  const result = cli(['shell', '--print'])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /# >>> dsh4termux >>>/)
  assert.match(result.stdout, /dsh4termux\(\) \{/)
})

test('shell installs into an explicit rc file', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-termux-rc-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const rc = join(dir, 'rc')
  const result = cli(['shell', '--rc', rc])
  assert.equal(result.status, 0, result.stderr)
  const first = readFileSync(rc, 'utf8')
  assert.match(first, /dsh4termux\(\) \{/)
  const again = cli(['shell', '--rc', rc])
  assert.equal(again.status, 0)
  assert.equal(readFileSync(rc, 'utf8').match(/>>> dsh4termux >>>/g)?.length, 1)
  const removed = cli(['shell', '--rc', rc, '--remove'])
  assert.equal(removed.status, 0)
  assert.doesNotMatch(readFileSync(rc, 'utf8'), /dsh4termux/)
})

test('release assembles a bundle for this host', (t) => {
  const out = mkdtempSync(join(tmpdir(), 'dsh-termux-dist-'))
  t.after(() => rmSync(out, { recursive: true, force: true }))
  const result = cli(['release', '--repo', FIXTURES, '--out', out])
  assert.equal(result.status, 0, result.stderr)
  const entries = readdirSync(out)
  assert.equal(entries.length, 1)
  assert.ok(existsSync(join(out, entries[0], 'manifest.json')))
})

test('doctor reports the checkout state', () => {
  const result = cli(['doctor', '--repo', FIXTURES])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /patch {6}flock-android\s+pending/)
  assert.match(result.stdout, /flock {6}missing/)
})
