// Excerpt of packages/attachment/attachment-local/src/store.ts from DeepSeek Harness 0.2.0-rc.2,
// kept verbatim so the patch anchors can be exercised without a full checkout.
import { chmod, link, mkdir, open, readFile, unlink } from 'node:fs/promises'

  await mkdir(target, { recursive: true, mode: 0o700 })
  await chmod(target, 0o700)
  let level = target
  while (level !== stop) {
    const parent = dirname(level)
    await syncDirectory(parent)
    /* v8 ignore next -- filesystem-root guard: callers pass a boundary that is an ancestor of path, so the walk reaches it first. */
    if (parent === level) return
    level = parent
  }
}

async function digestFile(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path) as AsyncIterable<Buffer>) hash.update(chunk)

    await ensureDurableDirectory(parent, staged.boundary)
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
    await unlink(staged.path)
    // The target remains the sole link for a new object; this also restores
    // read-only mode when the deduplication path observes an existing object.

    await ensureDurableDirectory(parent, boundary)
    try {
      await link(source, target)
    } catch (error) {
      /* v8 ignore next -- Private same-filesystem directories make EEXIST the only recoverable link race. */
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
      if (await digestFile(target) !== sha256) {
        throw new AttachmentError('Stored attachment failed integrity verification.', 'ATTACHMENT_CORRUPT')
      }
    }
    await chmod(target, 0o400)
