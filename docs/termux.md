# Building and running on Termux

## Environment

| Requirement | Why |
| --- | --- |
| android-arm64, Node >= 22.19 | the checkout's engines range and its client compiler |
| a C compiler (`cc`) | the flock binding is compiled on the device; no prebuild exists for bionic |
| `npm install -g pnpm@11.7.0` | the checkout pins that version; pnpm 10+ would otherwise switch to `@pnpm/exe`, which has no android-arm64 binary |
| Node-API headers | `<prefix>/include/node`; the toolkit also checks `/usr/include/node` and `--headers` |

The toolkit never mutates a global tool installation and never downloads a prebuilt addon.

## What `build` runs

```sh
dsh-termux patch
node <js-pnpm>/bin/pnpm.cjs install --frozen-lockfile --ignore-scripts
NODE_OPTIONS=--max-old-space-size=4096 node <js-pnpm>/bin/pnpm.cjs run build
node <cc> ... -shared -o .../@deepseek-ai/node-addon-system-android-arm64/bin/system.node .../flock.c
```

- `--ignore-scripts` is not a shortcut. The dependency tree contains a Windows-only native build (`koffi`) that does not compile against bionic; the checkout's own build compiles what it needs.
- The 4 GiB heap is required by `tsc -b tsconfig.client.json`. Termux gives Node roughly 1.1 GiB by default, and the client compile is the step that exhausts it. `--memory-mb` overrides the limit.
- `pnpm run build` runs `build:native-system` first, which is a silent no-op on Android, then the host and client TypeScript builds, the runtime bundles, and the Web build.
- The binding is compiled after the build so it is newer than `flock.c`; `start` recompiles whenever it is missing, and `--force` rebuilds it unconditionally.

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

## Removing the toolkit

The patches are the only change to the checkout. Restore the four files (`git checkout --` them, as listed in the README) and delete the generated `native/system/node_modules/@deepseek-ai/node-addon-system-android-<arch>` directory.
