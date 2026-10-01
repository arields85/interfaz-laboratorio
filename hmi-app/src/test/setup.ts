import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';
import { localStorageSharedConfig } from './localStorageSharedConfig';

// The app-wide singleton talks to the Leda runtime; tests get a localStorage-backed
// double instead. `createSharedConfigStorage` stays real for the adapter's own suite.
vi.mock('../services/sharedConfigStorage.service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/sharedConfigStorage.service')>()),
  sharedConfigStorage: localStorageSharedConfig,
}));

class ResizeObserverMock {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

globalThis.ResizeObserver = ResizeObserverMock;
