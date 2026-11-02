/** Stop the attachment durability walk at the highest ancestor Android lets it sync. */
export const attachmentDurability = {
  id: 'attachment-durability',
  title: 'Sync attachment ancestors only where Android allows it',
  since: '0.2.0-rc.2',
  problem:
    'The attachment store proves DSH_HOME durable by fsyncing every ancestor up to the filesystem '
    + 'root. Android denies opening /data/data for the app user, so every attachment write fails with '
    + 'EACCES before any bytes are stored.',
  fix:
    'A denied ancestor on android ends the walk at the highest directory this process may sync; the '
    + 'operating system owns the entries above it. Other platforms keep the full walk.',
  edits: [
    {
      file: 'packages/attachment/attachment-local/src/store.ts',
      before: `  let level = target
  while (level !== stop) {
    const parent = dirname(level)
    await syncDirectory(parent)
    /* v8 ignore next -- filesystem-root guard: callers pass a boundary that is an ancestor of path, so the walk reaches it first. */
    if (parent === level) return
    level = parent
  }`,
      after: `  let level = target
  while (level !== stop) {
    const parent = dirname(level)
    try {
      await syncDirectory(parent)
    } catch (error) {
      // dsh-termux: Android denies opening ancestors above the app data
      // directory, so the walk ends at the highest directory it can sync.
      const code = (error as NodeJS.ErrnoException).code
      if (process.platform === 'android' && (code === 'EACCES' || code === 'EPERM')) return
      throw error
    }
    /* v8 ignore next -- filesystem-root guard: callers pass a boundary that is an ancestor of path, so the walk reaches it first. */
    if (parent === level) return
    level = parent
  }`,
    },
  ],
}
