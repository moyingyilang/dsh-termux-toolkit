// Excerpt of packages/session/session-persistence-jsonl/src/index.ts from DeepSeek Harness 0.2.0-rc.2, kept verbatim so the
// patch anchors can be exercised without a full checkout.
import { open, mkdir, readdir, realpath, link, rm, stat, truncate } from 'node:fs/promises'

    await this.rejectExistingLog(finalPath, id)
    const tmp = await this.writeSyncedTempFile(finalPath, content)
    // Publish via link()+unlink(), NOT rename(): link fails with EEXIST if the
    // final path already exists, so two processes materializing the same id
    // concurrently cannot clobber each other. rename() would silently overwrite.
    let linked = false
    try {
      await link(tmp, finalPath)
      linked = true
    } finally {
      // Remove an unpublished temp on failure. After publication, defer cleanup
