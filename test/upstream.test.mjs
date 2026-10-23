import assert from 'node:assert/strict'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { inspectPatches } from '../src/patch-engine.mjs'
import { patches } from '../src/patches/index.mjs'
import { isCheckout } from '../src/repo.mjs'

const CANDIDATES = [
  process.env.DSH_TERMUX_REPO,
  join(import.meta.dirname, '..', 'deepseek-harness'),
  join(homedir(), 'deepseek-harness'),
].filter((candidate) => candidate !== undefined)

const root = CANDIDATES.find((candidate) => isCheckout(candidate))

test('the source patches still match a real checkout', {
  skip: root === undefined ? 'no DeepSeek Harness checkout on this host' : false,
}, () => {
  for (const inspection of inspectPatches(root, patches)) {
    assert.notEqual(
      inspection.state,
      'unsupported',
      `${inspection.patch.id} no longer matches upstream; re-derive its anchors`,
    )
  }
})
