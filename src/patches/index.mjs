/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
/** Every source patch the toolkit applies, in application order. */
import { flockAndroid } from './flock-android.mjs'
import { internalsFallback } from './internals-fallback.mjs'
import { sessionLinkFallback } from './session-link-fallback.mjs'
import { migrationPublishFallback } from './migration-publish-fallback.mjs'
import { fsCreateFallback } from './fs-create-fallback.mjs'
import { attachmentDurability } from './attachment-durability.mjs'
import { attachmentLinkFallback } from './attachment-link-fallback.mjs'

export const patches = [
  flockAndroid,
  internalsFallback,
  sessionLinkFallback,
  migrationPublishFallback,
  fsCreateFallback,
  attachmentDurability,
  attachmentLinkFallback,
]
