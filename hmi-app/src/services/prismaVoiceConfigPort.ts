import type { PrismaVoiceConfig } from '../domain/prismaVoiceConfig';

export interface PrismaVoiceConfigReader {
    readConfig(signal: AbortSignal): Promise<PrismaVoiceConfig>;
}

export interface PrismaVoiceConfigWriter {
    updateConfig(config: PrismaVoiceConfig): Promise<PrismaVoiceConfig>;
}

export type PrismaVoiceConfigPort = PrismaVoiceConfigReader & PrismaVoiceConfigWriter;
