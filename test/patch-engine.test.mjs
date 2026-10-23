import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import {
  applyPatches,
  countExact,
  describeProblems,
  inspectEdit,
  inspectPatch,
  verifyPatches,
} from '../src/patch-engine.mjs'

const EDIT = {
  file: 'a.txt',
  before: 'alpha\n',
  after: 'alpha beta\n',
}

/** Create a scratch checkout and return its root. */
function scratch(t) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-termux-engine-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}

/** Write one file below a scratch checkout. */
function put(root, relative, content) {
  const path = join(root, relative)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

test('countExact counts non-overlapping literals and rejects empty needles', () => {
  assert.equal(countExact('aaaa', 'aa'), 2)
  assert.equal(countExact('abc', 'd'), 0)
  assert.throws(() => countExact('abc', ''), /empty anchor/)
})

test('inspectEdit separates pending, applied, and unsupported states', (t) => {
  const root = scratch(t)
  put(root, 'a.txt', 'alpha\n')
  assert.equal(inspectEdit(root, EDIT).state, 'pending')
  put(root, 'a.txt', 'alpha beta\n')
  assert.equal(inspectEdit(root, EDIT).state, 'applied')
  put(root, 'a.txt', 'gamma\n')
  assert.equal(inspectEdit(root, EDIT).state, 'unsupported')
})

test('inspectEdit treats a replacement that extends the upstream text as pending', (t) => {
  const root = scratch(t)
  put(root, 'a.txt', 'alpha\n')
  const growing = { file: 'a.txt', before: 'alpha\n', after: 'alpha\nalpha beta\n' }
  assert.equal(inspectEdit(root, growing).state, 'pending')
  put(root, 'a.txt', 'alpha\nalpha beta\n')
  assert.equal(inspectEdit(root, growing).state, 'applied')
})

test('inspectEdit rejects a duplicated upstream anchor', (t) => {
  const root = scratch(t)
  put(root, 'a.txt', 'alpha\nalpha\n')
  const inspection = inspectEdit(root, EDIT)
  assert.equal(inspection.state, 'unsupported')
  assert.equal(inspection.beforeCount, 2)
})

test('inspectEdit reports a missing target file', (t) => {
  const root = scratch(t)
  const inspection = inspectEdit(root, EDIT)
  assert.equal(inspection.state, 'unsupported')
  assert.equal(inspection.filePresent, false)
})

test('applyPatches writes pending edits, keeps applied ones, and verifies', (t) => {
  const root = scratch(t)
  put(root, 'a.txt', 'alpha\n')
  const patch = { id: 'demo', title: 'demo', problem: '', fix: '', edits: [EDIT] }
  assert.deepEqual(applyPatches(root, [patch]), { applied: ['demo'], kept: [] })
  assert.equal(readFileSync(join(root, 'a.txt'), 'utf8'), 'alpha beta\n')
  assert.deepEqual(applyPatches(root, [patch]), { applied: [], kept: ['demo'] })
  assert.deepEqual(verifyPatches(root, [patch]), [])
  assert.deepEqual(inspectPatch(root, patch).state, 'applied')
})

test('applyPatches leaves the checkout untouched when any anchor drifted', (t) => {
  const root = scratch(t)
  put(root, 'a.txt', 'alpha\n')
  put(root, 'b.txt', 'gamma\n')
  const good = { id: 'good', title: '', problem: '', fix: '', edits: [EDIT] }
  const drifted = { id: 'drifted', title: '', problem: '', fix: '', edits: [{ ...EDIT, file: 'b.txt' }] }
  assert.throws(() => applyPatches(root, [good, drifted]), /refusing to edit a drifted checkout/)
  assert.equal(readFileSync(join(root, 'a.txt'), 'utf8'), 'alpha\n')
})

test('describeProblems names the drifted file and the anchor counts', (t) => {
  const root = scratch(t)
  put(root, 'a.txt', 'gamma\n')
  const patch = { id: 'demo', title: '', problem: '', fix: '', edits: [EDIT] }
  const problems = describeProblems([inspectPatch(root, patch)])
  assert.equal(problems.length, 1)
  assert.match(problems[0], /demo: a\.txt no longer contains a unique upstream anchor/)
})

test('verifyPatches reports patches that are not applied', (t) => {
  const root = scratch(t)
  put(root, 'a.txt', 'alpha\n')
  const patch = { id: 'demo', title: '', problem: '', fix: '', edits: [EDIT] }
  assert.deepEqual(verifyPatches(root, [patch]), ['demo: not applied (pending)'])
})
