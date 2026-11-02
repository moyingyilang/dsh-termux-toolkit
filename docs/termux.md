# Building and running on Termux

## Environment

| Requirement | Why |
| --- | --- |
| android-arm64, Node >= 22.19 | the checkout's engines range and its client compiler |
| a C compiler (`cc`) | the flock binding is compiled on the device; no prebuild exists for bionic |
| `npm install -g pnpm@11.7.0` | the checkout pins that version; pnpm 10+ would otherwise switch to `@pnpm/exe`, which has no android-arm64 binary |
| Node-API headers | `<prefix>/include/node`; the toolkit also checks `/usr/include/node` and `--headers` |
| `libvips` + `pkg-config` | image attachments: sharp is compiled against Termux libvips (`pkg install libvips`) |

The toolkit never mutates a global tool installation and never downloads a prebuilt addon.

## What `build` runs

```sh
dsh-termux patch
node <js-pnpm>/bin/pnpm.cjs install --frozen-lockfile --ignore-scripts
NODE_OPTIONS=--max-old-space-size=4096 node <js-pnpm>/bin/pnpm.cjs run build
node <cc> ... -shared -o .../@deepseek-ai/node-addon-system-android-arm64/bin/system.node .../flock.c
SHARP_FORCE_GLOBAL_LIBVIPS=1 npm_config_build_from_source=true node install/build.js   # in the installed sharp package
```

- `--ignore-scripts` is not a shortcut. The dependency tree contains a Windows-only native build (`koffi`) that does not compile against bionic; the checkout's own build compiles what it needs.
- The 4 GiB heap is required by `tsc -b tsconfig.client.json`. Termux gives Node roughly 1.1 GiB by default, and the client compile is the step that exhausts it. `--memory-mb` overrides the limit.
- `pnpm run build` runs `build:native-system` first, which is a silent no-op on Android, then the host and client TypeScript builds, the runtime bundles, and the Web build.
- The flock binding is compiled after the build so it is newer than `flock.c`; `start` recompiles whenever it is missing, and `--force` rebuilds both native pieces unconditionally.
- sharp has no android-arm64 binary, so its own loader falls back to a source build beside the package. The toolkit compiles it against the system libvips and puts `node-gyp` on `PATH` for that step, because sharp spawns the command by name. A `pnpm install` removes the build; `build` restores it.

## What `start` runs

```sh
node --expose-internals apps/cli/lib/bin.js web --port 3081 --no-open
```

- `--expose-internals` satisfies the resolver fallback. Without it, a host with no native binding exits with an error naming the flag.
- `--no-open` skips the browser launch; open the printed token URL yourself.
- `DSH_HOME` defaults to `~/.dsh-src`, so this instance keeps its own sessions, storage, profiles, and settings. Pass `--dsh-home` to move it.
- When the port already serves HTTP, the command reports the owner. With `--restart` it signals this checkout's instance and waits up to ten seconds for the port to free.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `ERR_PNPM_PNPM_ENGINE_NO_NATIVE_BINARY` while installing | the pinned pnpm resolved to `@pnpm/exe` | `npm install -g pnpm@11.7.0`, then rerun `build` |
| `dsh-termux: no matching JavaScript pnpm was found` | only a standalone pnpm is installed | install the pinned JavaScript build, or set `DSH_TERMUX_ALLOW_PNPM_MISMATCH=1` |
| `dsh-termux: no Node-API headers found` | the Node installation ships no headers | install matching headers or pass `--headers <dir>` |
| `patch --check` exits 1 | upstream changed an anchor | re-derive the edit in `src/patches/` |
| `the checkout is not patched` on `start` | sources were restored after the last build | run `build` |
| Web UI starts then exits on the first session write | the flock binding is missing or stale | rerun `build`, or `start` with the compiler available |
| `Cannot find module 'node-addon-require-builtin'` at boot | launched without `--expose-internals` and without the native binding | launch through `dsh-termux start` |
| attaching a file fails the send and the composer returns to the previous state | the attachment durability walk hit `/data/data`, or `pnpm install` removed the patched `lib/` | run `dsh-termux build`, then restart the instance |
| attaching an image fails with `Could not load the "sharp" module using the android-arm64 runtime` | sharp has no local build for bionic | `pkg install libvips`, run `dsh-termux build`, restart |

## Replacing a device-local script

A checkout patched by this toolkit no longer matches the lib-level scripts an earlier Termux setup may have used (for example a `start-web.sh` that rewrites `lib/` after each build): those scripts search for the unpatched publication block and stop when it is gone. After the first `dsh-termux build`, start the UI with `dsh-termux start` and retire the lib-level scripts.

## Shortcut and release

```sh
dsh-termux shell               # installs the dsh4termux block in $SHELL's rc file
dsh-termux shell --print       # show the block without writing
dsh-termux shell --remove      # take it out again
dsh4termux setup               # doctor, build when needed, then start
dsh-termux release --out dist  # local release directory with manifest and checksums
```

The block runs the CLI from this repository's absolute path, so reinstall it after moving the
checkout. [release.md](release.md) describes what the release verifies and what it does not.

## Removing the toolkit

The patches are the only change to the checkout. Restore the four files (`git checkout --` them, as listed in the README) and delete the generated `native/system/node_modules/@deepseek-ai/node-addon-system-android-<arch>` directory.
