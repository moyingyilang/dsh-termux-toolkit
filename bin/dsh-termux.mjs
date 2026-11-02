#!/usr/bin/env node

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
/** Command entry point; all behavior lives in `src/cli.mjs`. */
import { main } from '../src/cli.mjs'

process.exitCode = await main(process.argv.slice(2))
