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
import { DEFAULT_PORT, startWeb } from './start.mjs'

const USAGE = `dsh-termux — build and run DeepSeek Harness natively on Android/Termux

Usage:
  dsh-termux doctor  [--repo <dir>] [--strict]
  dsh-termux patch   [--repo <dir>] [--check]
  dsh-termux build   [--repo <dir>] [--skip-install] [--scripts] [--memory-mb <n>]
  dsh-termux start   [--repo <dir>] [--port <n>] [--restart] [--dsh-home <dir>]
  dsh-termux version

Commands:
  doctor   Report platform, checkout, patch, binding, and pnpm state.
  patch    Apply this device's source patches (idempotent); --check only reports.
  build    Patch, install, build, and compile the flock binding.
  start    Start the Web UI on 127.0.0.1 with --expose-internals.

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
  --force           Rebuild the flock binding even when it is newer than its source.
  --strict          doctor exits 1 when the checkout cannot run.
  --help            Print this text.
`

/**
 * Read the toolkit's own version.
 * @returns Version string from this package.
 */
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
