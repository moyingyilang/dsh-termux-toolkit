/** Reach Node's module-loader internals without a published native binding. */
export const internalsFallback = {
  id: 'internals-fallback',
  title: 'Load module-loader internals without the native binding',
  since: '0.2.0-rc.2',
  problem:
    '`node-addon-require-builtin` publishes bindings for darwin, linux-gnu, linux-musl, and win32 '
    + 'only. Its only consumer, the app-boot profile resolver, calls it unconditionally to reach '
    + 'five `internal/modules/*` modules, so host preparation throws on android-arm64.',
  fix:
    'When the binding cannot load, the resolver falls back to a plain `require` of the same module '
    + 'ids, which Node registers when the process starts with `--expose-internals` (the Termux '
    + 'launcher always passes it). A failure of both paths names the missing flag.',
  edits: [
    {
      file: 'packages/boot/app-boot/src/profile-resolution/resolver.ts',
      before: `function internalModules(): InternalModules {
  const require = createRequire(import.meta.url)
  const addon = require('node-addon-require-builtin') as { requireBuiltin(moduleId: string): unknown }`,
      after: `/**
 * Resolve Node's internal module-loader modules.
 *
 * \`node-addon-require-builtin\` publishes no binding for android-arm64, so this
 * falls back to the registration Node installs under \`--expose-internals\`,
 * which the Termux launcher always passes.
 * @param require - CommonJS require bound to this module.
 * @returns Loader exposing \`requireBuiltin\` for \`internal/*\` module ids.
 */
function builtinLoader(require: NodeJS.Require): { requireBuiltin(moduleId: string): unknown } {
  try {
    return require('node-addon-require-builtin') as { requireBuiltin(moduleId: string): unknown }
  } catch (addonError) {
    // dsh-termux: no published binding for android-arm64; Node registers the
    // same internal modules for plain require under --expose-internals.
    return {
      requireBuiltin: (moduleId) => {
        try {
          return require(moduleId)
        } catch (error) {
          throw Object.assign(new Error(
            \`profile resolution: cannot load \${moduleId}; this platform requires --expose-internals\`,
          ), { cause: { addonError, error } })
        }
      },
    }
  }
}

function internalModules(): InternalModules {
  const require = createRequire(import.meta.url)
  const addon = builtinLoader(require)`,
    },
  ],
}
