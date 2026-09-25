import { spawn as spawnChild } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promises as fileSystem } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const currentDirectory = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(currentDirectory, '..')
const repositoryRoot = resolve(appRoot, '..')
const defaultOperationsRoot = join(repositoryRoot, 'services', 'prisma-runtime', 'operations')
const defaultViteCli = join(appRoot, 'node_modules', 'vite', 'bin', 'vite.js')

function waitForChild(child) {
  return new Promise((resolveChild, rejectChild) => {
    child.once('error', rejectChild)
    child.once('exit', (code, signal) => resolveChild({ code, signal }))
  })
}

function signalExitCode(signal) {
  return signal === 'SIGINT' ? 130 : 143
}

// Minimal, documented receipt-on-failure schema written by start-local.ps1 (T1b) when a
// foreign (non-Prisma) process blocks 5056/5057: { registered: false, failure: { reason:
// 'port_in_use', port, processName, pid } }. Only `reason` and `port` are forwarded to Vite;
// anything else (missing file, malformed JSON, an unknown reason, an out-of-range port) is
// treated as "no detectable failure detail" rather than surfaced as a hard error, since the
// launcher must still fall back to its existing generic warning either way.
const KNOWN_STARTUP_FAILURE_REASONS = new Set(['port_in_use'])

function parsePrismaStartupFailure(raw) {
  if (typeof raw !== 'object' || raw === null) return null
  if (raw.registered !== false) return null
  const failure = raw.failure
  if (typeof failure !== 'object' || failure === null) return null
  const { reason, port } = failure
  if (typeof reason !== 'string' || !KNOWN_STARTUP_FAILURE_REASONS.has(reason)) return null
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null
  return { reason, port }
}

// T4d: a detected startup failure (currently only port_in_use) is thrown by
// Invoke-PrismaStartTransaction's earliest guard, before any process is started or any
// development owner is ever registered in the manifest -- there is nothing to recover, and
// start-local.ps1 already printed its own single, clear terminal line for this case. Both
// call sites below treat any OTHER rejection exactly as before (recovery attempted, generic
// warning printed).
function hasPrismaStartupFailure(error) {
  return Boolean(error && typeof error === 'object' && 'failure' in error && error.failure)
}

export function createPowerShellRuntime({
  spawn = spawnChild,
  files = fileSystem,
  operationsRoot = defaultOperationsRoot,
  temporaryRoot = tmpdir(),
  newId = randomUUID,
  warn = (message) => console.warn(message),
  powershellExecutable = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
} = {}) {
  const acquisitions = new Map()

  async function runScript(script, argumentsList) {
    const child = spawn(
      powershellExecutable,
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(operationsRoot, script), ...argumentsList],
      { shell: false, windowsHide: true, stdio: 'inherit' },
    )
    const result = await waitForChild(child)
    if (result.code !== 0) {
      throw new Error(`${script} exited with code ${result.code ?? 'unknown'}.`)
    }
  }

  return {
    async acquire(ownerToken) {
      const operationId = newId()
      const receiptPath = join(temporaryRoot, `prisma-dev-${operationId}.json`)
      const cancellationPath = join(temporaryRoot, `prisma-dev-${operationId}.cancel`)
      acquisitions.set(ownerToken, cancellationPath)
      try {
        try {
          await runScript('start-local.ps1', [
            '-DevelopmentOwnerToken', ownerToken,
            '-DevelopmentOwnerProcessId', String(process.pid),
            '-DevelopmentReceiptPath', receiptPath,
            '-DevelopmentCancellationPath', cancellationPath,
            '-LockTimeoutMilliseconds', '10000',
          ])
        }
        catch (startError) {
          // start-local.ps1 can throw AFTER writing a structured failure receipt (T1b's
          // port_in_use case): the exit code alone would otherwise discard that detail, so the
          // receipt is inspected here, before the `finally` block below deletes it.
          let failure = null
          try {
            failure = parsePrismaStartupFailure(JSON.parse(await files.readFile(receiptPath, 'utf8')))
          }
          catch {
            failure = null
          }
          if (failure) {
            const detailedError = new Error(startError instanceof Error ? startError.message : String(startError))
            detailedError.failure = failure
            throw detailedError
          }
          throw startError
        }
        const receipt = JSON.parse(await files.readFile(receiptPath, 'utf8'))
        if (receipt.registered === false) return null
        if (receipt.registered === true && typeof receipt.generation === 'string' && receipt.generation.length > 0) {
          return { ownerToken, generation: receipt.generation }
        }
        throw new Error('Prisma Local acquisition returned an invalid ownership receipt.')
      }
      catch (error) {
        if (!hasPrismaStartupFailure(error)) {
          try {
            await runScript('release-dev-local.ps1', [
              '-DevelopmentOwnerToken', ownerToken,
              '-RecoverRegisteredOwner',
              '-LockTimeoutMilliseconds', '10000',
            ])
          }
          catch (recoveryError) {
            warn(`Prisma Local ownership recovery could not be proven: ${recoveryError instanceof Error ? recoveryError.message : String(recoveryError)}`)
          }
        }
        throw error
      }
      finally {
        acquisitions.delete(ownerToken)
        const cleanupResults = await Promise.allSettled([
          files.rm(receiptPath, { force: true }),
          files.rm(cancellationPath, { force: true }),
        ])
        for (const result of cleanupResults) {
          if (result.status === 'rejected') {
            warn(`Prisma Local temporary handoff cleanup failed: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`)
          }
        }
      }
    },
    async cancelAcquire(ownerToken) {
      const cancellationPath = acquisitions.get(ownerToken)
      if (cancellationPath) {
        await files.writeFile(cancellationPath, '', { flag: 'a' })
      }
    },
    async release(receipt) {
      await runScript('release-dev-local.ps1', [
        '-DevelopmentOwnerToken', receipt.ownerToken,
        '-ExpectedGeneration', receipt.generation,
        '-LockTimeoutMilliseconds', '10000',
      ])
    },
  }
}

// T18b: default Vite dev port when --port is not present in viteArgs -- matches Vite's own
// default and the project's fixed-port contract (AGENTS.md, odd/tasks/pw-006-prisma-responsiveness.md).
const DEFAULT_VITE_DEV_PORT = 5173

function parseVitePort(viteArguments) {
  for (let index = 0; index < viteArguments.length; index += 1) {
    const argument = viteArguments[index]
    let candidate = null
    if (argument === '--port') {
      candidate = viteArguments[index + 1]
    }
    else if (argument.startsWith('--port=')) {
      candidate = argument.slice('--port='.length)
    }
    if (candidate === null || candidate === undefined) continue
    const parsed = Number.parseInt(candidate, 10)
    if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65535) return parsed
  }
  return DEFAULT_VITE_DEV_PORT
}

// T18b: before Vite starts, verify the configured Vite dev port is actually free. Evidence
// 2026-09-24: a still-shutting-down previous Vite dev server was still LISTENING on 5173 when a
// freshly relaunched dev.mjs tried to start a new one, so Vite silently fell back to 5174 while
// the user's browser (fixed on 5173) got ERR_CONNECTION_REFUSED. Layering: OS-level process/port
// verification (is a listener on this port really THIS repository's own Vite CLI, by executable
// name + script path?) lives in resolve-vite-dev-port.ps1 / Resolve-PrismaViteDevPortState
// (services/prisma-runtime/operations/process-ownership.ps1), mirroring the existing
// Resolve-PrismaPortState pattern used for Prisma's own ports -- Node has no reliable
// cross-process command-line inspection on Windows without shelling out, and this repository
// already has that verification helper. This factory only orchestrates: run the classifier
// script, stop a verified leftover Vite (the script itself stops it and waits briefly -- see
// resolve-vite-dev-port.ps1), and turn the receipt into a terminal message / block decision.
// vite.config.ts's own `server.strictPort: true` is the defense-in-depth backstop in case this
// guard's classification is stale by the time Vite actually binds.
export function createVitePortGuard({
  spawn = spawnChild,
  files = fileSystem,
  operationsRoot = defaultOperationsRoot,
  temporaryRoot = tmpdir(),
  newId = randomUUID,
  viteCli = defaultViteCli,
  log = (message) => console.log(message),
  warn = (message) => console.warn(message),
  powershellExecutable = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
} = {}) {
  return {
    async ensureAvailable(port) {
      const receiptPath = join(temporaryRoot, `vite-port-${newId()}.json`)
      let receipt
      try {
        const child = spawn(
          powershellExecutable,
          [
            '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
            '-File', join(operationsRoot, 'resolve-vite-dev-port.ps1'),
            '-Port', String(port),
            '-ViteCliPath', viteCli,
            '-ReceiptPath', receiptPath,
          ],
          { shell: false, windowsHide: true, stdio: 'inherit' },
        )
        const result = await waitForChild(child)
        if (result.code !== 0) {
          throw new Error(`resolve-vite-dev-port.ps1 exited with code ${result.code ?? 'unknown'}.`)
        }
        receipt = JSON.parse(await files.readFile(receiptPath, 'utf8'))
      }
      catch (error) {
        // Fails open: a verification error means the guard could not run, not that a real
        // port conflict was found -- it must never block a start that would otherwise succeed.
        warn(`Vite dev server port ${port} could not be verified before starting: ${error instanceof Error ? error.message : String(error)}`)
        return { blocked: false }
      }
      finally {
        try {
          await files.rm(receiptPath, { force: true })
        }
        catch {
          // Best-effort cleanup only; a leftover temp receipt is not worth surfacing.
        }
      }

      if (receipt.state === 'free') return { blocked: false }

      if (receipt.state === 'ours') {
        if (receipt.stopped) {
          log(`Stopped previous Vite dev server (pid ${receipt.pid}) to start clean.`)
          if (!receipt.freed) {
            warn(`Port ${port} did not free up after stopping the previous Vite dev server; Vite will attempt to start anyway.`)
          }
        }
        else {
          warn(`Could not stop the previous Vite dev server (pid ${receipt.pid}) on port ${port}; Vite will attempt to start anyway.`)
        }
        return { blocked: false }
      }

      const occupant = receipt.processName ? `"${receipt.processName}"` : 'another program'
      return {
        blocked: true,
        message: `Vite dev server could not start: port ${port} is in use by ${occupant} (PID ${receipt.pid}). Close it and run the launcher again.`,
      }
    },
  }
}

// L2: default Vite dev host when --host is not present in viteArgs -- matches this project's
// fixed-host development convention (the desktop launcher and DEFAULT_VITE_DEV_PORT above both
// hardcode 127.0.0.1), used to build the URL the readiness waiter polls and the browser opens.
const DEFAULT_VITE_DEV_HOST = '127.0.0.1'

function parseViteHost(viteArguments) {
  for (let index = 0; index < viteArguments.length; index += 1) {
    const argument = viteArguments[index]
    let candidate = null
    if (argument === '--host') {
      candidate = viteArguments[index + 1]
    }
    else if (argument.startsWith('--host=')) {
      candidate = argument.slice('--host='.length)
    }
    if (!candidate || candidate.startsWith('-')) continue
    return candidate
  }
  return DEFAULT_VITE_DEV_HOST
}

function buildDevServerUrl(viteArguments) {
  return `http://${parseViteHost(viteArguments)}:${parseVitePort(viteArguments)}/`
}

// L2: replaces the desktop launcher's fixed `timeout /t 3` before opening the browser. Polls the
// Vite dev server's own URL (the same one the browser will open) instead of parsing Vite's stdout
// -- robust across Vite versions and independent of stdio being 'inherit'.
export function createServerReadinessWaiter({
  fetchImpl = fetch,
  intervalMilliseconds = 200,
  timeoutMilliseconds = 30000,
  sleep = (milliseconds) => new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds)),
  now = () => Date.now(),
} = {}) {
  return {
    async waitUntilReady(url) {
      const deadline = now() + timeoutMilliseconds
      let lastError = null
      for (;;) {
        try {
          const response = await fetchImpl(url)
          if (response && response.ok) return true
          lastError = new Error(`Received HTTP ${response?.status ?? 'unknown'} from ${url}.`)
        }
        catch (error) {
          lastError = error
        }
        if (now() >= deadline) {
          throw lastError ?? new Error(`Timed out waiting for ${url} to become ready.`)
        }
        await sleep(intervalMilliseconds)
      }
    },
  }
}

// User decision (2026-09-24): open a dedicated CONTROL Chrome instance -- its own profile
// (--user-data-dir), never the user's default Chrome profile -- with a localhost-only remote
// debugging port, so tooling can attach to the HMI tab without touching the user's personal
// browsing data. Chrome 136+ also silently ignores --remote-debugging-port on the DEFAULT
// user-data-dir, so a dedicated profile is required for the debugging port to work at all, not
// just a privacy nicety. If that Chrome (same --user-data-dir) is already running, Chrome's own
// single-instance behavior just opens the URL in it -- this opener does not need to detect that.
//
// Spawned directly (never through `cmd /c start`): Node's `spawn` with `shell: false` passes each
// argv element straight to `CreateProcess`, so a --user-data-dir value containing spaces (the
// default lives under "...\AppData\Local\...") needs no manual quoting here and can never fall
// back to the default profile the way an incorrectly quoted `cmd /c start` invocation could --
// `cmd`'s own command-line re-parsing of an already-quoted argument is exactly the class of bug
// this sidesteps entirely.
const DEFAULT_CONTROL_CHROME_DEBUG_PORT = '9222'
const CONTROL_CHROME_DEBUG_ADDRESS = '127.0.0.1'

function resolveControlChromeConfig(env) {
  const programFiles = env.ProgramFiles || String.raw`C:\Program Files`
  const localAppData = env.LOCALAPPDATA || String.raw`C:\Users\Default\AppData\Local`
  return {
    chromeExecutable: env.PRISMA_DEV_CHROME_PATH || join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    userDataDir: env.PRISMA_DEV_CHROME_USER_DATA_DIR || join(localAppData, 'CoreAnalytics', 'ChromeControl'),
    remoteDebuggingPort: env.PRISMA_DEV_CHROME_DEBUG_PORT || DEFAULT_CONTROL_CHROME_DEBUG_PORT,
  }
}

// Exported so the standalone "open only the control Chrome" tool
// (tools/dev-launcher/open-control-chrome.mjs) builds the exact same argument list instead of
// duplicating it.
export function buildControlChromeArgs({ userDataDir, remoteDebuggingPort, url }) {
  return [
    `--user-data-dir=${userDataDir}`,
    `--remote-debugging-port=${remoteDebuggingPort}`,
    `--remote-debugging-address=${CONTROL_CHROME_DEBUG_ADDRESS}`,
    '--no-first-run',
    '--no-default-browser-check',
    url,
  ]
}

export function createBrowserOpener({
  spawn = spawnChild,
  platform = process.platform,
  env = process.env,
  chromeExecutable,
  userDataDir,
  remoteDebuggingPort,
  log = (message) => console.log(message),
  warn = (message) => console.warn(message),
} = {}) {
  const defaults = resolveControlChromeConfig(env)
  const resolvedChromeExecutable = chromeExecutable || defaults.chromeExecutable
  const resolvedUserDataDir = userDataDir || defaults.userDataDir
  const resolvedRemoteDebuggingPort = remoteDebuggingPort || defaults.remoteDebuggingPort
  return {
    open(url) {
      if (platform !== 'win32') {
        warn(`Opening the browser automatically is only implemented for Windows; open ${url} manually.`)
        return
      }
      try {
        spawn(
          resolvedChromeExecutable,
          buildControlChromeArgs({ userDataDir: resolvedUserDataDir, remoteDebuggingPort: resolvedRemoteDebuggingPort, url }),
          { shell: false, stdio: 'ignore', windowsHide: true, detached: true },
        )
        log(`Opened the CONTROL Chrome (profile ${resolvedUserDataDir}) at ${url}.`)
      }
      catch (error) {
        warn(`Could not open the CONTROL Chrome automatically: ${error instanceof Error ? error.message : String(error)}. Open ${url} manually.`)
      }
    },
  }
}

export function createViteLauncher({
  spawn = spawnChild,
  nodeExecutable = process.execPath,
  viteCli = defaultViteCli,
} = {}) {
  return (viteArguments, extraEnvironment = {}) => {
    const hasExtraEnvironment = Object.keys(extraEnvironment).length > 0
    const child = spawn(nodeExecutable, [viteCli, ...viteArguments], {
      shell: false,
      stdio: 'inherit',
      windowsHide: false,
      // Only overridden (never dropping the rest of the real environment) when the caller
      // detected a startup failure worth forwarding to Vite; otherwise the child inherits
      // process.env exactly as before.
      ...(hasExtraEnvironment ? { env: { ...process.env, ...extraEnvironment } } : {}),
    })
    return {
      result: waitForChild(child),
      terminate(signal) {
        child.kill(signal)
      },
    }
  }
}

export async function runDevelopment({
  platform = process.platform,
  viteArgs = process.argv.slice(2),
  runtime = createPowerShellRuntime(),
  spawnVite = createViteLauncher(),
  portGuard = createVitePortGuard(),
  signals = process,
  warn = (message) => console.warn(message),
  newOwnerToken = randomUUID,
  env = process.env,
  readinessWaiter = createServerReadinessWaiter(),
  browserOpener = createBrowserOpener(),
} = {}) {
  const ownerToken = newOwnerToken()
  let receipt = null
  let vite = null
  let requestedSignal = null
  let terminationForwarded = false
  let released = false
  let startupFailure = null

  const releaseOnce = async () => {
    if (released || !receipt) return
    released = true
    try {
      await runtime.release(receipt)
    }
    catch (error) {
      warn(`Prisma Local cleanup could not be completed safely: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const handleSignal = (signal) => {
    if (!requestedSignal) requestedSignal = signal
    if (vite && !terminationForwarded) {
      terminationForwarded = true
      vite.terminate(signal)
    } else if (!vite) {
      Promise.resolve(runtime.cancelAcquire(ownerToken)).catch((error) => {
        warn(`Prisma Local cancellation could not be recorded: ${error instanceof Error ? error.message : String(error)}`)
      })
    }
  }
  const onInterrupt = () => handleSignal('SIGINT')
  const onTerminate = () => handleSignal('SIGTERM')
  signals.on('SIGINT', onInterrupt)
  signals.on('SIGTERM', onTerminate)

  try {
    if (platform === 'win32') {
      try {
        receipt = await runtime.acquire(ownerToken)
      }
      catch (error) {
        if (hasPrismaStartupFailure(error)) {
          // start-local.ps1 already printed its own single, clear terminal line for this
          // case (T4c/T4d); the generic warning here would be a redundant second line.
          startupFailure = error.failure
        }
        else {
          warn(`Prisma Local is unavailable; Vite will continue: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      if (requestedSignal) {
        await releaseOnce()
        return signalExitCode(requestedSignal)
      }
    } else {
      warn('Automatic Prisma Local orchestration is available only for Windows development; Vite will continue without it.')
    }

    if (platform === 'win32') {
      const port = parseVitePort(viteArgs)
      const portCheck = await portGuard.ensureAvailable(port)
      // Mirrors the requestedSignal check right after runtime.acquire() above: the port guard
      // is itself an async round-trip (a PowerShell classification, possibly stopping a
      // leftover process), so a signal can legitimately arrive while it is in flight. Without
      // this, a Ctrl+C during that window would be silently swallowed and Vite would still
      // start.
      if (requestedSignal) {
        await releaseOnce()
        return signalExitCode(requestedSignal)
      }
      if (portCheck.blocked) {
        warn(portCheck.message)
        return 1
      }
    }

    try {
      const extraEnvironment = startupFailure ? { PRISMA_STARTUP_FAILURE: JSON.stringify(startupFailure) } : {}
      vite = spawnVite(viteArgs, extraEnvironment)
    }
    catch (error) {
      warn(`Vite could not be started: ${error instanceof Error ? error.message : String(error)}`)
      return 1
    }

    // L2: opt-in only (PRISMA_DEV_AUTO_OPEN=1, set by the dev launcher) -- plain `npm run dev`
    // keeps today's behavior of never opening a browser. Runs concurrently with the `await
    // vite.result` below rather than blocking it: Vite is a long-running dev server, and this
    // must never delay forwarding its own exit code or signal handling. Raced against Vite
    // exiting first so a crash never opens a browser tab that would just show a connection error.
    if (env.PRISMA_DEV_AUTO_OPEN === '1') {
      const devServerUrl = buildDevServerUrl(viteArgs)
      const viteExitedBeforeReady = vite.result.then(() => {
        throw new Error(`Vite exited before the dev server at ${devServerUrl} became ready.`)
      })
      Promise.race([readinessWaiter.waitUntilReady(devServerUrl), viteExitedBeforeReady])
        .then(() => browserOpener.open(devServerUrl))
        .catch((error) => {
          warn(`Browser was not opened automatically: ${error instanceof Error ? error.message : String(error)}`)
        })
    }

    try {
      const result = await vite.result
      if (requestedSignal) return signalExitCode(requestedSignal)
      if (result.signal === 'SIGINT' || result.signal === 'SIGTERM') return signalExitCode(result.signal)
      return result.code ?? 1
    }
    catch (error) {
      warn(`Vite exited with an error: ${error instanceof Error ? error.message : String(error)}`)
      return 1
    }
  }
  finally {
    await releaseOnce()
    signals.off('SIGINT', onInterrupt)
    signals.off('SIGTERM', onTerminate)
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : ''
if (invokedPath === fileURLToPath(import.meta.url)) {
  process.exitCode = await runDevelopment()
}
