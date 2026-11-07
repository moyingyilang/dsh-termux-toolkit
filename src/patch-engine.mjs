/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
/**
 * Exact-text patching for a DeepSeek Harness checkout.
 *
 * Every patch is a list of replacements against files the toolkit does not own.
 * An edit is applicable only while its upstream text occurs exactly once and its
 * replacement text occurs nowhere; it is applied when the reverse holds. Anything
 * else means upstream changed and the edit must be re-derived rather than guessed,
 * so inspection reports `unsupported` and nothing is written.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * @typedef {object} EditVariant
 * @property {string} before Exact upstream text, present once while unpatched.
 * @property {string} after Replacement text, present once once patched.
 */

/**
 * @typedef {object} FileEdit
 * @property {string} file Repository-relative POSIX path.
 * @property {string} [before] Upstream text for a single-variant edit.
 * @property {string} [after] Replacement text for a single-variant edit.
 * @property {EditVariant[]} [variants] Alternative upstream shapes this edit accepts.
 */

/**
 * @typedef {object} Patch
 * @property {string} id Stable identifier used by the CLI and the report.
 * @property {string} title One-line summary.
 * @property {string} problem What upstream does that Android cannot.
 * @property {string} fix What the patch changes instead.
 * @property {FileEdit[]} edits Replacements, applied in order.
 */

/**
 * @typedef {'pending'|'applied'|'unsupported'} EditState
 */

/**
 * @typedef {object} EditInspection
 * @property {FileEdit} edit The inspected edit.
 * @property {EditState} state Whether the edit can be, or already is, applied.
 * @property {boolean} filePresent Whether the target file exists.
 * @property {number} beforeCount Occurrences of the upstream text outside the replacement.
 * @property {number} afterCount Occurrences of the replacement text.
 */

/**
 * @typedef {object} PatchInspection
 * @property {Patch} patch The inspected patch.
 * @property {EditInspection[]} edits Per-file results.
 * @property {EditState} state `applied`, `pending`, or `unsupported`.
 */

/**
 * Count non-overlapping occurrences of a literal needle.
 * @param {string} haystack Text to search.
 * @param {string} needle Literal text to count; must not be empty.
 * @returns {number} Number of matches.
 */
export function countExact(haystack, needle) {
  if (needle.length === 0) throw new Error('patch: empty anchor')
  let count = 0
  let index = haystack.indexOf(needle)
  while (index !== -1) {
    count++
    index = haystack.indexOf(needle, index + needle.length)
  }
  return count
}

/**
 * Inspect one edit against the checkout.
 *
 * The upstream count ignores occurrences inside the replacement text, so a patch
 * whose replacement extends the upstream block reads as `pending` rather than as
 * both states at once.
 * @param {string} root Repository root.
 * @param {FileEdit} edit Edit to inspect.
 * @returns {EditInspection} Inspection result.
 */
/**
 * The upstream shapes one edit accepts, in declaration order.
 * @param {FileEdit} edit Edit as declared by a patch.
 * @returns Variants this edit can match.
 */
export function editVariants(edit) {
  if (edit.variants !== undefined) return edit.variants
  if (edit.before === undefined || edit.after === undefined) throw new Error('patch: edit declares neither variants nor before/after')
  return [{ before: edit.before, after: edit.after }]
}

/**
 * Inspect one edit against the checkout.
 *
 * The upstream count ignores occurrences inside the replacement text, so a patch
 * whose replacement extends the upstream block reads as `pending` rather than as
 * both states at once. An edit with several variants is applied when any variant
 * is applied and pending when any variant is pending.
 * @param {string} root Repository root.
 * @param {FileEdit} edit Edit to inspect.
 * @returns {EditInspection} Inspection result.
 */
export function inspectEdit(root, edit) {
  const path = join(root, edit.file)
  if (!existsSync(path)) {
    return { edit, state: 'unsupported', filePresent: false, beforeCount: 0, afterCount: 0 }
  }
  const source = readFileSync(path, 'utf8')
  const variants = editVariants(edit).map((variant) => {
    const afterCount = countExact(source, variant.after)
    const withoutReplacement = source.split(variant.after).join('')
    const beforeCount = countExact(withoutReplacement, variant.before)
    const state = afterCount === 1 && beforeCount === 0
      ? 'applied'
      : beforeCount === 1 && afterCount === 0
        ? 'pending'
        : 'unsupported'
    return { variant, state, beforeCount, afterCount }
  })
  const applied = variants.find((entry) => entry.state === 'applied')
  const pending = variants.find((entry) => entry.state === 'pending')
  const chosen = applied ?? pending ?? variants[0]
  const state = applied !== undefined ? 'applied' : pending !== undefined ? 'pending' : 'unsupported'
  return { edit, state, filePresent: true, beforeCount: chosen.beforeCount, afterCount: chosen.afterCount }
}

/**
 * Inspect a patch: every edit must describe the same state.
 * @param {string} root Repository root.
 * @param {Patch} patch Patch to inspect.
 * @returns {PatchInspection} Aggregated result.
 */
export function inspectPatch(root, patch) {
  const edits = patch.edits.map((edit) => inspectEdit(root, edit))
  const applied = edits.every((edit) => edit.state === 'applied')
  const pending = edits.every((edit) => edit.state === 'pending')
  return { patch, edits, state: applied ? 'applied' : pending ? 'pending' : 'unsupported' }
}

/**
 * Inspect every patch.
 * @param {string} root Repository root.
 * @param {Patch[]} patches Patches to inspect.
 * @returns {PatchInspection[]} One result per patch.
 */
export function inspectPatches(root, patches) {
  return patches.map((patch) => inspectPatch(root, patch))
}

/**
 * Explain why inspections cannot be applied.
 * @param {PatchInspection[]} inspections Results from {@link inspectPatches}.
 * @returns {string[]} One line per unsupported edit; empty when applicable.
 */
export function describeProblems(inspections) {
  const problems = []
  for (const inspection of inspections) {
    if (inspection.state !== 'unsupported') continue
    for (const edit of inspection.edits) {
      if (edit.state !== 'unsupported') continue
      problems.push(edit.filePresent
        ? `${inspection.patch.id}: ${edit.edit.file} no longer contains a unique upstream anchor ` +
          `(upstream ${String(edit.beforeCount)}, patched ${String(edit.afterCount)})`
        : `${inspection.patch.id}: ${edit.edit.file} is missing`)
    }
  }
  return problems
}

/**
 * Rewrite one file with a single replacement.
 * @param {string} path Absolute path.
 * @param {string} before Exact upstream text.
 * @param {string} after Replacement text.
 * @returns {void}
 */
function replaceOnce(path, before, after) {
  const source = readFileSync(path, 'utf8')
  const index = source.indexOf(before)
  if (index === -1 || source.indexOf(before, index + before.length) !== -1) {
    throw new Error(`patch: ${path} does not contain exactly one upstream anchor`)
  }
  const updated = source.slice(0, index) + after + source.slice(index + before.length)
  const temporary = `${path}.dsh-termux-${String(process.pid)}`
  writeFileSync(temporary, updated)
  renameSync(temporary, path)
}

/**
 * Apply patches that are entirely `pending`; already-applied patches are kept.
 *
 * Nothing is written unless every patch is either applied or pending, so a
 * drifted anchor leaves the checkout untouched instead of half-patched.
 * @param {string} root Repository root.
 * @param {Patch[]} patches Patches to apply.
 * @returns {{applied: string[], kept: string[]}} Patch ids by outcome.
 */
export function applyPatches(root, patches) {
  const inspections = inspectPatches(root, patches)
  const problems = describeProblems(inspections)
  if (problems.length > 0) throw new Error(`patch: refusing to edit a drifted checkout\n  ${problems.join('\n  ')}`)
  const applied = []
  const kept = []
  for (const inspection of inspections) {
    if (inspection.state === 'applied') {
      kept.push(inspection.patch.id)
      continue
    }
    for (const edit of inspection.edits) {
      const variant = editVariants(edit.edit).find((entry) => {
        const source = readFileSync(join(root, edit.edit.file), 'utf8')
        return countExact(source.split(entry.after).join(''), entry.before) === 1
      })
      if (variant === undefined) throw new Error(`patch: ${edit.edit.file} has no applicable variant`)
      replaceOnce(join(root, edit.edit.file), variant.before, variant.after)
    }
    applied.push(inspection.patch.id)
  }
  return { applied, kept }
}

/**
 * Report patches whose files do not carry the expected patched text.
 * @param {string} root Repository root.
 * @param {Patch[]} patches Patches to verify.
 * @returns {string[]} One line per unapplied patch; empty when all are applied.
 */
export function verifyPatches(root, patches) {
  return inspectPatches(root, patches)
    .filter((inspection) => inspection.state !== 'applied')
    .map((inspection) => `${inspection.patch.id}: not applied (${inspection.state})`)
}
