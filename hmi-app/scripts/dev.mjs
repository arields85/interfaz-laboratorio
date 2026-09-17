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
        await runScript('start-local.ps1', [
          '-DevelopmentOwnerToken', ownerToken,
          '-DevelopmentReceiptPath', receiptPath,
          '-DevelopmentCancellationPath', cancellationPath,
          '-LockTimeoutMilliseconds', '10000',
        ])
        const receipt = JSON.parse(await files.readFile(receiptPath, 'utf8'))
        if (receipt.registered === false) return null
        if (receipt.registered === true && typeof receipt.generation === 'string' && receipt.generation.length > 0) {
          return { ownerToken, generation: receipt.generation }
        }
        throw new Error('Prisma Local acquisition returned an invalid ownership receipt.')
      }
      catch (error) {
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

export function createViteLauncher({
  spawn = spawnChild,
  nodeExecutable = process.execPath,
  viteCli = defaultViteCli,
} = {}) {
  return (viteArguments) => {
    const child = spawn(nodeExecutable, [viteCli, ...viteArguments], {
      shell: false,
      stdio: 'inherit',
      windowsHide: false,
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
  signals = process,
  warn = (message) => console.warn(message),
  newOwnerToken = randomUUID,
} = {}) {
  const ownerToken = newOwnerToken()
  let receipt = null
  let vite = null
  let requestedSignal = null
  let terminationForwarded = false
  let released = false

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
        warn(`Prisma Local is unavailable; Vite will continue: ${error instanceof Error ? error.message : String(error)}`)
      }
      if (requestedSignal) {
        await releaseOnce()
        return signalExitCode(requestedSignal)
      }
    } else {
      warn('Automatic Prisma Local orchestration is available only for Windows development; Vite will continue without it.')
    }

    try {
      vite = spawnVite(viteArgs)
    }
    catch (error) {
      warn(`Vite could not be started: ${error instanceof Error ? error.message : String(error)}`)
      return 1
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
