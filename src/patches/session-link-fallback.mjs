/** Publish session logs where Android sepolicy denies link(2). */
export const sessionLinkFallback = {
  id: 'session-link-fallback',
  title: 'Fall back to rename(2) when link(2) is denied',
  since: '0.2.0-rc.2',
  problem:
    'Android sepolicy denies hard links inside app data directories, so the JSONL session store\'s '
    + 'link(2) publication of a new log fails with EACCES/EPERM and every first session write fails.',
  fix:
    'Publication falls back to same-filesystem rename(2) for EACCES/EPERM only. The publish stays '
    + 'atomic and durable; the no-clobber guarantee link() provides narrows to the preceding '
    + 'rejectExistingLog() check, so a concurrent writer can win that race.',
  edits: [
    {
      file: 'packages/session/session-persistence-jsonl/src/index.ts',
      before: `import { open, mkdir, readdir, realpath, link, rm, stat, truncate } from 'node:fs/promises'`,
      after: `import { open, mkdir, readdir, realpath, link, rename, rm, stat, truncate } from 'node:fs/promises'`,
    },
    {
      file: 'packages/session/session-persistence-jsonl/src/index.ts',
      before: `      await link(tmp, finalPath)
      linked = true
    } finally {`,
      after: `      await link(tmp, finalPath)
      linked = true
    } catch (error) {
      // dsh-termux: Android sepolicy denies link(2) inside app data
      // directories, so publication falls back to same-filesystem rename. The
      // log stays atomic; only link()'s no-clobber guarantee narrows to the
      // rejectExistingLog() check above.
      const code = (error as NodeJS.ErrnoException).code
      if (process.platform !== 'android' || (code !== 'EACCES' && code !== 'EPERM')) throw error
      await rename(tmp, finalPath)
      linked = true
    } finally {`,
    },
  ],
}
