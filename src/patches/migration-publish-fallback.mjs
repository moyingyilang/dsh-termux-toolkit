/** Publish a verified session generation where Android denies link(2). */
export const migrationPublishFallback = {
  id: 'migration-publish-fallback',
  title: 'Publish a migrated generation without link(2)',
  since: '0.2.0-rc.2',
  problem:
    'Migrating a stored session to a newer format generation publishes the verified successor with '
    + 'link(2), which reports a collision as EEXIST. Android sepolicy denies the call inside app data '
    + 'directories, so opening any session that needs a format migration fails with EACCES.',
  fix:
    'A denied link inspects the target first, keeps the caller\'s "already exists" result, then '
    + 'publishes by same-filesystem rename. The generation stays atomic and durable; the collision '
    + 'check narrows to that inspection, so a concurrent publisher can win the race.',
  edits: [
    {
      file: 'packages/session/session-persistence-jsonl/src/generation.ts',
      before: `  readdir as fsReaddir,
  rm as fsRm,`,
      after: `  readdir as fsReaddir,
  rename as fsRename,
  rm as fsRm,`,
    },
    {
      file: 'packages/session/session-persistence-jsonl/src/generation.ts',
      before: `    /* v8 ignore else -- a non-collision filesystem error propagates unchanged. */
    if (isEEXIST(error)) return false
    /* v8 ignore next -- the filesystem error is already complete. */
    throw error
  }`,
      after: `    /* v8 ignore else -- a non-collision filesystem error propagates unchanged. */
    if (isEEXIST(error)) return false
    // dsh-termux: Android sepolicy denies link(2) inside app data directories.
    // rename(2) cannot report a collision, so inspect the target first and keep
    // the caller's "current generation already exists" result.
    if (internals.platform === 'android' && isErrnoException(error)
      && (error.code === 'EACCES' || error.code === 'EPERM')) {
      try {
        await internals.fs.lstat(currentPath)
        return false
      } catch (inspectionError) {
        if (!isErrnoException(inspectionError) || inspectionError.code !== 'ENOENT') throw inspectionError
      }
      await fsRename(staged, currentPath)
    } else {
      /* v8 ignore next -- the filesystem error is already complete. */
      throw error
    }
  }`,
    },
  ],
}
