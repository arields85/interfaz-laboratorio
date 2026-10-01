import type { LedaVoiceConfig } from '../domain/ledaVoiceConfig';

export interface LedaVoiceConfigReader {
    readConfig(signal: AbortSignal): Promise<LedaVoiceConfig>;
}

export interface LedaVoiceConfigWriter {
    updateConfig(config: LedaVoiceConfig, signal?: AbortSignal): Promise<LedaVoiceConfig>;
}

export type LedaVoiceConfigPort = LedaVoiceConfigReader & LedaVoiceConfigWriter;
