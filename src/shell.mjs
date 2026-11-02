/**
 * Install the `dsh4termux` shortcut into a shell rc file.
 *
 * The block is delimited by markers, so reinstalling replaces it instead of
 * appending again, and `--remove` takes it out without touching the rest of the
 * file. POSIX shells get a function; fish gets its own syntax.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'

/** Marker that opens the managed block. */
export const BLOCK_START = '# >>> dsh4termux >>>'
/** Marker that closes the managed block. */
export const BLOCK_END = '# <<< dsh4termux <<<'
/** Name of the installed shortcut. */
export const SHORTCUT = 'dsh4termux'

const BLOCK_PATTERN = new RegExp(`${escapeRe(BLOCK_START)}[\\s\\S]*?${escapeRe(BLOCK_END)}\\n?`, 'g')

/** Escape a literal for use inside a regular expression. */
function escapeRe(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Pick the rc file for the current shell.
 * @param options Explicit `--rc` path and the shell name to inspect.
 * @returns Absolute rc path and the shell flavor the block must match.
 */
export function resolveShell({ override, shell = process.env.SHELL } = {}) {
  if (override !== undefined) return { path: override, flavor: override.endsWith('config.fish') ? 'fish' : 'posix' }
  const name = basename(shell ?? 'bash')
  if (name === 'fish') return { path: join(homedir(), '.config/fish/config.fish'), flavor: 'fish' }
  if (name === 'zsh') return { path: join(homedir(), '.zshrc'), flavor: 'posix' }
  return { path: join(homedir(), '.bashrc'), flavor: 'posix' }
}

/**
 * Render the managed block.
 * @param toolkit Absolute path of the toolkit's `bin/dsh-termux.mjs`.
 * @param flavor Shell syntax to emit.
 * @returns The block, markers included, ending with one newline.
 */
export function renderBlock(toolkit, flavor) {
  if (flavor === 'fish') {
    return [BLOCK_START, `function ${SHORTCUT}`, `  node "${toolkit}" $argv[1..-1]`, 'end', BLOCK_END, ''].join('\n')
  }
  return [BLOCK_START, `${SHORTCUT}() {`, `  node "${toolkit}" "\${@:-start}"`, '}', BLOCK_END, ''].join('\n')
}

/**
 * Write, replace, or remove the block in one rc file.
 * @param options rc path, shell flavor, toolkit entry, and operation.
 * @returns `{ path, changed, block }`; `changed` is false when nothing was written.
 */
export function installShell({ path, flavor, toolkit, remove = false }) {
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : ''
  const block = renderBlock(toolkit, flavor)
  const present = existing.includes(BLOCK_START)
  if (remove) {
    if (!present) return { path, changed: false, block }
    writeFileSync(path, existing.replace(BLOCK_PATTERN, '').replace(/\n{2,}/g, '\n\n'))
    return { path, changed: true, block }
  }
  if (present) {
    writeFileSync(path, existing.replace(BLOCK_PATTERN, block))
    return { path, changed: true, block }
  }
  const separator = existing.length === 0 ? '' : existing.endsWith('\n') ? '\n' : '\n\n'
  writeFileSync(path, `${existing}${separator}${block}`)
  return { path, changed: true, block }
}

/**
 * Whether the rc file already carries the managed block.
 * @param path Absolute rc path.
 * @returns True when both markers are present.
 */
export function blockInstalled(path) {
  if (!existsSync(path)) return false
  const source = readFileSync(path, 'utf8')
  return source.includes(BLOCK_START) && source.includes(BLOCK_END)
}
