# Device verification

Recorded on one Termux device so the claims in the README can be reproduced or refuted.

| Fact | Value |
| --- | --- |
| host | `android-arm64`, Node `v24.22.2` |
| checkout | DeepSeek Harness `0.2.2-rc.1` (the create-if-absent patch also matches `0.2.0-rc.2`) |
| pinned package manager | `pnpm@11.28.5` (JavaScript build) |
| compiler | Termux `cc`, libvips `8.18.7`, openexr `3.5.3` |

## The platform denial

```text
$ node -e "link() then rename() in $HOME"
link: EACCES
rename: allowed
```

Android sepolicy denies `link(2)` inside app data directories and allows `rename(2)`. Every fallback in the toolkit keys off exactly this pair.

## Build

The repository's own `pnpm run build` runs a `--max-old-space-size=8192` TypeScript
compilation beside a concurrent `build:check`. On this device that budget is what the
Android low-memory killer reclaims, and it takes the running session down with it.

`dsh-termux build` therefore runs the artifact steps sequentially under one cap
(3072 MiB by default, `--memory-mb`): referenced projects, host `tsc`, client `tsc`,
host bundle, client bundle, Web build. Then the two native pieces:

- the flock binding compiled from `src/flock.c` into
  `native/system/node_modules/@deepseek-ai/node-addon-system-<platform>-<arch>/bin/system.node`;
- sharp `0.35.5` compiled against Termux libvips (`sharp-android-arm64-0.35.5.node`).

`libvips 8.18.7-2` needs `openexr 3.5`; without it sharp fails with
`library "libOpenEXR-3_5.so" not found` and every image attachment fails. `pkg install openexr`
fixes it. The optional vips-magick module then warns because ImageMagick still links
`libOpenEXR-3_4.so`; core libvips operations are unaffected.

## Test suites on device, patched

| Suite | Result | Remaining failures |
| --- | --- | --- |
| `packages/fs/fs-local` | 204 passed, 1 failed | injects the `EACCES` Android raises as policy and expects `FS_IO_ERROR` |
| `packages/session/session-persistence-jsonl` | 758 passed, 7 failed, 1 skipped | five hard-link identity tests, plus the torn and invalid-json staged-candidate tests that fail here without the patches too |
| `packages/attachment/attachment-local` | 96 passed, 2 failed | inode-identical aliases and fsyncs above `/data/data` |
| `packages/boot/app-boot` profile resolution | not run | the suite requires the native binding or `--expose-internals` inside each test worker |

The boot smoke covers the resolver path instead.

## Boot

```text
$ DSH_HOME=<temp> node --expose-internals apps/cli/lib/bin.js web --port 3191 --no-open
dsh web: http://127.0.0.1:3191/?token=<token>
$ curl -L -b cookies -c cookies 'http://127.0.0.1:3191/?token=<token>'
final=200
<title>DSH Local Build</title>
```

## Upload probe

With the attachment patches applied, the source tree stores a file and an image into a
real DSH_HOME on this device:

```text
file stored: notes.txt hello termux
image stored: sha256:ab13... 64x32 bytes 156
```

## Release check

`dsh-termux release` assembles `dist/<platform>-<arch>-<version>/`, verifies the flock
binding's ELF class and machine, and records SHA-256 for every file. The binding is not
executed on another architecture.
