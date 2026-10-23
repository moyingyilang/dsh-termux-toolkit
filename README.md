# dsh-termux-toolkit

Build and run [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) natively on Android/Termux.

Upstream DeepSeek Harness boots on Linux, macOS, and Windows. On Android its host preparation, session lock, session log publication, and new-file writes each hit a platform gap that no configuration flag closes. This toolkit applies five small source patches to a checkout, compiles the checked-in flock binding for bionic, and starts the Web UI with the one flag the patched build needs. Nothing is forked: the patches are exact-text replacements, inspectable and reversible, and `patch --check` fails loudly when upstream moves an anchor.

Verified on a Termux device (android-arm64, Node v24.18.0, DeepSeek Harness 0.2.0-rc.2). [中文说明](README.zh.md).

## What it fixes

| Gap | Upstream behaviour on Android | Toolkit response |
| --- | --- | --- |
| `node-addon-require-builtin` publishes darwin/linux/win32 bindings only | `@deepseek-ai/dsh-app-boot` cannot prepare the host, so no profile boots | the resolver falls back to the `internal/modules/*` registration Node installs under `--expose-internals` |
| `@deepseek-ai/node-addon-system` gates flock to linux/darwin | every session write fails: the JSONL store takes the lock as its cross-process lease | the gate accepts `android`; the toolkit compiles `flock.c` and publishes `node-addon-system-android-<arch>` |
| Android sepolicy denies `link(2)` inside app data directories | the JSONL store publishes a new log with `link(2)`, so the first write of every session fails | publication falls back to same-filesystem `rename(2)` for `EACCES`/`EPERM` |
| the same denial rejects the no-replace hard link used for create-if-absent writes | creating any new file through the agent fails with `EACCES` | creation falls back to `O_EXCL`, keeping the no-replace guarantee |
| the same denial also rejects generation publication when a stored session migrates to a newer format | opening an older session fails with `EACCES` before it can be upgraded | the target is inspected, then published by `rename(2)` |

## Requirements

- Termux on android-arm64 with Node.js >= 22.19 and a C compiler (`pkg install nodejs clang` or the Termux `cc` wrapper)
- a DeepSeek Harness checkout: `git clone https://github.com/deepseek-ai/deepseek-harness ~/deepseek-harness`
- the JavaScript pnpm build the checkout pins: `npm install -g pnpm@11.7.0`

Android has no `@pnpm/exe` binary, and pnpm 10+ satisfies `packageManager: pnpm@11.7.0` by switching to that standalone executable. Installing the JavaScript build once makes the pin resolvable; the toolkit runs it through the current Node.

## Quick start

```sh
git clone https://github.com/deepseek-ai/deepseek-harness ~/deepseek-harness
git clone https://github.com/moyingyilang/dsh-termux-toolkit ~/dsh-termux-toolkit
npm install -g pnpm@11.7.0

node ~/dsh-termux-toolkit/bin/dsh-termux.mjs doctor
node ~/dsh-termux-toolkit/bin/dsh-termux.mjs build
node ~/dsh-termux-toolkit/bin/dsh-termux.mjs start
```

`build` patches, installs, builds, and compiles the binding. `start` prints the token URL for `http://127.0.0.1:3081/`; the GUI rejects requests without that token. The instance keeps its sessions, storage, and settings in `~/.dsh-src` so it never shares state with an npm-installed `dsh`.

Put the command on `PATH` once instead of typing the path:

```sh
npm link ~/dsh-termux-toolkit
```

## Commands

| Command | Effect |
| --- | --- |
| `doctor` | prints platform, checkout version, patch state, binding state, and the resolved pnpm |
| `patch` | applies the five source patches; idempotent; `--check` only reports and exits 1 when upstream moved an anchor |
| `build` | patch, `pnpm install --frozen-lockfile --ignore-scripts`, `pnpm run build` with a 4 GiB heap, then compile the flock binding |
| `start` | ensures the binding, then runs `node --expose-internals apps/cli/lib/bin.js web --port <port> --no-open` |

Options: `--repo <dir>` (default: nearest parent checkout, else `~/deepseek-harness`), `--port <n>`, `--restart`, `--dsh-home <dir>`, `--skip-install`, `--scripts`, `--memory-mb <n>`, `--headers <dir>`, `--cc <name>`, `--force`, `--strict`.

## What the patches do

| Patch | File | Change |
| --- | --- | --- |
| `flock-android` | `native/system/packages/entry/src/flock.ts` | platform gate accepts `android`; the entry keeps its `bin/system.node` filename because bionic is neither glibc nor musl |
| `internals-fallback` | `packages/boot/app-boot/src/profile-resolution/resolver.ts` | a failed `require('node-addon-require-builtin')` falls back to `require('internal/modules/*')`, available under `--expose-internals` |
| `session-link-fallback` | `packages/session/session-persistence-jsonl/src/index.ts` | `link(2)` denied with `EACCES`/`EPERM` retries publication with `rename(2)` |
| `migration-publish-fallback` | `packages/session/session-persistence-jsonl/src/generation.ts` | a denied `link(2)` inspects the target, then publishes the verified generation with `rename(2)` |
| `fs-create-fallback` | `packages/fs/fs-local/src/fsio.ts` | a denied no-replace hard link creates the destination with `O_EXCL` instead |

Each patched block carries a `dsh-termux` comment, so `grep -rn dsh-termux` lists every touched site. [docs/patches.md](docs/patches.md) states the failure each patch removes and the guarantee each one weakens.

## Guarantees and costs

- **Session lock** is a real POSIX `flock` on bionic; concurrency semantics match Linux.
- **Session publication** stays atomic and durable. `link(2)` fails with `EEXIST` when the final path exists, so two processes cannot clobber one another. `rename(2)` overwrites silently, so the Android fallback narrows that guarantee to the preceding `rejectExistingLog()` check: a concurrent writer of the same session id can now win the race. The window is a single session id created simultaneously by two processes.
- **Create-if-absent** keeps its no-replace guarantee through `O_EXCL`; the difference is visibility, because the destination is readable while its bytes are copied, where the hard link made the complete file appear at once.
- **`--expose-internals`** is process-wide. The toolkit always passes it; launching the checkout with a bare `node apps/cli/lib/bin.js` on a host without the native binding exits with a message naming the flag.

## Known upstream test divergences

Five upstream tests assert hard-link behaviour that Android policy forbids, one asserts that a `link(2)` permission error is an IO failure, and one asserts the unsupported-platform rejection the flock patch removes. They fail on a Termux device with the patches applied; the product paths they cover succeed through the fallbacks:

- `packages/fs/fs-local/tests/fsio.spec.ts` — "maps a non-collision guarded-create publication failure and cleans staging" (injects the `EACCES` that Android produces as policy)
- `packages/session/session-persistence-jsonl/tests/generation.spec.ts` — "accepts an identical publication winner and rejects different bytes", "accepts an identical regular hardlink target", "retains a POSIX publication after the directory sync fails", "reports success after exclusive publication when redundant stage cleanup fails", "accepts an identical target that wins POSIX publication" (each creates a real hard link while simulating a non-Android platform)
- `native/system/test/flock.test.js` — "import succeeds with native addons disabled" (asserts the unsupported-platform rejection the patch removes)

`docs/patches.md` lists why each one cannot pass on Android.

## Upgrades and drift

`pnpm run build` regenerates `lib/` from the patched sources, so the patches survive every build. A `git checkout` or `git pull` that rewrites a patched file is repaired by the next `build` (or `patch`). When upstream changes an anchor, `patch --check` exits 1 and names the file; re-derive that edit against the new text and update `src/patches/`.

To return the checkout to pristine upstream:

```sh
cd ~/deepseek-harness && git checkout -- \
  native/system/packages/entry/src/flock.ts \
  packages/boot/app-boot/src/profile-resolution/resolver.ts \
  packages/session/session-persistence-jsonl/src/index.ts \
  packages/fs/fs-local/src/fsio.ts
```

## Limitations

- Android only. The patches exist to remove Android platform gaps and are not applied automatically on other hosts.
- The desktop application and Windows-only native dependencies (`koffi`) are out of scope; install runs with `--ignore-scripts` for that reason.
- The binding is compiled for the running Node, so a Node major upgrade needs `build` (or `start`, which recompiles a missing binding) to run the compiler again.
- `dsh-termux-toolkit` is unaffiliated with DeepSeek; it patches a checkout you own.

## Tests

```sh
npm test
```

The suite patches excerpted upstream files, proves anchors are unique and idempotent, refuses half-applied checkouts, and (when a checkout is present) asserts every anchor still matches real upstream. CI additionally clones DeepSeek Harness and runs `patch --check` against it on every push.

[docs/verification.md](docs/verification.md) records the device run: the `link(2)` denial, the compile, the test counts, and the boot with the binding forced unavailable.

## License

MIT. Patched source files remain under DeepSeek Harness's license.
