# Device verification

Recorded on one Termux device so the claims in the README can be reproduced or refuted.

| Fact | Value |
| --- | --- |
| host | `android-arm64`, Node `v24.18.0` |
| checkout | DeepSeek Harness `0.2.0-rc.2` |
| pinned package manager | `pnpm@11.7.0` (JavaScript build) |
| compiler | Termux `cc` |

## The platform denial

```text
$ node -e "link() then rename() in $HOME"
link: EACCES
rename: allowed
```

Android sepolicy denies `link(2)` inside app data directories and allows `rename(2)`. Every fallback in the toolkit keys off exactly this pair.

## Patches compile

`tsc -b` over the five patched projects exits 0:

```sh
node --max-old-space-size=4096 node_modules/typescript/bin/tsc -b \
  native/system/packages/entry \
  packages/fs/fs-local \
  packages/session/session-persistence-jsonl \
  packages/boot/app-boot
```

The emitted bundles carry the patched code (`builtinLoader`, `createExclusive`, `fsRename`, the android flock gate), so `pnpm run build` keeps the patches after regenerating `lib/`.

## Test suites on device, patched

| Suite | Result | Remaining failures |
| --- | --- | --- |
| `packages/fs/fs-local` | 160 passed, 1 failed | the test that injects the `EACCES` Android raises as policy and expects it to surface as `FS_IO_ERROR` |
| `packages/session/session-persistence-jsonl` | 732 passed, 5 failed, 1 skipped | the five tests that create a real hard link while asserting inode identity or a simulated non-Android platform |

Before the `migration-publish-fallback` patch landed, the session suite reported 132 failures; all were `EACCES` on `link(2)`. The five that remain are test-harness assumptions, listed in [patches.md](patches.md#android-test-divergences).

## Boot

With the native binding forced unavailable (upstream entry restored, no android prebuild):

```text
$ node apps/cli/lib/bin.js web --port 3183 --no-open
dsh: fatal uncaught exception: Error: dsh: host preparation failed: profile resolution:
  cannot load internal/modules/esm/loader; this platform requires --expose-internals
```

With the launcher flag:

```text
$ node --expose-internals apps/cli/lib/bin.js web --port 3185 --no-open
dsh web: http://127.0.0.1:3185/?token=<token>
$ curl -o /dev/null -w '%{http_code}' http://127.0.0.1:3185/            # 401 without the token
$ curl -L -b cookies -c cookies 'http://127.0.0.1:3185/?token=<token>'  # 200, 34 845 bytes
<title>DSH Local Build</title>
```

## flock binding

Compiled from `native/system/packages/entry/src/flock.c` into
`native/system/node_modules/@deepseek-ai/node-addon-system-android-arm64/bin/system.node`, and the
patched entry loads it. In `native/system/test/flock.test.js`, the addon-disabled case now reports
`ERR_DLOPEN_DISABLED` instead of `ERR_FLOCK_UNSUPPORTED_PLATFORM`, because android is a supported
platform; the other gate tests (win32, freebsd) still pass.
