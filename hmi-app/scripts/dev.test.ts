// @vitest-environment node

import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { createPowerShellRuntime, createViteLauncher, createVitePortGuard, runDevelopment } from './dev.mjs'

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

// T18b: runDevelopment's Vite dev-port guard is exercised on its own below (createVitePortGuard
// tests) and in the two dedicated integration tests further down. Every other runDevelopment test
// here is unrelated to the guard and just needs it to be a harmless pass-through so Vite always
// gets spawned, exactly as before this task.
function createNoopPortGuard() {
  return { ensureAvailable: vi.fn(async () => ({ blocked: false as const })) }
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
      portGuard: createNoopPortGuard(),
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
      portGuard: createNoopPortGuard(),
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

  it('forwards a detected port_in_use startup failure to Vite as an environment variable', async () => {
    const warn = vi.fn()
    const failureError = new Error('Prisma could not start: port 5057 is in use by "name.exe" (PID 1234). Close it and run the launcher again.')
    ;(failureError as Error & { failure: unknown }).failure = { reason: 'port_in_use', port: 5057 }
    const runtime = {
      acquire: vi.fn(async () => {
        throw failureError
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
      portGuard: createNoopPortGuard(),
      viteArgs: ['--host'],
      runtime,
      spawnVite,
      signals: createSignals(),
      warn,
    })).resolves.toBe(0)

    expect(spawnVite).toHaveBeenCalledWith(['--host'], { PRISMA_STARTUP_FAILURE: JSON.stringify({ reason: 'port_in_use', port: 5057 }) })
    // T4d Fix B: start-local.ps1 already printed its own single clear line for this case;
    // the generic "Prisma Local is unavailable" warning would be a redundant second line.
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('Prisma Local is unavailable'))
  })

  it('never forwards a startup failure marker when acquisition fails without a detected failure', async () => {
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

    await runDevelopment({
      platform: 'win32',
      portGuard: createNoopPortGuard(),
      viteArgs: [],
      runtime,
      spawnVite,
      signals: createSignals(),
      warn,
    })

    expect(spawnVite).toHaveBeenCalledWith([], {})
    // Regression check for the T4d skip above: an ordinary (non-startup-failure) rejection
    // must still print the generic warning exactly as before.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Prisma Local is unavailable'))
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
    expect(spawnVite).toHaveBeenCalledWith(['--host'], {})
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
    const spawnVite = vi.fn(() => vite)
    const running = runDevelopment({
      platform: 'win32',
      portGuard: createNoopPortGuard(),
      viteArgs: [],
      runtime,
      spawnVite,
      signals,
      warn: vi.fn(),
    })

    // Waits for Vite to actually be running (not just for the signal listeners to be
    // registered, which happens synchronously before the async Prisma-acquire/port-guard work)
    // so this test exercises "signal forwarded to an already-running Vite", independently of
    // how many async steps precede spawnVite.
    await vi.waitFor(() => expect(spawnVite).toHaveBeenCalledTimes(1))
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
      portGuard: createNoopPortGuard(),
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
      portGuard: createNoopPortGuard(),
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

describe('Vite dev-port guard integration (T18b)', () => {
  // Evidence 2026-09-24: after relaunching, a still-shutting-down previous Vite dev server was
  // still listening on 5173 when the new one tried to bind, so Vite silently fell back to 5174
  // while the user's fixed-port browser tab got ERR_CONNECTION_REFUSED. runDevelopment must check
  // the Vite dev port before ever spawning Vite: a foreign holder blocks with a clear message and
  // Vite is never started; a verified leftover Vite of this repo is stopped by the guard itself
  // (asserted at the createVitePortGuard unit level below) and Vite still starts normally.
  function createRuntimeStub() {
    return {
      acquire: vi.fn(async () => ({ ownerToken: 'owner', generation: 'generation' })),
      cancelAcquire: vi.fn(),
      release: vi.fn(async () => undefined),
    }
  }

  it('never spawns Vite and exits 1 when the port guard reports a foreign holder on the Vite dev port', async () => {
    const warn = vi.fn()
    const portGuard = {
      ensureAvailable: vi.fn(async () => ({
        blocked: true as const,
        message: 'Vite dev server could not start: port 5173 is in use by "app.exe" (PID 42). Close it and run the launcher again.',
      })),
    }
    const spawnVite = vi.fn()

    const code = await runDevelopment({
      platform: 'win32',
      portGuard,
      viteArgs: ['--host', '127.0.0.1', '--port', '5173'],
      runtime: createRuntimeStub(),
      spawnVite,
      signals: createSignals(),
      warn,
    })

    expect(code).toBe(1)
    expect(portGuard.ensureAvailable).toHaveBeenCalledWith(5173)
    expect(spawnVite).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith('Vite dev server could not start: port 5173 is in use by "app.exe" (PID 42). Close it and run the launcher again.')
  })

  it('spawns Vite normally when the port guard reports the port is available', async () => {
    const portGuard = { ensureAvailable: vi.fn(async () => ({ blocked: false as const })) }
    const vite = { result: Promise.resolve<ExitResult>({ code: 0, signal: null }), terminate: vi.fn() }
    const spawnVite = vi.fn(() => vite)

    const code = await runDevelopment({
      platform: 'win32',
      portGuard,
      viteArgs: ['--host', '127.0.0.1', '--port', '5173'],
      runtime: createRuntimeStub(),
      spawnVite,
      signals: createSignals(),
      warn: vi.fn(),
    })

    expect(code).toBe(0)
    expect(portGuard.ensureAvailable).toHaveBeenCalledWith(5173)
    expect(spawnVite).toHaveBeenCalledTimes(1)
  })

  it('defaults the checked port to 5173 when --port is not present in viteArgs', async () => {
    const portGuard = { ensureAvailable: vi.fn(async () => ({ blocked: false as const })) }
    const vite = { result: Promise.resolve<ExitResult>({ code: 0, signal: null }), terminate: vi.fn() }

    await runDevelopment({
      platform: 'win32',
      portGuard,
      viteArgs: [],
      runtime: createRuntimeStub(),
      spawnVite: vi.fn(() => vite),
      signals: createSignals(),
      warn: vi.fn(),
    })

    expect(portGuard.ensureAvailable).toHaveBeenCalledWith(5173)
  })

  it('reads a non-default --port value out of viteArgs', async () => {
    const portGuard = { ensureAvailable: vi.fn(async () => ({ blocked: false as const })) }
    const vite = { result: Promise.resolve<ExitResult>({ code: 0, signal: null }), terminate: vi.fn() }

    await runDevelopment({
      platform: 'win32',
      portGuard,
      viteArgs: ['--host', '127.0.0.1', '--port', '4321'],
      runtime: createRuntimeStub(),
      spawnVite: vi.fn(() => vite),
      signals: createSignals(),
      warn: vi.fn(),
    })

    expect(portGuard.ensureAvailable).toHaveBeenCalledWith(4321)
  })

  it('never runs the port guard on non-Windows platforms', async () => {
    const portGuard = { ensureAvailable: vi.fn(async () => ({ blocked: false as const })) }
    const vite = { result: Promise.resolve<ExitResult>({ code: 0, signal: null }), terminate: vi.fn() }

    await runDevelopment({
      platform: 'linux',
      portGuard,
      viteArgs: ['--port', '5173'],
      runtime: createRuntimeStub(),
      spawnVite: vi.fn(() => vite),
      signals: createSignals(),
      warn: vi.fn(),
    })

    expect(portGuard.ensureAvailable).not.toHaveBeenCalled()
  })
})

describe('createVitePortGuard', () => {
  function createChild() {
    return Object.assign(new EventEmitter(), { kill: vi.fn() })
  }

  it('reports a free port as not blocked without touching files beyond the receipt cleanup', async () => {
    const spawn = vi.fn(() => {
      const child = createChild()
      queueMicrotask(() => child.emit('exit', 0, null))
      return child
    })
    const files = {
      readFile: vi.fn(async () => JSON.stringify({ state: 'free', pid: 0, processName: '', stopped: false, freed: true })),
      rm: vi.fn(async () => undefined),
    }
    const guard = createVitePortGuard({ spawn, files, newId: () => 'id' })

    await expect(guard.ensureAvailable(5173)).resolves.toEqual({ blocked: false })
    expect(files.rm).toHaveBeenCalledTimes(1)
  })

  it('invokes resolve-vite-dev-port.ps1 with the port, this repo\'s Vite CLI path and a receipt path', async () => {
    const spawn = vi.fn(() => {
      const child = createChild()
      queueMicrotask(() => child.emit('exit', 0, null))
      return child
    })
    const files = {
      readFile: vi.fn(async () => JSON.stringify({ state: 'free', pid: 0, processName: '', stopped: false, freed: true })),
      rm: vi.fn(async () => undefined),
    }
    const guard = createVitePortGuard({
      spawn,
      files,
      newId: () => 'id',
      operationsRoot: String.raw`C:\repo\services\prisma-runtime\operations`,
      viteCli: String.raw`C:\repo\hmi-app\node_modules\vite\bin\vite.js`,
      temporaryRoot: String.raw`C:\temp`,
    })

    await guard.ensureAvailable(5173)

    expect(spawn).toHaveBeenCalledWith(
      expect.stringMatching(/powershell\.exe$/i),
      expect.arrayContaining([
        '-File', String.raw`C:\repo\services\prisma-runtime\operations\resolve-vite-dev-port.ps1`,
        '-Port', '5173',
        '-ViteCliPath', String.raw`C:\repo\hmi-app\node_modules\vite\bin\vite.js`,
        '-ReceiptPath', String.raw`C:\temp\vite-port-id.json`,
      ]),
      expect.objectContaining({ shell: false, windowsHide: true }),
    )
  })

  it('prints the stop message and does not block when a leftover verified Vite was stopped and freed', async () => {
    const spawn = vi.fn(() => {
      const child = createChild()
      queueMicrotask(() => child.emit('exit', 0, null))
      return child
    })
    const files = {
      readFile: vi.fn(async () => JSON.stringify({ state: 'ours', pid: 777, processName: '', stopped: true, freed: true })),
      rm: vi.fn(async () => undefined),
    }
    const log = vi.fn()
    const warn = vi.fn()
    const guard = createVitePortGuard({ spawn, files, newId: () => 'id', log, warn })

    await expect(guard.ensureAvailable(5173)).resolves.toEqual({ blocked: false })
    expect(log).toHaveBeenCalledWith('Stopped previous Vite dev server (pid 777) to start clean.')
    expect(warn).not.toHaveBeenCalled()
  })

  it('warns but still does not block when the port did not free up after stopping a leftover Vite', async () => {
    const spawn = vi.fn(() => {
      const child = createChild()
      queueMicrotask(() => child.emit('exit', 0, null))
      return child
    })
    const files = {
      readFile: vi.fn(async () => JSON.stringify({ state: 'ours', pid: 777, processName: '', stopped: true, freed: false })),
      rm: vi.fn(async () => undefined),
    }
    const warn = vi.fn()
    const guard = createVitePortGuard({ spawn, files, newId: () => 'id', warn })

    await expect(guard.ensureAvailable(5173)).resolves.toEqual({ blocked: false })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('did not free up'))
  })

  it('reports a foreign holder as blocked with a clear message naming the port, process and pid', async () => {
    const spawn = vi.fn(() => {
      const child = createChild()
      queueMicrotask(() => child.emit('exit', 0, null))
      return child
    })
    const files = {
      readFile: vi.fn(async () => JSON.stringify({ state: 'foreign', pid: 42, processName: 'app.exe', stopped: false, freed: true })),
      rm: vi.fn(async () => undefined),
    }
    const guard = createVitePortGuard({ spawn, files, newId: () => 'id' })

    await expect(guard.ensureAvailable(5173)).resolves.toEqual({
      blocked: true,
      message: 'Vite dev server could not start: port 5173 is in use by "app.exe" (PID 42). Close it and run the launcher again.',
    })
  })

  it('reports a foreign holder with an unresolved name as "another program"', async () => {
    const spawn = vi.fn(() => {
      const child = createChild()
      queueMicrotask(() => child.emit('exit', 0, null))
      return child
    })
    const files = {
      readFile: vi.fn(async () => JSON.stringify({ state: 'foreign', pid: 42, processName: '', stopped: false, freed: true })),
      rm: vi.fn(async () => undefined),
    }
    const guard = createVitePortGuard({ spawn, files, newId: () => 'id' })

    await expect(guard.ensureAvailable(5173)).resolves.toEqual({
      blocked: true,
      message: 'Vite dev server could not start: port 5173 is in use by another program (PID 42). Close it and run the launcher again.',
    })
  })

  it('fails open (never blocks) when the resolver script exits non-zero', async () => {
    const spawn = vi.fn(() => {
      const child = createChild()
      queueMicrotask(() => child.emit('exit', 1, null))
      return child
    })
    const files = { readFile: vi.fn(), rm: vi.fn(async () => undefined) }
    const warn = vi.fn()
    const guard = createVitePortGuard({ spawn, files, newId: () => 'id', warn })

    await expect(guard.ensureAvailable(5173)).resolves.toEqual({ blocked: false })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('could not be verified'))
  })

  it('fails open (never blocks) when the receipt cannot be read or parsed', async () => {
    const spawn = vi.fn(() => {
      const child = createChild()
      queueMicrotask(() => child.emit('exit', 0, null))
      return child
    })
    const files = { readFile: vi.fn(async () => { throw new Error('receipt missing') }), rm: vi.fn(async () => undefined) }
    const warn = vi.fn()
    const guard = createVitePortGuard({ spawn, files, newId: () => 'id', warn })

    await expect(guard.ensureAvailable(5173)).resolves.toEqual({ blocked: false })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('receipt missing'))
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

  it('registers the Node owner process id with the acquisition start arguments', async () => {
    // PW-005: acquisition must pass the calling Node process identity to the
    // start helper so per-owner liveness can later be proven (planned
    // -DevelopmentOwnerProcessId contract, section 4.3 of the task doc).
    const child = new EventEmitter()
    const spawn = vi.fn(() => Object.assign(child, { kill: vi.fn() }))
    const files = {
      readFile: vi.fn(async () => JSON.stringify({ registered: true, generation: 'generation' })),
      writeFile: vi.fn(async () => undefined),
      rm: vi.fn(async () => undefined),
    }
    const runtime = createPowerShellRuntime({ spawn, files, newId: () => 'id' })
    const acquiring = runtime.acquire('owner')
    child.emit('exit', 0, null)

    await expect(acquiring).resolves.toEqual({ ownerToken: 'owner', generation: 'generation' })
    expect(spawn.mock.calls[0]?.[1]).toEqual(expect.arrayContaining([
      '-DevelopmentOwnerProcessId', String(process.pid),
    ]))
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

  it('attaches the parsed port_in_use receipt failure to the rejection when start-local.ps1 exits non-zero', async () => {
    const spawn = vi.fn(() => {
      const child = Object.assign(new EventEmitter(), { kill: vi.fn() })
      queueMicrotask(() => child.emit('exit', spawn.mock.calls.length === 1 ? 9 : 0, null))
      return child
    })
    const files = {
      readFile: vi.fn(async () => JSON.stringify({
        registered: false,
        failure: { reason: 'port_in_use', port: 5057, processName: 'name.exe', pid: 1234 },
      })),
      writeFile: vi.fn(async () => undefined),
      rm: vi.fn(async () => undefined),
    }
    const runtime = createPowerShellRuntime({ spawn, files, newId: () => 'id' })

    const caught = await runtime.acquire('owner').catch((error: unknown) => error)

    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error & { failure?: unknown }).failure).toEqual({ reason: 'port_in_use', port: 5057 })
    // T4d Fix B: a port_in_use failure is thrown before any development owner is ever
    // registered, so there is nothing to recover -- release-dev-local.ps1 must never run.
    expect(spawn).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['a missing receipt file', new Error('receipt missing')],
    ['an unknown failure reason', JSON.stringify({ registered: false, failure: { reason: 'exploded', port: 5057 } })],
    ['an out-of-range port', JSON.stringify({ registered: false, failure: { reason: 'port_in_use', port: 70000 } })],
    ['a registered:true receipt', JSON.stringify({ registered: true, failure: { reason: 'port_in_use', port: 5057 } })],
  ])('never attaches a failure when the receipt has %s', async (_label, readResult) => {
    const spawn = vi.fn(() => {
      const child = Object.assign(new EventEmitter(), { kill: vi.fn() })
      queueMicrotask(() => child.emit('exit', spawn.mock.calls.length === 1 ? 9 : 0, null))
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

    const caught = await runtime.acquire('owner').catch((error: unknown) => error)

    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error & { failure?: unknown }).failure).toBeUndefined()
    // Regression check for the T4d skip above: with no detected startup failure, recovery
    // must still be attempted exactly as before.
    expect(spawn).toHaveBeenCalledTimes(2)
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

  it('launches Vite without overriding the environment when no extra environment is given', () => {
    const child = new EventEmitter()
    const spawn = vi.fn(() => Object.assign(child, { kill: vi.fn() }))
    createViteLauncher({ spawn })([])

    expect(spawn.mock.calls[0]?.[2]).not.toHaveProperty('env')
  })

  it('merges a detected startup failure into the Vite child environment without dropping the rest of process.env', () => {
    const child = new EventEmitter()
    const spawn = vi.fn(() => Object.assign(child, { kill: vi.fn() }))
    createViteLauncher({ spawn })([], { PRISMA_STARTUP_FAILURE: '{"reason":"port_in_use","port":5057}' })

    const options = spawn.mock.calls[0]?.[2] as { env?: Record<string, string | undefined> }
    expect(options.env?.PRISMA_STARTUP_FAILURE).toBe('{"reason":"port_in_use","port":5057}')
    expect(options.env?.PATH ?? options.env?.Path).toBe(process.env.PATH ?? process.env.Path)
  })
})
