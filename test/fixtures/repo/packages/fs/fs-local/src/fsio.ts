// Excerpt of packages/fs/fs-local/src/fsio.ts from DeepSeek Harness 0.2.0-rc.2, kept verbatim so the
// patch anchors can be exercised without a full checkout.
function isEEXIST(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST'
}

      try {
        await linkFile(tempPath, absolutePath)
      } catch (error: unknown) {
        await throwGuardedCreateFailure(error, absolutePath, createIfAbsent.displayPath, inspectPublicationTarget)
      }
    } else if (platform === 'win32' && mode !== undefined) {
      try {
