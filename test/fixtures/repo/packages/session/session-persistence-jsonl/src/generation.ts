// Excerpt of packages/session/session-persistence-jsonl/src/generation.ts from DeepSeek Harness 0.2.0-rc.2,
// kept verbatim so the patch anchors can be exercised without a full checkout.
  readFile as fsReadFile,
  readdir as fsReaddir,
  rm as fsRm,

async function publishCurrentExclusive(
  staged: string,
  currentPath: string,
  internals: JsonlGenerationInternals,
): Promise<boolean> {
      throw error
    }
  }
  try {
    await internals.fs.link(staged, currentPath)
  } catch (error) {
    /* v8 ignore else -- a non-collision filesystem error propagates unchanged. */
    if (isEEXIST(error)) return false
    /* v8 ignore next -- the filesystem error is already complete. */
    throw error
  }
  await syncDirectory(dirname(currentPath), internals)
  return true
}
