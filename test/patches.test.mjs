import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { applyPatches, inspectPatches, verifyPatches } from '../src/patch-engine.mjs'
import { patches } from '../src/patches/index.mjs'

const FIXTURES = join(import.meta.dirname, 'fixtures', 'repo')

/** Copy the fixture checkout so a test can patch it without touching the repository. */
function checkoutCopy(t) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-termux-patches-'))
  cpSync(FIXTURES, root, { recursive: true })
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}

test('every patch documents its problem, fix, and upstream version', () => {
  const ids = new Set()
  for (const patch of patches) {
    assert.ok(patch.id.length > 0)
    assert.ok(!ids.has(patch.id), `duplicate patch id ${patch.id}`)
    ids.add(patch.id)
    assert.ok(patch.title.length > 0)
    assert.match(patch.since, /^\d+\.\d+\.\d+/)
    assert.ok(patch.problem.length > 40, `${patch.id} problem is too short`)
    assert.ok(patch.fix.length > 40, `${patch.id} fix is too short`)
    assert.ok(patch.edits.length > 0)
  }
})

test('the fixture checkout starts unpatched and applies every patch', (t) => {
  const root = checkoutCopy(t)
  for (const inspection of inspectPatches(root, patches)) {
    assert.equal(inspection.state, 'pending', `${inspection.patch.id} should be pending on upstream`)
  }
  const result = applyPatches(root, patches)
  assert.deepEqual(result.kept, [])
  assert.deepEqual(result.applied, patches.map((patch) => patch.id))
  assert.deepEqual(verifyPatches(root, patches), [])
  for (const inspection of inspectPatches(root, patches)) {
    assert.equal(inspection.state, 'applied', `${inspection.patch.id} should be applied`)
  }
})

test('applying twice changes nothing', (t) => {
  const root = checkoutCopy(t)
  applyPatches(root, patches)
  const before = patches.map((patch) => readFileSync(join(root, patch.edits[0].file), 'utf8'))
  assert.deepEqual(applyPatches(root, patches), { applied: [], kept: patches.map((patch) => patch.id) })
  const after = patches.map((patch) => readFileSync(join(root, patch.edits[0].file), 'utf8'))
  assert.deepEqual(after, before)
})

test('every applied patch is greppable by its dsh-termux marker', (t) => {
  const root = checkoutCopy(t)
  applyPatches(root, patches)
  const marked = patches
    .flatMap((patch) => patch.edits.map((edit) => readFileSync(join(root, edit.file), 'utf8')))
    .filter((source) => source.includes('dsh-termux'))
  assert.equal(marked.length > 0, true)
})

test('the flock patch admits android without disturbing the libc branch', (t) => {
  const root = checkoutCopy(t)
  applyPatches(root, patches)
  const source = readFileSync(join(root, 'native/system/packages/entry/src/flock.ts'), 'utf8')
  assert.match(source, /platform !== 'android'/)
  assert.match(source, /filename = join\(report\.header\.glibcVersionRuntime \? 'glibc' : 'musl', filename\)/)
})

test('the internals patch keeps requireBuiltin call sites intact', (t) => {
  const root = checkoutCopy(t)
  applyPatches(root, patches)
  const source = readFileSync(join(root, 'packages/boot/app-boot/src/profile-resolution/resolver.ts'), 'utf8')
  assert.match(source, /const addon = builtinLoader\(require\)/)
  assert.match(source, /addon\.requireBuiltin\('internal\/modules\/esm\/loader'\)/)
  assert.match(source, /--expose-internals/)
})

test('the session patch adds rename only for denied links', (t) => {
  const root = checkoutCopy(t)
  applyPatches(root, patches)
  const source = readFileSync(join(root, 'packages/session/session-persistence-jsonl/src/index.ts'), 'utf8')
  assert.match(source, /import \{[^}]*\brename\b[^}]*\} from 'node:fs\/promises'/)
  assert.match(source, /if \(process\.platform !== 'android' \|\| \(code !== 'EACCES' && code !== 'EPERM'\)\) throw error/)
  assert.match(source, /await rename\(tmp, finalPath\)/)
})

test('the migration patch narrows publication to android denials', (t) => {
  const root = checkoutCopy(t)
  applyPatches(root, patches)
  const source = readFileSync(join(root, 'packages/session/session-persistence-jsonl/src/generation.ts'), 'utf8')
  assert.match(source, /rename as fsRename/)
  assert.match(source, /internals\.platform === 'android' && isErrnoException\(error\)/)
  assert.match(source, /await fsRename\(staged, currentPath\)/)
  assert.match(source, /await internals\.fs\.lstat\(currentPath\)/)
})

test('the fs patch keeps the guarded-create taxonomy for other errors', (t) => {
  const root = checkoutCopy(t)
  applyPatches(root, patches)
  const source = readFileSync(join(root, 'packages/fs/fs-local/src/fsio.ts'), 'utf8')
  assert.match(source, /if \(platform === 'android' && isPermissionDenied\(error\)\) \{/)
  assert.match(source, /await throwGuardedCreateFailure\(error, absolutePath, createIfAbsent\.displayPath, inspectPublicationTarget\)/)
  assert.match(source, /created = await open\(absolutePath, 'wx', 0o600\)/)
})
