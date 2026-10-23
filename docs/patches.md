# The five patches

Each patch is one exact-text replacement in a DeepSeek Harness source file. The toolkit inspects the file before writing, applies nothing unless every patch is applicable, and keeps the patched block greppable with a `dsh-termux` comment. This page states what breaks on Android without the patch and what guarantee the patch changes.

## 1. `flock-android`

File: `native/system/packages/entry/src/flock.ts`

The native system package implements asynchronous `flock(2)` through stable Node-API. Its entry loads a platform package named `@deepseek-ai/node-addon-system-<platform>-<arch>` and rejects any host that is not linux or darwin:

```ts
if (platform !== 'linux' && platform !== 'darwin') {
  throw Object.assign(new Error(`flock is not supported on ${platform}-${arch}`), { code: 'ERR_FLOCK_UNSUPPORTED_PLATFORM' })
}
```

`@deepseek-ai/dsh-session-persistence-jsonl` takes that lock as the cross-process lease for a session log, so on Android the first write of every session fails before a turn completes.

The patch admits `android`. The filename logic stays untouched: the entry selects `glibc/system.node` or `musl/system.node` only for linux, and bionic is neither, so android resolves the plain `bin/system.node`.

The toolkit compiles the checked-in `src/flock.c` with the device compiler and publishes it at `native/system/node_modules/@deepseek-ai/node-addon-system-android-<arch>/bin/system.node` together with a minimal `package.json` (`os: ["android"]`, `cpu: [arch]`). `pnpm install` may prune that directory; `build` recreates it after installing, and `start` recompiles when it is missing.

Guarantee: unchanged. This is the same syscall on the same Linux kernel; only the platform gate was broader than the implementation.

## 2. `internals-fallback`

File: `packages/boot/app-boot/src/profile-resolution/resolver.ts`

The profile resolver needs five `internal/modules/*` modules from Node's own loader to resolve ESM and CJS the way Node does. It reaches them through `node-addon-require-builtin`, which publishes prebuilt bindings for darwin, linux-gnu, linux-musl, and win32 only; `require` of the package throws on android-arm64, and app-boot cannot prepare a host, so no profile boots.

The patch wraps the addon load in `builtinLoader(require)`. When the binding loads, behaviour is identical. When it throws, the loader returns a `requireBuiltin` that calls the ordinary `require(moduleId)`: Node registers `internal/modules/*` for plain require when the process starts with `--expose-internals`, and the Termux launcher always passes it. If both paths fail, the error names `--expose-internals` and keeps the addon failure as `cause`.

`requireBuiltin` call sites are untouched, which keeps the patch to one replacement.

Guarantee: the resolver keeps using Node's own loader. The cost is a process-wide `--expose-internals`, visible in the command line; it is the same privilege the addon grants, scoped to the process rather than to the addon API.

## 3. `session-link-fallback`

File: `packages/session/session-persistence-jsonl/src/index.ts`

The JSONL store publishes a new session log by writing and syncing a temporary file, then `link(2)`-ing it into place:

```ts
try {
  await link(tmp, finalPath)
  linked = true
} finally {
  if (!linked) await rm(tmp, { force: true })
}
```

`link(2)` is deliberate: it fails with `EEXIST` when the final path exists, so two processes materializing the same session id cannot clobber each other. Android sepolicy denies hard links inside app data directories, so the call fails with `EACCES` and the publish aborts.

The patch catches `EACCES`/`EPERM` only, publishes with same-filesystem `rename(2)`, and records the publication as successful so the redundant temp cleanup stays a no-op. Every other errno is rethrown unchanged.

Guarantee: atomicity and durability are unchanged, both calls replace one directory entry on one filesystem. The no-clobber guarantee narrows to the `rejectExistingLog()` check the store performs immediately before publication, so a concurrent creator of the same session id can win that race. That window is one session id created by two processes at once; ordinary appends never publish a new log.

## 4. `migration-publish-fallback`

File: `packages/session/session-persistence-jsonl/src/generation.ts`

Opening a stored session whose format is older than `SESSION_FORMAT_VERSION` migrates it and publishes the verified successor as the current generation. `publishCurrentExclusive` does that with `link(2)` and reads `EEXIST` as "another publisher won, accept theirs"; any other errno propagates.

Android sepolicy denies the call, so the migration fails with `EACCES` and the session cannot be opened.

The patch keeps `EEXIST` handling intact and, for `EACCES`/`EPERM` on `android`, inspects the target with `lstat` first: an existing entry still reports "already published", and only a missing one is published by same-filesystem `rename(2)`. The platform check reads the injectable `internals.platform`, so tests that simulate another platform keep that platform's semantics.

Guarantee: atomicity and durability are unchanged. The collision detection narrows to the `lstat` inspection, so a concurrent publisher of the same generation can win that race.

## 5. `fs-create-fallback`

File: `packages/fs/fs-local/src/fsio.ts`

`writeFileAtomic` stages content in a private directory, then publishes it. For a create-if-absent write — the agent's new-file write — it publishes with `link(2)` so a concurrent creator keeps its file and the loser is rejected as `FS_NOT_OBSERVED`. The same sepolicy denial makes that link fail, and because the destination does not exist the guarded-create mapper reports `FS_IO_ERROR`: creating any new file through the agent fails.

The patch keeps that mapping for every errno except `EACCES`/`EPERM`. For those, `createExclusive` opens the destination with `O_EXCL`, writes the same content through the created descriptor, syncs, and applies the mode. An `EEXIST` from `O_EXCL` — a concurrent creator — still goes through `throwGuardedCreateFailure`, so the losing writer is rejected exactly as before.

Guarantee: the no-replace guarantee is unchanged, `O_EXCL` is the POSIX create-if-absent primitive. Visibility differs: the hard link made the complete file appear at once, while `O_EXCL` exposes the destination while its bytes are copied.

## Android test divergences

The patched checkout keeps upstream's tests unchanged. Seven assertions describe behaviour the Android kernel policy forbids, so they fail on a Termux device even though the product path succeeds:

| Test | Why it cannot pass on Android |
| --- | --- |
| `fsio.spec.ts`: maps a non-collision guarded-create publication failure | injects the `EACCES` that Android raises as policy and expects it to surface as `FS_IO_ERROR`; the fallback treats that errno as policy and creates the file |
| `generation.spec.ts`: accepts an identical publication winner and rejects different bytes | the test creates the competing generation with a real `link(2)` |
| `generation.spec.ts`: accepts an identical regular hardlink target | asserts inode identity through a hard link |
| `generation.spec.ts`: retains a POSIX publication after the directory sync fails | publishes the simulated winner with a real `link(2)` |
| `generation.spec.ts`: reports success after exclusive publication when redundant stage cleanup fails | publishes with a real `link(2)` while simulating darwin |
| `native/system/test/flock.test.js`: import succeeds with native addons disabled | asserts `ERR_FLOCK_UNSUPPORTED_PLATFORM` under `--no-addons`; android is now a supported platform, so the entry reaches `dlopen` and reports `ERR_DLOPEN_DISABLED` |

Everything else passes on device: `fs-local` 160/161 and `session-persistence-jsonl` 732/738 in the run recorded for 0.1.0.

## Drift

The anchors are exact text from DeepSeek Harness 0.2.0-rc.2. `patch --check` runs the same inspection without writing:

- `pending` — the upstream text is present once: applicable, exit 0
- `applied` — the patched text is present once: nothing to do, exit 0
- `unsupported` — neither, or more than once: exit 1, naming the file and the counts

Re-derive an unsupported edit against the new upstream text, keep the edit as small as the reason allows, and run `npm test` plus `patch --check` against the checkout.
