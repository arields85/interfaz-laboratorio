import {
    PRISMA_ASK_URL,
    PRISMA_EVENTS_URL,
    PRISMA_SESSION_URL,
    PRISMA_SNAPSHOT_URL,
    PRISMA_TTS_LIVE_URL,
} from '../config/prismaAssistant.config';
import type { PrismaSessionMetadata, PrismaSessionRequestSnapshot } from '../domain/prismaSession.types';

const CAPABILITY_HEADER = 'X-Prisma-Session-Capability';
const AUTHORIZED_PATHS = new Set([
    PRISMA_SESSION_URL,
    PRISMA_SNAPSHOT_URL,
    PRISMA_EVENTS_URL,
    PRISMA_ASK_URL,
    PRISMA_TTS_LIVE_URL,
]);
const SESSION_METADATA_KEYS = ['absoluteExpiresAt', 'idleExpiresAt', 'ok'] as const;

export class PrismaStaleSessionResponse extends Error {}

export class PrismaSessionClient {
    readonly #fetchImpl: typeof fetch;
    #capability: string | null = null;
    #metadata: PrismaSessionMetadata | null = null;
    #epoch = 0;
    #bootstrap: Promise<PrismaSessionMetadata> | null = null;
    #requestController = new AbortController();
    #voiceEventKeys = new Set<string>();
    #responseEpochs = new WeakMap<Response, number>();
    #resetListeners = new Set<() => void>();

    constructor(fetchImpl: typeof fetch = (...args) => fetch(...args)) {
        this.#fetchImpl = fetchImpl;
    }

    get snapshot(): PrismaSessionRequestSnapshot {
        return { epoch: this.#epoch };
    }

    async bootstrap(): Promise<PrismaSessionMetadata> {
        if (this.#capability !== null && this.#metadata !== null) {
            return this.#metadata;
        }
        if (this.#bootstrap !== null) return this.#bootstrap;

        const bootstrapEpoch = this.#epoch;
        const operation = this.#fetchImpl(PRISMA_SESSION_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
            cache: 'no-store',
            redirect: 'error',
        }).then(async (response) => {
            let metadata: unknown;
            try {
                metadata = await response.json();
            } catch {
                throw new Error('Prisma session bootstrap failed');
            }
            if (bootstrapEpoch !== this.#epoch) throw new PrismaStaleSessionResponse();
            const capability = response.headers.get(CAPABILITY_HEADER);
            if (response.status !== 201
                || !isCanonicalCapability(capability)
                || !isPrismaSessionMetadata(metadata)) {
                throw new Error('Prisma session bootstrap failed');
            }
            this.#capability = capability;
            this.#metadata = metadata;
            return metadata;
        }).finally(() => {
            if (this.#bootstrap === operation) this.#bootstrap = null;
        });
        this.#bootstrap = operation;
        return operation;
    }

    async fetch(path: string, init: RequestInit = {}): Promise<Response> {
        this.#assertAuthorizedPath(path);
        const requestEpoch = this.#epoch;
        throwIfAborted(init.signal);
        await this.#waitForBootstrap(init.signal);
        throwIfAborted(init.signal);
        if (requestEpoch !== this.#epoch) throw new PrismaStaleSessionResponse();
        const capability = this.#capability;
        if (capability === null) throw new PrismaStaleSessionResponse();

        const controller = new AbortController();
        const sessionSignal = this.#requestController.signal;
        const abort = () => controller.abort(
            init.signal?.aborted ? init.signal.reason : sessionSignal.reason,
        );
        sessionSignal.addEventListener('abort', abort, { once: true });
        init.signal?.addEventListener('abort', abort, { once: true });
        let streamOwnsCleanup = false;
        const cleanup = () => {
            sessionSignal.removeEventListener('abort', abort);
            init.signal?.removeEventListener('abort', abort);
        };
        try {
            const headers = new Headers(init.headers);
            headers.set(CAPABILITY_HEADER, capability);
            const response = await this.#fetchImpl(path, {
                ...init,
                headers,
                signal: controller.signal,
                redirect: 'error',
            });
            if (requestEpoch !== this.#epoch) throw new PrismaStaleSessionResponse();
            if (response.status === 401 && this.#capability === capability) {
                this.#invalidate();
                void this.bootstrap().catch(() => undefined);
            }
            const returnedResponse = path === PRISMA_TTS_LIVE_URL && response.body !== null
                ? this.#wrapStreamingResponse(response, controller, cleanup)
                : response;
            streamOwnsCleanup = returnedResponse !== response;
            this.#responseEpochs.set(returnedResponse, requestEpoch);
            return returnedResponse;
        } finally {
            if (!streamOwnsCleanup) cleanup();
        }
    }

    acceptVoiceEvent(key: string): boolean {
        if (this.#voiceEventKeys.has(key)) return false;
        this.#voiceEventKeys.add(key);
        return true;
    }

    isCurrentResponse(response: Response): boolean {
        return this.#responseEpochs.get(response) === this.#epoch;
    }

    subscribeToReset(listener: () => void): () => void {
        this.#resetListeners.add(listener);
        return () => this.#resetListeners.delete(listener);
    }

    reset({ close = true, keepalive = false }: { close?: boolean; keepalive?: boolean } = {}): void {
        const capability = this.#capability;
        this.#invalidate();
        if (close && capability !== null) {
            void this.#fetchImpl(PRISMA_SESSION_URL, {
                method: 'DELETE',
                headers: { [CAPABILITY_HEADER]: capability },
                cache: 'no-store',
                redirect: 'error',
                keepalive,
            }).catch(() => undefined);
        }
    }

    #assertAuthorizedPath(path: string): void {
        if (!path.startsWith('/') || path.startsWith('//') || !AUTHORIZED_PATHS.has(path)) {
            throw new Error('Prisma session capability cannot be sent to this URL');
        }
    }

    async #waitForBootstrap(signal?: AbortSignal | null): Promise<PrismaSessionMetadata> {
        const bootstrap = this.bootstrap();
        if (signal === undefined || signal === null) return bootstrap;
        throwIfAborted(signal);
        return new Promise<PrismaSessionMetadata>((resolve, reject) => {
            const onAbort = () => reject(abortError(signal.reason));
            signal.addEventListener('abort', onAbort, { once: true });
            void bootstrap.then(
                (metadata) => {
                    signal.removeEventListener('abort', onAbort);
                    resolve(metadata);
                },
                (error: unknown) => {
                    signal.removeEventListener('abort', onAbort);
                    reject(error);
                },
            );
        });
    }

    #wrapStreamingResponse(
        response: Response,
        controller: AbortController,
        cleanupTransport: () => void,
    ): Response {
        const sourceReader = response.body!.getReader();
        let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
        let terminal = false;

        const cleanup = () => {
            controller.signal.removeEventListener('abort', onAbort);
            cleanupTransport();
        };
        const finish = () => {
            if (terminal) return false;
            terminal = true;
            cleanup();
            return true;
        };
        const onAbort = () => {
            if (!finish()) return;
            const reason = abortError(controller.signal.reason);
            void sourceReader.cancel(reason).catch(() => undefined);
            streamController?.error(reason);
        };

        const body = new ReadableStream<Uint8Array>({
            start(nextController) {
                streamController = nextController;
                controller.signal.addEventListener('abort', onAbort, { once: true });
                if (controller.signal.aborted) onAbort();
            },
            async pull(nextController) {
                if (terminal) return;
                try {
                    const chunk = await sourceReader.read();
                    if (chunk.done) {
                        if (finish()) nextController.close();
                        return;
                    }
                    nextController.enqueue(chunk.value);
                } catch (error) {
                    if (finish()) nextController.error(error);
                }
            },
            async cancel(reason) {
                if (!finish()) return;
                if (!controller.signal.aborted) controller.abort(reason);
                try {
                    await sourceReader.cancel(reason);
                } catch {
                    // Cancellation is best effort after the consumer has detached.
                }
            },
        });
        return new Response(body, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
        });
    }

    #invalidate(): void {
        this.#capability = null;
        this.#metadata = null;
        this.#bootstrap = null;
        this.#epoch += 1;
        this.#voiceEventKeys.clear();
        this.#requestController.abort();
        this.#requestController = new AbortController();
        for (const listener of this.#resetListeners) {
            try {
                listener();
            } catch {
                // Session reset must continue even if a presentation listener fails.
            }
        }
    }
}

export const prismaSessionClient = new PrismaSessionClient();

function abortError(reason?: unknown): DOMException {
    return reason instanceof DOMException && reason.name === 'AbortError'
        ? reason
        : new DOMException('The operation was aborted.', 'AbortError');
}

function throwIfAborted(signal?: AbortSignal | null): void {
    if (signal?.aborted) throw abortError(signal.reason);
}

function isCanonicalCapability(value: string | null): value is string {
    if (value === null || !/^[A-Za-z0-9_-]{43}$/.test(value)) return false;
    try {
        const standard = value.replaceAll('-', '+').replaceAll('_', '/') + '=';
        const decoded = atob(standard);
        if (decoded.length !== 32) return false;
        const canonical = btoa(decoded).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
        return canonical === value;
    } catch {
        return false;
    }
}

function isPrismaSessionMetadata(value: unknown): value is PrismaSessionMetadata {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    if (keys.length !== SESSION_METADATA_KEYS.length
        || keys.some((key, index) => key !== SESSION_METADATA_KEYS[index])) return false;
    const idle = record.idleExpiresAt;
    const absolute = record.absoluteExpiresAt;
    return record.ok === true
        && typeof idle === 'number'
        && Number.isFinite(idle)
        && idle > 0
        && typeof absolute === 'number'
        && Number.isFinite(absolute)
        && absolute > 0
        && idle <= absolute;
}
