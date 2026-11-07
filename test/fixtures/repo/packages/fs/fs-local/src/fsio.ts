// Excerpt of packages/fs/fs-local/src/fsio.ts from DeepSeek Harness 0.2.2-rc.1, kept verbatim so the
// patch anchors can be exercised without a full checkout.
function writeIoError(path: string, error: unknown): unknown {
  if (error instanceof FsError) return error
  if (isPermissionError(error)) return new FsError(`cannot write "${path}": permission denied`, 'FS_PERMISSION_DENIED', { cause: error })
  if (error instanceof Error && 'code' in error && typeof error.code === 'string') {
    return new FsError(`cannot write "${path}": ${error.message}`, 'FS_IO_ERROR', { cause: error })
  }
  return error
}


    if (options.createIfAbsent) {
      try {
        await linkFile(tempPath, absolutePath)
      } catch (error: unknown) {
        await throwGuardedCreateFailure(error, absolutePath, displayPath, inspectPublicationTarget)
      }
    } else if (platform === 'win32' && existingDestination) {
      try {
        await replaceFile(absolutePath, tempPath)
      } catch (error: unknown) {
