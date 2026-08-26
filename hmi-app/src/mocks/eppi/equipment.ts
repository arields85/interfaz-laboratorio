import type { EppiTableColumnDefinition, EppiTableDefinition } from '../../domain';
import { createTableDefinition, type CapturedTableRow } from './shared';

const equipmentColumns = [
    {
        "id": "name",
        "label": "Nombre",
        "widthPercent": 17
    },
    {
        "id": "tag",
        "label": "TAG",
        "widthPercent": 8
    },
    {
        "id": "brand",
        "label": "Marca",
        "widthPercent": 10
    },
    {
        "id": "serial",
        "label": "Número de serie",
        "widthPercent": 13
    },
    {
        "id": "model",
        "label": "Modelo",
        "widthPercent": 10
    },
    {
        "id": "fixed",
        "label": "Equipo fijo",
        "widthPercent": 10
    },
    {
        "id": "observations",
        "label": "Observaciones",
        "widthPercent": 12
    },
    {
        "id": "status",
        "label": "Estado",
        "widthPercent": 20,
        "status": true
    }
] as const satisfies readonly EppiTableColumnDefinition[];

const toolColumns = [
    {
        "id": "name",
        "label": "Nombre",
        "widthPercent": 17
    },
    {
        "id": "tag",
        "label": "TAG",
        "widthPercent": 8
    },
    {
        "id": "brand",
        "label": "Marca",
        "widthPercent": 10
    },
    {
        "id": "serial",
        "label": "Número de serie",
        "widthPercent": 13
    },
    {
        "id": "model",
        "label": "Modelo",
        "widthPercent": 10
    },
    {
        "id": "reserved-fixed-equipment",
        "label": null,
        "widthPercent": 10,
        "accessibilityNeutral": true
    },
    {
        "id": "observations",
        "label": "Observaciones",
        "widthPercent": 12
    },
    {
        "id": "status",
        "label": "Estado",
        "widthPercent": 20,
        "status": true
    }
] as const satisfies readonly EppiTableColumnDefinition[];

// Provenance: mockup/src/data.ts; ui-audit-structural/screens/003-equipamiento.json
export const equipmentRows = [
    [
        "Agitador",
        "EP-007",
        "Bioamerican",
        "Genérico",
        "Genérico",
        "No",
        "N/A",
        "Limpio"
    ],
    [
        "Agitador",
        "EP-054",
        "Dlab",
        "Genérico",
        "OS70PRO",
        "No",
        "N/A",
        "Limpio"
    ],
    [
        "Agitador",
        "EP-021",
        "DLab",
        "Genérico",
        "Genérico",
        "No",
        "N/A",
        "Para limpiar"
    ]
] as const satisfies readonly CapturedTableRow[];

// Provenance: mockup/src/data.ts; ui-audit-structural/screens/003-equipamiento.json
export const toolRows = [
    [
        "Malla #14",
        "EUP-017",
        "Frewitt",
        "Genérico",
        "Oscilante",
        "N/A",
        "Limpio"
    ],
    [
        "Matr. Cetirizina",
        "P-04",
        "Genérico",
        "Genérico",
        "Genérico",
        "N/A",
        "Limpio"
    ],
    [
        "Matr. Mectin XR 1000",
        "P-03",
        "Natoli",
        "Genérico",
        "Genérico",
        "N/A",
        "En proceso (en campaña)"
    ]
] as const satisfies readonly CapturedTableRow[];

export const eppiEquipmentTable: EppiTableDefinition = createTableDefinition('equipment', 'Equipo', equipmentColumns, equipmentRows, { minWidth: 948 });
export const eppiToolsTable: EppiTableDefinition = createTableDefinition('tools', 'Elemento de uso', toolColumns, toolRows, { minWidth: 948 });
