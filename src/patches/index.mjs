/** Every source patch the toolkit applies, in application order. */
import { flockAndroid } from './flock-android.mjs'
import { internalsFallback } from './internals-fallback.mjs'
import { sessionLinkFallback } from './session-link-fallback.mjs'
import { migrationPublishFallback } from './migration-publish-fallback.mjs'
import { fsCreateFallback } from './fs-create-fallback.mjs'

export const patches = [flockAndroid, internalsFallback, sessionLinkFallback, migrationPublishFallback, fsCreateFallback]
