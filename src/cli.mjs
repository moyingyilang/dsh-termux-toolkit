/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */
/** Command dispatch for `dsh-termux`. */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { buildRepo, DEFAULT_MEMORY_MB, patchCheckout } from './build.mjs'
import { doctor } from './doctor.mjs'
import { describeProblems, inspectPatches } from './patch-engine.mjs'
import { patches } from './patches/index.mjs'
import { locateRepo } from './repo.mjs'
import { releaseBundle } from './release.mjs'
import { blockInstalled, installShell, renderBlock, resolveShell, SHORTCUT } from './shell.mjs'
import { DEFAULT_PORT, startWeb } from './start.mjs'

const USAGE = `dsh-termux — build and run DeepSeek Harness natively on Android/Termux

Usage:
  dsh-termux doctor  [--repo <dir>] [--strict]
  dsh-termux patch   [--repo <dir>] [--check]
  dsh-termux build   [--repo <dir>] [--skip-install] [--scripts] [--memory-mb <n>]
  dsh-termux setup   [--repo <dir>] [--port <n>] [--restart] [--dsh-home <dir>]
  dsh-termux start   [--repo <dir>] [--port <n>] [--restart] [--dsh-home <dir>]
  dsh-termux shell   [--rc <file>] [--print] [--remove]
  dsh-termux release [--repo <dir>] [--out <dir>]
  dsh-termux version

Commands:
  doctor   Report platform, checkout, patch, binding, and pnpm state.
  patch    Apply this device's source patches (idempotent); --check only reports.
  build    Patch, install, build, and compile the flock binding.
  setup    doctor, build when the checkout is not ready, then start.
  start    Start the Web UI on 127.0.0.1 with --expose-internals.
  shell    Install the dsh4termux shortcut into the shell rc file.
  release  Assemble dist/<platform>-<arch>-<version> with checksums.

Options:
  --repo <dir>      DeepSeek Harness checkout (default: nearest parent checkout)
  --check           Report patch state; exit 1 when upstream changed an anchor.
  --skip-install    Skip pnpm install; reuse the existing node_modules tree.
  --scripts         Run dependency install scripts (off by default: Windows-only builds).
  --memory-mb <n>   Heap limit for the build (default: ${String(DEFAULT_MEMORY_MB)}).
  --port <n>        Web UI port (default: ${String(DEFAULT_PORT)}).
  --restart         Replace this checkout's instance already on the port.
  --dsh-home <dir>  DSH_HOME for this instance (default: ~/.dsh-src).
  --headers <dir>   Node-API headers for the flock binding.
  --cc <name>       C compiler for the flock binding (default: cc).
  --rc <file>       Shell rc file for the shell command (default: $SHELL rc).
  --print           Print the shortcut block instead of writing it.
  --remove          Remove the shortcut block.
  --out <dir>       Release output directory (default: ./dist).
  --force           Rebuild the flock binding even when it is newer than its source.
  --strict          doctor exits 1 when the checkout cannot run.
  --help            Print this text.
`

/**
 * Read the toolkit's own version.
 * @returns Version string from this package.
 */
/**
 * Absolute path of this CLI, as the shortcut must invoke it.
 * @returns Absolute entry path.
 */
function toolkitEntry() {
  return fileURLToPath(new URL('../bin/dsh-termux.mjs', import.meta.url))
}

function toolkitVersion() {
  const manifest = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'))
  return String(manifest.version)
}

/**
 * Run one command.
 * @param argv Arguments after the executable.
 * @returns Process exit code.
 */
export async function main(argv) {
  let parsed
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        repo: { type: 'string' },
        check: { type: 'boolean' },
        'skip-install': { type: 'boolean' },
        scripts: { type: 'boolean' },
        'memory-mb': { type: 'string' },
        port: { type: 'string' },
        restart: { type: 'boolean' },
        'dsh-home': { type: 'string' },
        rc: { type: 'string' },
        print: { type: 'boolean' },
        remove: { type: 'boolean' },
        out: { type: 'string' },
        headers: { type: 'string' },
        cc: { type: 'string' },
        force: { type: 'boolean' },
        strict: { type: 'boolean' },
        help: { type: 'boolean' },
      },
    })
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`)
    return 2
  }

  const { values, positionals } = parsed
  const command = positionals[0] ?? (values.help === true ? 'help' : 'help')
  if (values.help === true) {
    process.stdout.write(USAGE)
    return 0
  }
  try {
    switch (command) {
      case 'version':
        process.stdout.write(`dsh-termux ${toolkitVersion()}\n`)
        return 0
      case 'help':
        process.stdout.write(USAGE)
        return 0
      case 'doctor': {
        const report = doctor(locateRepo(values.repo))
        process.stdout.write(`${report.lines.join('\n')}\n`)
        return values.strict === true && !report.healthy ? 1 : 0
      }
      case 'patch': {
        const root = locateRepo(values.repo)
        if (values.check === true) {
          const inspections = inspectPatches(root, patches)
          for (const inspection of inspections) {
            process.stdout.write(`${inspection.patch.id.padEnd(24)} ${inspection.state}\n`)
          }
          const problems = describeProblems(inspections)
          if (problems.length > 0) {
            process.stderr.write(`\n${problems.join('\n')}\n`)
            return 1
          }
          return 0
        }
        patchCheckout(root)
        return 0
      }
      case 'build': {
        buildRepo(locateRepo(values.repo), {
          skipInstall: values['skip-install'] === true,
          scripts: values.scripts === true,
          memoryMb: values['memory-mb'] === undefined ? undefined : Number(values['memory-mb']),
          headers: values.headers,
          cc: values.cc,
          force: values.force === true,
        })
        return 0
      }
      case 'setup': {
        const root = locateRepo(values.repo)
        if (!doctor(root).healthy) {
          process.stdout.write('dsh-termux: checkout is not ready; building\n')
          buildRepo(root, {
            skipInstall: values['skip-install'] === true,
            scripts: values.scripts === true,
            memoryMb: values['memory-mb'] === undefined ? undefined : Number(values['memory-mb']),
            headers: values.headers,
            cc: values.cc,
            force: values.force === true,
          })
        }
        return await startWeb(root, {
          port: values.port === undefined ? undefined : Number(values.port),
          restart: values.restart === true,
          dshHome: values['dsh-home'],
          headers: values.headers,
          cc: values.cc,
        })
      }
      case 'shell': {
        const { path, flavor } = resolveShell({ override: values.rc })
        if (values.print === true) {
          process.stdout.write(renderBlock(toolkitEntry(), flavor))
          return 0
        }
        const result = installShell({ path, flavor, toolkit: toolkitEntry(), remove: values.remove === true })
        if (!result.changed) {
          process.stdout.write(`dsh-termux: ${values.remove === true ? 'no shortcut in' : 'unchanged'} ${path}\n`)
          return 0
        }
        if (values.remove === true) process.stdout.write(`dsh-termux: removed ${SHORTCUT} from ${path}\n`)
        else process.stdout.write(`dsh-termux: installed ${SHORTCUT} in ${path}\n`)
        return 0
      }
      case 'release': {
        const bundle = releaseBundle(locateRepo(values.repo), { out: values.out })
        process.stdout.write(`dsh-termux: ${bundle.directory} (${String(bundle.files.length)} files)\n`)
        return 0
      }
      case 'start': {
        return await startWeb(locateRepo(values.repo), {
          port: values.port === undefined ? undefined : Number(values.port),
          restart: values.restart === true,
          dshHome: values['dsh-home'],
          headers: values.headers,
          cc: values.cc,
        })
      }
      default:
        process.stderr.write(`dsh-termux: unknown command "${command}"\n\n${USAGE}`)
        return 2
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
}
