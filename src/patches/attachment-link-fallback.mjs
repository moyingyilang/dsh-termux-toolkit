/** Publish attachments where Android sepolicy denies link(2). */
export const attachmentLinkFallback = {
  id: 'attachment-link-fallback',
  title: 'Publish immutable attachments without link(2)',
  since: '0.2.0-rc.2',
  problem:
    'The attachment store publishes a digested object with link(2) and adds the readable alias with a '
    + 'second link(2). Android sepolicy denies both inside app data directories, so an uploaded file '
    + 'is staged and then discarded as ATTACHMENT_WRITE_FAILED.',
  fix:
    'A denied object link publishes the staged file by same-filesystem rename(2), after checking the '
    + 'target so an existing digest still takes the deduplication path. A denied alias link copies the '
    + 'object instead, because the source name must survive. Both keep the read-only mode and durable '
    + 'directory syncs.',
  edits: [
    {
      file: 'packages/attachment/attachment-local/src/store.ts',
      before: `import { chmod, link, mkdir, open, readFile, unlink } from 'node:fs/promises'`,
      after: `import { chmod, copyFile, link, mkdir, open, readFile, rename, stat, unlink } from 'node:fs/promises'`,
    },
    {
      file: 'packages/attachment/attachment-local/src/store.ts',
      before: `async function digestFile(path: string): Promise<string> {`,
      after: `/** Whether a publication target already exists, with no assumption about its type. */
async function targetExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    // dsh-termux: an absent target is the ordinary first-publication answer.
    return false
  }
}

async function digestFile(path: string): Promise<string> {`,
    },
    {
      file: 'packages/attachment/attachment-local/src/store.ts',
      before: `    await ensureDurableDirectory(parent, staged.boundary)
    try {
      await link(staged.path, target)
    } catch (error) {
      /* v8 ignore next -- Private same-filesystem directories make EEXIST the only recoverable link race. */
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
      if (await digestFile(target) !== staged.sha256) {
        throw new AttachmentError('Stored attachment failed integrity verification.', 'ATTACHMENT_CORRUPT')
      }
    }
    // Windows shares the read-only attribute across hard links and refuses to
    // unlink either name once it is set, so discard the staging name first.
    await unlink(staged.path)`,
      after: `    await ensureDurableDirectory(parent, staged.boundary)
    let stagingNameConsumed = false
    try {
      await link(staged.path, target)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      // dsh-termux: Android sepolicy denies link(2) inside app data directories.
      // rename(2) keeps the publication atomic but cannot report a collision, so
      // an existing target takes the deduplication path instead.
      if (process.platform === 'android' && (code === 'EACCES' || code === 'EPERM')) {
        if (await targetExists(target)) {
          if (await digestFile(target) !== staged.sha256) {
            throw new AttachmentError('Stored attachment failed integrity verification.', 'ATTACHMENT_CORRUPT')
          }
        } else {
          await rename(staged.path, target)
          stagingNameConsumed = true
        }
      } else if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
      else if (await digestFile(target) !== staged.sha256) {
        throw new AttachmentError('Stored attachment failed integrity verification.', 'ATTACHMENT_CORRUPT')
      }
    }
    // Windows shares the read-only attribute across hard links and refuses to
    // unlink either name once it is set, so discard the staging name first.
    if (!stagingNameConsumed) await unlink(staged.path)`,
    },
    {
      file: 'packages/attachment/attachment-local/src/store.ts',
      before: `    try {
      await link(source, target)
    } catch (error) {
      /* v8 ignore next -- Private same-filesystem directories make EEXIST the only recoverable link race. */
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
      if (await digestFile(target) !== sha256) {
        throw new AttachmentError('Stored attachment failed integrity verification.', 'ATTACHMENT_CORRUPT')
      }
    }`,
      after: `    try {
      await link(source, target)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      // dsh-termux: no hard links on Android, so the readable alias is an
      // exclusive copy of the already durable object.
      if (process.platform === 'android' && (code === 'EACCES' || code === 'EPERM')) {
        try {
          await copyFile(source, target, constants.COPYFILE_EXCL)
        } catch (copyError) {
          if (!(copyError instanceof Error && 'code' in copyError && copyError.code === 'EEXIST')) throw copyError
          if (await digestFile(target) !== sha256) {
            throw new AttachmentError('Stored attachment failed integrity verification.', 'ATTACHMENT_CORRUPT')
          }
        }
      } else if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
      else if (await digestFile(target) !== sha256) {
        throw new AttachmentError('Stored attachment failed integrity verification.', 'ATTACHMENT_CORRUPT')
      }
    }`,
    },
  ],
}
