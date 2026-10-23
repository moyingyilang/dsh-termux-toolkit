/** Let the POSIX flock entry load a locally compiled Android binding. */
export const flockAndroid = {
  id: 'flock-android',
  title: 'Accept android in the flock platform gate',
  since: '0.2.0-rc.2',
  problem:
    '`@deepseek-ai/node-addon-system` rejects every platform but linux and darwin with '
    + 'ERR_FLOCK_UNSUPPORTED_PLATFORM. The JSONL session store takes that lock as its cross-process '
    + 'write lease, so on Android every session write fails before the first turn.',
  fix:
    'The gate accepts android. Android is Linux with bionic libc, so the checked-in flock.c builds '
    + 'unchanged and the toolkit publishes it as the `node-addon-system-android-<arch>` platform '
    + 'package the entry resolves (`bin/system.node`, no glibc/musl split).',
  edits: [
    {
      file: 'native/system/packages/entry/src/flock.ts',
      before: `  if (platform !== 'linux' && platform !== 'darwin') {`,
      after: `  // dsh-termux: bionic is Linux; the toolkit compiles this flock.c for android.
  if (platform !== 'linux' && platform !== 'darwin' && platform !== 'android') {`,
    },
  ],
}
