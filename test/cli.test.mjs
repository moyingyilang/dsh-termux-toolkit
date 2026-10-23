import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
  assert.equal((result.stdout.match(/pending/g) ?? []).length, 5)
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
  assert.equal((check.stdout.match(/applied/g) ?? []).length, 5)
})

test('doctor reports the checkout state', () => {
  const result = cli(['doctor', '--repo', FIXTURES])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /patch {6}flock-android\s+pending/)
  assert.match(result.stdout, /flock {6}missing/)
})
