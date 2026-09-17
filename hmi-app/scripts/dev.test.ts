// @vitest-environment node

import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { createPowerShellRuntime, createViteLauncher, runDevelopment } from './dev.mjs'

type ExitResult = { code: number | null; signal: NodeJS.Signals | null }

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

function createSignals() {
  const emitter = new EventEmitter()
  return {
    emit(signal: NodeJS.Signals) {
      emitter.emit(signal)
    },
    on(signal: NodeJS.Signals, listener: () => void) {
      emitter.on(signal, listener)
    },
    off(signal: NodeJS.Signals, listener: () => void) {
      emitter.off(signal, listener)
    },
    listenerCount(signal: NodeJS.Signals) {
      return emitter.listenerCount(signal)
    },
  }
}

describe('development orchestration', () => {
  it('acquires Prisma before forwarding Vite arguments exactly and releases once on exit', async () => {
    const events: string[] = []
    const runtime = {
      acquire: vi.fn(async () => {
        events.push('acquire')
        return { ownerToken: 'owner', generation: 'generation' }
      }),
      cancelAcquire: vi.fn(),
      release: vi.fn(async () => {
        events.push('release')
      }),
    }
    const vite = {
      result: Promise.resolve<ExitResult>({ code: 7, signal: null }),
      terminate: vi.fn(),
    }
    const spawnVite = vi.fn((args: string[]) => {
      events.push(`vite:${args.join('|')}`)
      return vite
    })

    const code = await runDevelopment({
      platform: 'win32',
      viteArgs: ['--host', '127.0.0.1', '--port', '4173'],
      runtime,
      spawnVite,
      signals: createSignals(),
      warn: vi.fn(),
    })

    expect(code).toBe(7)
    expect(events).toEqual(['acquire', 'vite:--host|127.0.0.1|--port|4173', 'release'])
    expect(runtime.release).toHaveBeenCalledTimes(1)
  })

  it('warns and still launches Vite when Prisma acquisition fails', async () => {
    const warn = vi.fn()
    const runtime = {
      acquire: vi.fn(async () => {
        throw new Error('owned interpreter missing')
      }),
      cancelAcquire: vi.fn(),
      release: vi.fn(),
    }
    const spawnVite = vi.fn(() => ({
      result: Promise.resolve<ExitResult>({ code: 0, signal: null }),
      terminate: vi.fn(),
    }))

    await expect(runDevelopment({
      platform: 'win32',
      viteArgs: [],
      runtime,
      spawnVite,
      signals: createSignals(),
      warn,
    })).resolves.toBe(0)

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('owned interpreter missing'))
    expect(spawnVite).toHaveBeenCalledTimes(1)
    expect(runtime.release).not.toHaveBeenCalled()
  })

  it('skips Prisma honestly on unsupported operating systems', async () => {
    const warn = vi.fn()
    const runtime = {
      acquire: vi.fn(),
      cancelAcquire: vi.fn(),
      release: vi.fn(),
    }
    const spawnVite = vi.fn(() => ({
      result: Promise.resolve<ExitResult>({ code: 0, signal: null }),
      terminate: vi.fn(),
    }))

    await runDevelopment({
      platform: 'linux',
      viteArgs: ['--host'],
      runtime,
      spawnVite,
      signals: createSignals(),
      warn,
    })

    expect(runtime.acquire).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Windows'))
    expect(spawnVite).toHaveBeenCalledWith(['--host'])
  })

  it.each(['SIGINT', 'SIGTERM'] as const)('forwards %s and releases once across signal and exit races', async (signal) => {
    const signals = createSignals()
    const exit = deferred<ExitResult>()
    const runtime = {
      acquire: vi.fn(async () => ({ ownerToken: 'owner', generation: 'generation' })),
      cancelAcquire: vi.fn(),
      release: vi.fn(async () => undefined),
    }
    const vite = { result: exit.promise, terminate: vi.fn() }
    const running = runDevelopment({
      platform: 'win32',
      viteArgs: [],
      runtime,
      spawnVite: vi.fn(() => vite),
      signals,
      warn: vi.fn(),
    })

    await vi.waitFor(() => expect(signals.listenerCount(signal)).toBe(1))
    signals.emit(signal)
    signals.emit(signal)
    exit.resolve({ code: null, signal })

    await expect(running).resolves.toBe(signal === 'SIGINT' ? 130 : 143)
    expect(vite.terminate).toHaveBeenCalledTimes(1)
    expect(vite.terminate).toHaveBeenCalledWith(signal)
    expect(runtime.release).toHaveBeenCalledTimes(1)
  })

  it('settles and releases a cancelled pre-Vite acquisition without spawning Vite', async () => {
    const signals = createSignals()
    const acquired = deferred<{ ownerToken: string; generation: string }>()
    const runtime = {
      acquire: vi.fn(() => acquired.promise),
      cancelAcquire: vi.fn(),
      release: vi.fn(async () => undefined),
    }
    const spawnVite = vi.fn()
    const running = runDevelopment({
      platform: 'win32',
      viteArgs: [],
      runtime,
      spawnVite,
      signals,
      warn: vi.fn(),
    })

    await vi.waitFor(() => expect(runtime.acquire).toHaveBeenCalledTimes(1))
    signals.emit('SIGINT')
    acquired.resolve({ ownerToken: 'owner', generation: 'generation' })

    await expect(running).resolves.toBe(130)
    expect(runtime.cancelAcquire).toHaveBeenCalledTimes(1)
    expect(runtime.release).toHaveBeenCalledWith({ ownerToken: 'owner', generation: 'generation' })
    expect(spawnVite).not.toHaveBeenCalled()
  })

  it('releases after a Vite spawn error and removes signal listeners', async () => {
    const signals = createSignals()
    const runtime = {
      acquire: vi.fn(async () => ({ ownerToken: 'owner', generation: 'generation' })),
      cancelAcquire: vi.fn(),
      release: vi.fn(async () => undefined),
    }

    await expect(runDevelopment({
      platform: 'win32',
      viteArgs: [],
      runtime,
      spawnVite: vi.fn(() => { throw new Error('spawn failed') }),
      signals,
      warn: vi.fn(),
    })).resolves.toBe(1)

    expect(runtime.release).toHaveBeenCalledTimes(1)
    expect(signals.listenerCount('SIGINT')).toBe(0)
    expect(signals.listenerCount('SIGTERM')).toBe(0)
  })
})

describe('native child adapters', () => {
  it('uses token-array PowerShell arguments without a shell and with hidden helper windows', async () => {
    const child = new EventEmitter()
    const spawn = vi.fn(() => Object.assign(child, { kill: vi.fn() }))
    const files = {
      readFile: vi.fn(async () => JSON.stringify({ registered: true, generation: 'generation' })),
      writeFile: vi.fn(async () => undefined),
      rm: vi.fn(async () => undefined),
    }
    const runtime = createPowerShellRuntime({
      spawn,
      files,
      operationsRoot: String.raw`C:\repo with spaces\operations`,
      temporaryRoot: String.raw`C:\temp with spaces`,
      newId: () => 'id',
    })
    const acquiring = runtime.acquire('owner')
    child.emit('exit', 0, null)

    await expect(acquiring).resolves.toEqual({ ownerToken: 'owner', generation: 'generation' })
    expect(spawn).toHaveBeenCalledWith(
      expect.stringMatching(/powershell\.exe$/i),
      expect.arrayContaining(['-File', String.raw`C:\repo with spaces\operations\start-local.ps1`, '-DevelopmentOwnerToken', 'owner']),
      expect.objectContaining({ shell: false, windowsHide: true }),
    )
  })

  it.each([
    ['missing receipt', new Error('receipt missing')],
    ['invalid receipt JSON', '{broken'],
  ])('requests token-scoped recovery when acquisition leaves %s', async (_label, readResult) => {
    const children: EventEmitter[] = []
    const spawn = vi.fn(() => {
      const child = Object.assign(new EventEmitter(), { kill: vi.fn() })
      children.push(child)
      queueMicrotask(() => child.emit('exit', 0, null))
      return child
    })
    const files = {
      readFile: vi.fn(async () => {
        if (readResult instanceof Error) throw readResult
        return readResult
      }),
      writeFile: vi.fn(async () => undefined),
      rm: vi.fn(async () => undefined),
    }
    const runtime = createPowerShellRuntime({ spawn, files, newId: () => 'id' })

    await expect(runtime.acquire('owner')).rejects.toThrow()

    expect(spawn).toHaveBeenCalledTimes(2)
    expect(spawn.mock.calls[1]?.[1]).toEqual(expect.arrayContaining([
      expect.stringMatching(/release-dev-local\.ps1$/),
      '-DevelopmentOwnerToken', 'owner',
      '-RecoverRegisteredOwner',
    ]))
  })

  it('requests token-scoped recovery when the helper fails after registration', async () => {
    const spawn = vi.fn(() => {
      const child = Object.assign(new EventEmitter(), { kill: vi.fn() })
      queueMicrotask(() => child.emit('exit', spawn.mock.calls.length === 1 ? 9 : 0, null))
      return child
    })
    const files = {
      readFile: vi.fn(),
      writeFile: vi.fn(async () => undefined),
      rm: vi.fn(async () => undefined),
    }
    const runtime = createPowerShellRuntime({ spawn, files, newId: () => 'id' })

    await expect(runtime.acquire('owner')).rejects.toThrow('start-local.ps1 exited with code 9')
    expect(spawn).toHaveBeenCalledTimes(2)
    expect(spawn.mock.calls[1]?.[1]).toEqual(expect.arrayContaining(['-RecoverRegisteredOwner']))
  })

  it('does not mask established ownership when temporary-file cleanup fails', async () => {
    const warn = vi.fn()
    const child = new EventEmitter()
    const spawn = vi.fn(() => Object.assign(child, { kill: vi.fn() }))
    const files = {
      readFile: vi.fn(async () => JSON.stringify({ registered: true, generation: 'generation' })),
      writeFile: vi.fn(async () => undefined),
      rm: vi.fn(async () => { throw new Error('cleanup denied') }),
    }
    const runtime = createPowerShellRuntime({ spawn, files, newId: () => 'id', warn })
    const acquiring = runtime.acquire('owner')
    child.emit('exit', 0, null)

    await expect(acquiring).resolves.toEqual({ ownerToken: 'owner', generation: 'generation' })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('cleanup denied'))
    expect(spawn).toHaveBeenCalledTimes(1)
  })

  it('launches the installed Vite CLI with the current Node binary and exact arguments', () => {
    const child = new EventEmitter()
    const spawn = vi.fn(() => Object.assign(child, { kill: vi.fn() }))
    createViteLauncher({
      spawn,
      nodeExecutable: String.raw`C:\Program Files\nodejs\node.exe`,
      viteCli: String.raw`C:\repo with spaces\node_modules\vite\bin\vite.js`,
    })(['--host', '0.0.0.0'])

    expect(spawn).toHaveBeenCalledWith(
      String.raw`C:\Program Files\nodejs\node.exe`,
      [String.raw`C:\repo with spaces\node_modules\vite\bin\vite.js`, '--host', '0.0.0.0'],
      expect.objectContaining({ shell: false, stdio: 'inherit' }),
    )
  })
})
