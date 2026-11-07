# dsh-termux-toolkit

Build and run [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) natively on Android/Termux.

Upstream DeepSeek Harness boots on Linux, macOS, and Windows. On Android its host preparation, session lock, session log publication, new-file writes, and attachment storage each hit a platform gap that no configuration flag closes, and its image pipeline has no prebuilt binary for bionic. This toolkit applies seven small source patches to a checkout, compiles the checked-in flock binding and sharp against the system libvips, and starts the Web UI with the one flag the patched build needs. Nothing is forked: the patches are exact-text replacements, inspectable and reversible, and `patch --check` fails loudly when upstream moves an anchor.

Verified on a Termux device (android-arm64, Node v24.22.2, DeepSeek Harness 0.2.2-rc.1; the create-if-absent patch accepts both the 0.2.0-rc.2 and 0.2.2-rc.1 shapes). [中文说明](README.zh.md).

## What it fixes

| Gap | Upstream behaviour on Android | Toolkit response |
| --- | --- | --- |
| `node-addon-require-builtin` publishes darwin/linux/win32 bindings only | `@deepseek-ai/dsh-app-boot` cannot prepare the host, so no profile boots | the resolver falls back to the `internal/modules/*` registration Node installs under `--expose-internals` |
| `@deepseek-ai/node-addon-system` gates flock to linux/darwin | every session write fails: the JSONL store takes the lock as its cross-process lease | the gate accepts `android`; the toolkit compiles `flock.c` and publishes `node-addon-system-android-<arch>` |
| Android sepolicy denies `link(2)` inside app data directories | the JSONL store publishes a new log with `link(2)`, so the first write of every session fails | publication falls back to same-filesystem `rename(2)` for `EACCES`/`EPERM` |
| the same denial rejects the no-replace hard link used for create-if-absent writes | creating any new file through the agent fails with `EACCES` | creation falls back to `O_EXCL`, keeping the no-replace guarantee |
| the same denial also rejects generation publication when a stored session migrates to a newer format | opening an older session fails with `EACCES` before it can be upgraded | the target is inspected, then published by `rename(2)` |
| the attachment store fsyncs every DSH_HOME ancestor, including `/data/data` | every upload fails with `EACCES` before any bytes are stored | the durability walk stops at the highest ancestor Android lets it sync |
| file uploads publish a digested object and its readable alias with two `link(2)` calls | the upload stages bytes, then fails as `ATTACHMENT_WRITE_FAILED` | the object is renamed into place and the alias is copied |
| `sharp` ships no android-arm64 binary | every image attachment fails with `Could not load the "sharp" module using the android-arm64 runtime` | sharp is compiled on device against Termux libvips |

## Requirements

- Termux on android-arm64. DeepSeek Harness 0.2.2 requires Node >= 24.9; 0.2.0-rc.2 accepts >= 22.19. A C compiler is required (`pkg install nodejs clang` or the Termux `cc` wrapper).
- a DeepSeek Harness checkout: `git clone https://github.com/deepseek-ai/deepseek-harness ~/deepseek-harness`
- the JavaScript pnpm build the checkout pins: `npm install -g pnpm@11.7.0`
- image attachments only: `pkg install libvips` (headers for the sharp build)

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

`build` patches, installs, builds, and compiles both native pieces (the flock binding and sharp). `start` prints the token URL for `http://127.0.0.1:3081/`; the GUI rejects requests without that token. The instance keeps its sessions, storage, and settings in `~/.dsh-src` so it never shares state with an npm-installed `dsh`.

Install the shortcut into the shell rc file, then start from any new shell:

```sh
dsh-termux shell          # writes the dsh4termux block
dsh4termux setup          # doctor, build when needed, then start
dsh4termux                # start the Web UI
```

Or put the command on `PATH` instead of typing the path:

```sh
npm link ~/dsh-termux-toolkit
```

## Commands

| Command | Effect |
| --- | --- |
| `doctor` | prints platform, checkout version, patch state, binding state, and the resolved pnpm |
| `patch` | applies the five source patches; idempotent; `--check` only reports and exits 1 when upstream moved an anchor |
| `build` | patch, `pnpm install --frozen-lockfile --ignore-scripts`, then the artifact steps sequentially under one heap cap (referenced projects, host and client `tsc`, both bundles, Web) plus both native pieces; `--full` runs the repository's own `pnpm run build` |
| `setup` | `doctor`, then `build` when the checkout is not ready, then `start` |
| `start` | ensures the binding, then runs `node --expose-internals apps/cli/lib/bin.js web --port <port> --no-open` |
| `shell` | installs the `dsh4termux` shortcut into the shell rc file (`--print`, `--remove`, `--rc`) |
| `release` | assembles `dist/<platform>-<arch>-<version>/` with a manifest and checksums |

Options: `--repo <dir>` (default: nearest parent checkout, else `~/deepseek-harness`), `--port <n>`, `--restart`, `--dsh-home <dir>`, `--skip-install`, `--scripts`, `--memory-mb <n>`, `--headers <dir>`, `--cc <name>`, `--force`, `--strict`.

## What the patches do

| Patch | File | Change |
| --- | --- | --- |
| `flock-android` | `native/system/packages/entry/src/flock.ts` | platform gate accepts `android`; the entry keeps its `bin/system.node` filename because bionic is neither glibc nor musl |
| `internals-fallback` | `packages/boot/app-boot/src/profile-resolution/resolver.ts` | a failed `require('node-addon-require-builtin')` falls back to `require('internal/modules/*')`, available under `--expose-internals` |
| `session-link-fallback` | `packages/session/session-persistence-jsonl/src/index.ts` | `link(2)` denied with `EACCES`/`EPERM` retries publication with `rename(2)` |
| `migration-publish-fallback` | `packages/session/session-persistence-jsonl/src/generation.ts` | a denied `link(2)` inspects the target, then publishes the verified generation with `rename(2)` |
| `fs-create-fallback` | `packages/fs/fs-local/src/fsio.ts` | a denied no-replace hard link creates the destination with `O_EXCL` instead |
| `attachment-durability` | `packages/attachment/attachment-local/src/store.ts` | the ancestor fsync walk stops at a directory Android refuses to open |
| `attachment-link-fallback` | `packages/attachment/attachment-local/src/store.ts` | a denied object link renames the staged file; a denied alias link copies it |

Each patched block carries a `dsh-termux` comment, so `grep -rn dsh-termux` lists every touched site. [docs/patches.md](docs/patches.md) states the failure each patch removes and the guarantee each one weakens.

## Guarantees and costs

- **Session lock** is a real POSIX `flock` on bionic; concurrency semantics match Linux.
- **Session publication** stays atomic and durable. `link(2)` fails with `EEXIST` when the final path exists, so two processes cannot clobber one another. `rename(2)` overwrites silently, so the Android fallback narrows that guarantee to the preceding `rejectExistingLog()` check: a concurrent writer of the same session id can now win the race. The window is a single session id created simultaneously by two processes.
- **Create-if-absent** keeps its no-replace guarantee through `O_EXCL`; the difference is visibility, because the destination is readable while its bytes are copied, where the hard link made the complete file appear at once.
- **`--expose-internals`** is process-wide. The toolkit always passes it; launching the checkout with a bare `node apps/cli/lib/bin.js` on a host without the native binding exits with a message naming the flag.

## Local release build

`dsh-termux release` assembles `dist/<platform>-<arch>-<version>/` on the building host, the same
way the JMNeXt desktop packages are put together: swap the architecture-specific pieces you have,
verify structure, and state what was not run.

| Included | Verified | Not verified |
| --- | --- | --- |
| toolkit sources, docs, license | SHA-256 of every file in `checksums.txt` | — |
| the host-built flock binding, when present | ELF class and machine match `process.arch` | the binding is not executed on another architecture |

`manifest.json` records the platform, architecture, Node version, binding ELF facts, and the same
file digests. A binding from a different architecture aborts the build instead of shipping.

## Known upstream test divergences

Eleven upstream tests encode behaviour this device cannot produce: hard-link identity, an IO-failure classification for the policy `EACCES`, an unsupported-platform rejection, an fsync walk above the app data directory, and two staged-candidate checks whose injected truncation does not reach the verifier here (they fail without the patches too). They fail on a Termux device with the patches applied; the product paths they cover succeed through the fallbacks:

- `packages/fs/fs-local/tests/fsio.spec.ts` — "maps a non-collision guarded-create publication failure and cleans staging" (injects the `EACCES` that Android produces as policy)
- `packages/session/session-persistence-jsonl/tests/generation.spec.ts` — "accepts an identical publication winner and rejects different bytes", "accepts an identical regular hardlink target", "retains a POSIX publication after the directory sync fails", "reports success after exclusive publication when redundant stage cleanup fails", "accepts an identical target that wins POSIX publication" (each creates a real hard link while simulating a non-Android platform)
- `native/system/test/flock.test.js` — "import succeeds with native addons disabled" (asserts the unsupported-platform rejection the patch removes)
- `packages/attachment/attachment-local/tests/file-store.spec.ts` — "deduplicates identical bytes and stores distinct names beside one digest" (asserts that two alias names share one inode, which a copy cannot do)
- `packages/attachment/attachment-local/tests/store.spec.ts` — "syncs every object ancestor up to the durable boundary before returning" (expects syncs above `/data/data`, which Android refuses)
- `packages/session/session-persistence-jsonl/tests/generation.spec.ts` — "rejects a torn staged candidate before publication", "rejects a invalid-json staged candidate before publication" (fail here without the patches as well)

The `packages/boot/app-boot` profile-resolution suite is not run on the device: its workers need the native binding or `--expose-internals`, and Node refuses that flag in `NODE_OPTIONS`. The boot smoke covers the same resolver path.

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
- The flock binding is compiled for the running Node, so a Node major upgrade needs `build` (or `start`, which recompiles a missing binding) to run the compiler again.
- The sharp build needs Termux `libvips`; without it, files still upload and images fail. `doctor` reports which one is missing.
- `dsh-termux-toolkit` is unaffiliated with DeepSeek; it patches a checkout you own.

## Tests

```sh
npm test
```

The suite patches excerpted upstream files, proves anchors are unique and idempotent, refuses half-applied checkouts, and (when a checkout is present) asserts every anchor still matches real upstream. There is no CI: the release check runs locally, against the checkout you build.

[docs/verification.md](docs/verification.md) records the device run: the `link(2)` denial, the compile, the test counts, and the boot with the binding forced unavailable.

## License

MPL-2.0. Every toolkit source file carries the Exhibit A notice: modifications to those files stay under the MPL, while the toolkit can still be combined with other code. The patched DeepSeek Harness files remain MIT, as does the upstream text quoted in `test/fixtures/`.
