import { DEFAULT_COPY_REGISTER, parseCopyRegister, serializeCopyRegister } from '../domain/copyRegister';
import type { CopyRegister } from '../domain/copyRegister';
import { sharedConfigStorage } from './sharedConfigStorage.service';

export const COPY_REGISTER_STORAGE_KEY = 'hmi:copy-register';

/** Active register; usted when nothing valid is stored or storage cannot be read. */
export function readCopyRegister(): CopyRegister {
    try {
        return parseCopyRegister(sharedConfigStorage.getItem(COPY_REGISTER_STORAGE_KEY));
    } catch {
        return DEFAULT_COPY_REGISTER;
    }
}

export function saveCopyRegister(register: CopyRegister): void {
    sharedConfigStorage.setItem(COPY_REGISTER_STORAGE_KEY, serializeCopyRegister(register));
}
