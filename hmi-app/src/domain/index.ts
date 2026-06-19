// Barrel export del dominio interno.
// Importar desde aquí en lugar de from archivos específicos
// para mantener una única interfaz del módulo de dominio.

export * from './equipment.types';
export * from './telemetry.types';
export * from './alert.types';
export * from './alertHistory.types';
export * from './assistant.types';
export * from './admin.types';
export * from './activityAnalytics.types';
export * from './dataContract.types';
export * from './auth';
export type { CatalogVariable } from './variableCatalog.types';
