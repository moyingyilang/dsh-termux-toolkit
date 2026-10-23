/** Create files where Android sepolicy denies the no-replace hard link. */
export const fsCreateFallback = {
  id: 'fs-create-fallback',
  title: 'Create-if-absent without link(2)',
  since: '0.2.0-rc.2',
  problem:
    'The local filesystem provider publishes a new file with link(2) so a concurrent creator cannot '
    + 'be replaced. Android sepolicy denies hard links inside app data directories, so every '
    + 'create-if-absent write (the agent\'s new-file writes) fails with a raw EACCES.',
  fix:
    'A denied link falls back to opening the destination with O_EXCL, which keeps the no-replace '
    + 'guarantee and writes through the created descriptor. Unlike the hard-link publication, the '
    + 'destination is visible while its bytes are copied.',
  edits: [
    {
      file: 'packages/fs/fs-local/src/fsio.ts',
      before: `function isEEXIST(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST'
}`,
      after: `function isEEXIST(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST'
}

function isPermissionDenied(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error.code === 'EACCES' || error.code === 'EPERM')
}

/**
 * Create a destination that must not replace an existing entry.
 *
 * Android sepolicy denies link(2) inside app data directories, so O_EXCL takes
 * over the no-replace guarantee: a concurrent creator keeps its file and this
 * write fails through the same guarded-create taxonomy. The destination is
 * visible while its bytes are copied, unlike hard-link publication.
 * @param absolutePath - destination to create; it must not exist.
 * @param content - the full UTF-8 text to write.
 * @param mode - POSIX mode to apply after creation, or \`undefined\` to keep 0o600.
 * @param displayPath - path used in failure messages.
 * @param inspectPublicationTarget - stats of the destination after a failure.
 * @returns a promise resolving once the destination is written and synced.
 */
async function createExclusive(
  absolutePath: string,
  content: string,
  mode: number | undefined,
  displayPath: string,
  inspectPublicationTarget: (path: string) => Promise<BigIntStats>,
): Promise<void> {
  let created: Awaited<ReturnType<typeof open>>
  try {
    created = await open(absolutePath, 'wx', 0o600)
  } catch (error: unknown) {
    return throwGuardedCreateFailure(error, absolutePath, displayPath, inspectPublicationTarget)
  }
  try {
    await created.writeFile(content, { encoding: 'utf8' })
    await created.sync()
    if (mode !== undefined) await created.chmod(mode)
  } finally {
    await created.close()
  }
}`,
    },
    {
      file: 'packages/fs/fs-local/src/fsio.ts',
      before: `      } catch (error: unknown) {
        await throwGuardedCreateFailure(error, absolutePath, createIfAbsent.displayPath, inspectPublicationTarget)
      }`,
      after: `      } catch (error: unknown) {
        // dsh-termux: Android sepolicy denies link(2) inside app data
        // directories, so create-if-absent publishes through O_EXCL instead.
        if (platform === 'android' && isPermissionDenied(error)) {
          await createExclusive(absolutePath, content, mode, createIfAbsent.displayPath, inspectPublicationTarget)
        } else {
          await throwGuardedCreateFailure(error, absolutePath, createIfAbsent.displayPath, inspectPublicationTarget)
        }
      }`,
    },
  ],
}
