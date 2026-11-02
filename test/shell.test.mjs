import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { BLOCK_START, blockInstalled, installShell, renderBlock, resolveShell } from '../src/shell.mjs'

/** Scratch rc file. */
function scratch(t, content = '') {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-termux-rc-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const path = join(dir, 'rc')
  writeFileSync(path, content)
  return path
}

test('the POSIX block runs the CLI and defaults to start', () => {
  const block = renderBlock('/opt/toolkit/bin/dsh-termux.mjs', 'posix')
  assert.match(block, /dsh4termux\(\) \{/)
  assert.match(block, /node "\/opt\/toolkit\/bin\/dsh-termux\.mjs" "\$\{@:-start\}"/)
  assert.ok(block.startsWith(BLOCK_START))
})

test('the fish block uses fish syntax', () => {
  const block = renderBlock('/opt/toolkit/bin/dsh-termux.mjs', 'fish')
  assert.match(block, /function dsh4termux/)
  assert.match(block, /\$argv\[1\.\.-1\]/)
  assert.match(block, /^end$/m)
})

test('installing appends one block and is idempotent', (t) => {
  const path = scratch(t, 'export A=1\n')
  const first = installShell({ path, flavor: 'posix', toolkit: '/opt/dsh.mjs' })
  assert.equal(first.changed, true)
  assert.equal(blockInstalled(path), true)
  const second = installShell({ path, flavor: 'posix', toolkit: '/opt/dsh.mjs' })
  const source = readFileSync(path, 'utf8')
  assert.equal(second.changed, true)
  assert.equal(source.match(/>>> dsh4termux >>>/g)?.length, 1)
  assert.match(source, /export A=1/)
})

test('reinstalling updates the toolkit path in place', (t) => {
  const path = scratch(t)
  installShell({ path, flavor: 'posix', toolkit: '/old/dsh.mjs' })
  installShell({ path, flavor: 'posix', toolkit: '/new/dsh.mjs' })
  const source = readFileSync(path, 'utf8')
  assert.match(source, /\/new\/dsh\.mjs/)
  assert.doesNotMatch(source, /\/old\/dsh\.mjs/)
  assert.equal(source.match(/>>> dsh4termux >>>/g)?.length, 1)
})

test('removing takes the block out and keeps the rest', (t) => {
  const path = scratch(t, 'export A=1\n')
  installShell({ path, flavor: 'posix', toolkit: '/opt/dsh.mjs' })
  const result = installShell({ path, flavor: 'posix', toolkit: '/opt/dsh.mjs', remove: true })
  const source = readFileSync(path, 'utf8')
  assert.equal(result.changed, true)
  assert.equal(blockInstalled(path), false)
  assert.match(source, /export A=1/)
  assert.doesNotMatch(source, /dsh4termux/)
})

test('removing an absent block changes nothing', (t) => {
  const path = scratch(t, 'export A=1\n')
  const result = installShell({ path, flavor: 'posix', toolkit: '/opt/dsh.mjs', remove: true })
  assert.equal(result.changed, false)
  assert.equal(readFileSync(path, 'utf8'), 'export A=1\n')
})

test('the rc file follows SHELL unless overridden', () => {
  assert.match(resolveShell({ shell: '/bin/zsh' }).path, /\.zshrc$/)
  assert.match(resolveShell({ shell: '/bin/bash' }).path, /\.bashrc$/)
  assert.equal(resolveShell({ shell: '/usr/bin/fish' }).flavor, 'fish')
  assert.deepEqual(resolveShell({ override: '/tmp/custom.rc' }), { path: '/tmp/custom.rc', flavor: 'posix' })
})
