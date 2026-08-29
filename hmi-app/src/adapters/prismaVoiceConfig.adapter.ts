import {
    arePrismaVoiceConfigsEqual,
    validatePrismaVoiceConfig,
    type PrismaVoiceConfig,
    type PrismaVoiceConfigValidationIssue,
} from '../domain/prismaVoiceConfig';
import type {
    PrismaVoiceConfigReader,
    PrismaVoiceConfigWriter,
} from '../services/prismaVoiceConfigPort';

export type PrismaVoiceConfigResponseContract = 'legacy-flat' | 'local-envelope';

interface ExtractedResponseConfig {
    valid: true;
    value: unknown;
}

interface InvalidResponseEnvelope {
    valid: false;
    message: string;
}

function extractResponseConfig(
    payload: unknown,
    responseContract: PrismaVoiceConfigResponseContract,
): ExtractedResponseConfig | InvalidResponseEnvelope {
    if (responseContract === 'legacy-flat') {
        return { valid: true, value: payload };
    }

    if (
        typeof payload !== 'object'
        || payload === null
        || Array.isArray(payload)
        || !Object.prototype.hasOwnProperty.call(payload, 'config')
    ) {
        return {
            valid: false,
            message: 'Local Prisma voice config response must be an object envelope with an own config property',
        };
    }

    return {
        valid: true,
        value: (payload as Record<string, unknown>).config,
    };
}

type PrismaVoiceConfigReadErrorKind = 'http' | 'json' | 'validation';

export class PrismaVoiceConfigReadError extends Error {
    public readonly kind: PrismaVoiceConfigReadErrorKind;
    public readonly statusCode: number | undefined;
    public readonly issues: PrismaVoiceConfigValidationIssue[] | undefined;

    public constructor(
        message: string,
        kind: PrismaVoiceConfigReadErrorKind,
        statusCode?: number,
        issues?: PrismaVoiceConfigValidationIssue[],
        options?: ErrorOptions,
    ) {
        super(message, options);
        this.name = 'PrismaVoiceConfigReadError';
        this.kind = kind;
        this.statusCode = statusCode;
        this.issues = issues;
    }
}

export class HttpPrismaVoiceConfigReader implements PrismaVoiceConfigReader {
    private readonly url: string;
    private readonly responseContract: PrismaVoiceConfigResponseContract;
    private readonly fetchImpl: typeof fetch;

    public constructor(
        url: string,
        responseContract: PrismaVoiceConfigResponseContract = 'legacy-flat',
        fetchImpl: typeof fetch = (...args) => fetch(...args),
    ) {
        this.url = url;
        this.responseContract = responseContract;
        this.fetchImpl = fetchImpl;
    }

    public async readConfig(signal: AbortSignal) {
        const response = await this.fetchImpl(this.url, {
            method: 'GET',
            headers: { Accept: 'application/json' },
            cache: 'no-store',
            signal,
        });

        if (!response.ok) {
            throw new PrismaVoiceConfigReadError(
                `Prisma voice config request failed with status ${response.status}`,
                'http',
                response.status,
            );
        }

        let payload: unknown;
        try {
            payload = await response.json();
        } catch (error) {
            throw new PrismaVoiceConfigReadError(
                'Prisma voice config response is not valid JSON',
                'json',
                undefined,
                undefined,
                { cause: error },
            );
        }

        const extractedConfig = extractResponseConfig(payload, this.responseContract);
        if (!extractedConfig.valid) {
            throw new PrismaVoiceConfigReadError(
                extractedConfig.message,
                'validation',
            );
        }

        const validation = validatePrismaVoiceConfig(extractedConfig.value);
        if (!validation.valid) {
            throw new PrismaVoiceConfigReadError(
                'Prisma voice config response failed domain validation',
                'validation',
                undefined,
                validation.issues,
            );
        }

        return validation.value;
    }
}

type PrismaVoiceConfigWriteErrorKind = 'request-validation' | 'http' | 'json' | 'response-validation';

export class PrismaVoiceConfigWriteError extends Error {
    public readonly kind: PrismaVoiceConfigWriteErrorKind;
    public readonly statusCode: number | undefined;
    public readonly issues: PrismaVoiceConfigValidationIssue[] | undefined;

    public constructor(
        message: string,
        kind: PrismaVoiceConfigWriteErrorKind,
        statusCode?: number,
        issues?: PrismaVoiceConfigValidationIssue[],
        options?: ErrorOptions,
    ) {
        super(message, options);
        this.name = 'PrismaVoiceConfigWriteError';
        this.kind = kind;
        this.statusCode = statusCode;
        this.issues = issues;
    }
}

export class HttpPrismaVoiceConfigWriter implements PrismaVoiceConfigWriter {
    private readonly url: string;
    private readonly responseContract: PrismaVoiceConfigResponseContract;
    private readonly fetchImpl: typeof fetch;

    public constructor(
        url: string,
        responseContract: PrismaVoiceConfigResponseContract = 'legacy-flat',
        fetchImpl: typeof fetch = (...args) => fetch(...args),
    ) {
        this.url = url;
        this.responseContract = responseContract;
        this.fetchImpl = fetchImpl;
    }

    public async updateConfig(
        config: PrismaVoiceConfig,
        signal?: AbortSignal,
    ): Promise<PrismaVoiceConfig> {
        const requestValidation = validatePrismaVoiceConfig(config);
        if (!requestValidation.valid) {
            throw new PrismaVoiceConfigWriteError(
                'Prisma voice config request failed domain validation',
                'request-validation',
                undefined,
                requestValidation.issues,
            );
        }

        let response: Response;
        try {
            response = await this.fetchImpl(this.url, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                },
                body: JSON.stringify(requestValidation.value),
                cache: 'no-store',
                ...(signal === undefined ? {} : { signal }),
            });
        } catch (error) {
            return this.confirmAmbiguousWrite(requestValidation.value, error, signal);
        }

        if (!response.ok) {
            throw new PrismaVoiceConfigWriteError(
                `Prisma voice config update failed with status ${response.status}`,
                'http',
                response.status,
            );
        }

        let payload: unknown;
        try {
            payload = await response.json();
        } catch (error) {
            return this.confirmAmbiguousWrite(requestValidation.value, new PrismaVoiceConfigWriteError(
                'Prisma voice config update response is not valid JSON',
                'json',
                undefined,
                undefined,
                { cause: error },
            ), signal);
        }

        const extractedConfig = extractResponseConfig(payload, this.responseContract);
        if (!extractedConfig.valid) {
            return this.confirmAmbiguousWrite(requestValidation.value, new PrismaVoiceConfigWriteError(
                extractedConfig.message,
                'response-validation',
            ), signal);
        }

        const responseValidation = validatePrismaVoiceConfig(extractedConfig.value);
        if (!responseValidation.valid) {
            return this.confirmAmbiguousWrite(requestValidation.value, new PrismaVoiceConfigWriteError(
                'Prisma voice config update response failed domain validation',
                'response-validation',
                undefined,
                responseValidation.issues,
            ), signal);
        }

        return responseValidation.value;
    }

    private async confirmAmbiguousWrite(
        sentConfig: PrismaVoiceConfig,
        ambiguousError: unknown,
        signal?: AbortSignal,
    ): Promise<PrismaVoiceConfig> {
        if (signal?.aborted) {
            throw ambiguousError;
        }

        try {
            const confirmedConfig = await new HttpPrismaVoiceConfigReader(
                this.url,
                this.responseContract,
                this.fetchImpl,
            ).readConfig(signal ?? new AbortController().signal);
            if (arePrismaVoiceConfigsEqual(confirmedConfig, sentConfig)) {
                return confirmedConfig;
            }
        } catch {
            // The original PUT ambiguity remains authoritative when confirmation fails.
        }

        throw ambiguousError;
    }
}
