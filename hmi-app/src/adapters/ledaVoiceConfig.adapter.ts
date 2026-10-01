import {
    areLedaVoiceConfigsEqual,
    validateLedaVoiceConfig,
    type LedaVoiceConfig,
    type LedaVoiceConfigValidationIssue,
} from '../domain/ledaVoiceConfig';
import type {
    LedaVoiceConfigReader,
    LedaVoiceConfigWriter,
} from '../services/ledaVoiceConfigPort';

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
): ExtractedResponseConfig | InvalidResponseEnvelope {
    if (
        typeof payload !== 'object'
        || payload === null
        || Array.isArray(payload)
        || !Object.prototype.hasOwnProperty.call(payload, 'config')
    ) {
        return {
            valid: false,
            message: 'Leda voice config response must be an object envelope with an own config property',
        };
    }

    return {
        valid: true,
        value: (payload as Record<string, unknown>).config,
    };
}

type LedaVoiceConfigReadErrorKind = 'http' | 'json' | 'validation';

export class LedaVoiceConfigReadError extends Error {
    public readonly kind: LedaVoiceConfigReadErrorKind;
    public readonly statusCode: number | undefined;
    public readonly issues: LedaVoiceConfigValidationIssue[] | undefined;

    public constructor(
        message: string,
        kind: LedaVoiceConfigReadErrorKind,
        statusCode?: number,
        issues?: LedaVoiceConfigValidationIssue[],
        options?: ErrorOptions,
    ) {
        super(message, options);
        this.name = 'LedaVoiceConfigReadError';
        this.kind = kind;
        this.statusCode = statusCode;
        this.issues = issues;
    }
}

export class HttpLedaVoiceConfigReader implements LedaVoiceConfigReader {
    private readonly url: string;
    private readonly fetchImpl: typeof fetch;

    public constructor(
        url: string,
        fetchImpl: typeof fetch = (...args) => fetch(...args),
    ) {
        this.url = url;
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
            throw new LedaVoiceConfigReadError(
                `Leda voice config request failed with status ${response.status}`,
                'http',
                response.status,
            );
        }

        let payload: unknown;
        try {
            payload = await response.json();
        } catch (error) {
            throw new LedaVoiceConfigReadError(
                'Leda voice config response is not valid JSON',
                'json',
                undefined,
                undefined,
                { cause: error },
            );
        }

        const extractedConfig = extractResponseConfig(payload);
        if (!extractedConfig.valid) {
            throw new LedaVoiceConfigReadError(
                extractedConfig.message,
                'validation',
            );
        }

        const validation = validateLedaVoiceConfig(extractedConfig.value);
        if (!validation.valid) {
            throw new LedaVoiceConfigReadError(
                'Leda voice config response failed domain validation',
                'validation',
                undefined,
                validation.issues,
            );
        }

        return validation.value;
    }
}

type LedaVoiceConfigWriteErrorKind = 'request-validation' | 'http' | 'json' | 'response-validation';

export class LedaVoiceConfigWriteError extends Error {
    public readonly kind: LedaVoiceConfigWriteErrorKind;
    public readonly statusCode: number | undefined;
    public readonly issues: LedaVoiceConfigValidationIssue[] | undefined;

    public constructor(
        message: string,
        kind: LedaVoiceConfigWriteErrorKind,
        statusCode?: number,
        issues?: LedaVoiceConfigValidationIssue[],
        options?: ErrorOptions,
    ) {
        super(message, options);
        this.name = 'LedaVoiceConfigWriteError';
        this.kind = kind;
        this.statusCode = statusCode;
        this.issues = issues;
    }
}

export class HttpLedaVoiceConfigWriter implements LedaVoiceConfigWriter {
    private readonly url: string;
    private readonly fetchImpl: typeof fetch;

    public constructor(
        url: string,
        fetchImpl: typeof fetch = (...args) => fetch(...args),
    ) {
        this.url = url;
        this.fetchImpl = fetchImpl;
    }

    public async updateConfig(
        config: LedaVoiceConfig,
        signal?: AbortSignal,
    ): Promise<LedaVoiceConfig> {
        const requestValidation = validateLedaVoiceConfig(config);
        if (!requestValidation.valid) {
            throw new LedaVoiceConfigWriteError(
                'Leda voice config request failed domain validation',
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
            throw new LedaVoiceConfigWriteError(
                `Leda voice config update failed with status ${response.status}`,
                'http',
                response.status,
            );
        }

        let payload: unknown;
        try {
            payload = await response.json();
        } catch (error) {
            return this.confirmAmbiguousWrite(requestValidation.value, new LedaVoiceConfigWriteError(
                'Leda voice config update response is not valid JSON',
                'json',
                undefined,
                undefined,
                { cause: error },
            ), signal);
        }

        const extractedConfig = extractResponseConfig(payload);
        if (!extractedConfig.valid) {
            return this.confirmAmbiguousWrite(requestValidation.value, new LedaVoiceConfigWriteError(
                extractedConfig.message,
                'response-validation',
            ), signal);
        }

        const responseValidation = validateLedaVoiceConfig(extractedConfig.value);
        if (!responseValidation.valid) {
            return this.confirmAmbiguousWrite(requestValidation.value, new LedaVoiceConfigWriteError(
                'Leda voice config update response failed domain validation',
                'response-validation',
                undefined,
                responseValidation.issues,
            ), signal);
        }

        return responseValidation.value;
    }

    private async confirmAmbiguousWrite(
        sentConfig: LedaVoiceConfig,
        ambiguousError: unknown,
        signal?: AbortSignal,
    ): Promise<LedaVoiceConfig> {
        if (signal?.aborted) {
            throw ambiguousError;
        }

        try {
            const confirmedConfig = await new HttpLedaVoiceConfigReader(
                this.url,
                this.fetchImpl,
            ).readConfig(signal ?? new AbortController().signal);
            if (areLedaVoiceConfigsEqual(confirmedConfig, sentConfig)) {
                return confirmedConfig;
            }
        } catch {
            // The original PUT ambiguity remains authoritative when confirmation fails.
        }

        throw ambiguousError;
    }
}
