import type { EppiTableColumnDefinition, EppiTableDefinition } from '../../domain';
import { createCapturedPage, createTableDefinition, type CapturedTableRow } from './shared';
import type { EppiCapturedPagination } from '../../domain';

const locationColumns = [
    {
        "id": "name",
        "label": "Nombre",
        "widthPercent": 24
    },
    {
        "id": "tag",
        "label": "TAG",
        "widthPercent": 18
    },
    {
        "id": "use",
        "label": "Uso",
        "widthPercent": 18
    },
    {
        "id": "observations",
        "label": "Observaciones",
        "widthPercent": 20
    },
    {
        "id": "status",
        "label": "Estado",
        "widthPercent": 20,
        "status": true
    }
] as const satisfies readonly EppiTableColumnDefinition[];
const logbookColumns = [
    {
        "id": "label",
        "label": "Rótulo",
        "widthPercent": 16,
        "status": true
    },
    {
        "id": "date",
        "label": "Fecha/Hora",
        "widthPercent": 18
    },
    {
        "id": "tag",
        "label": "Tag",
        "widthPercent": 12
    },
    {
        "id": "product",
        "label": "Producto",
        "widthPercent": 16
    },
    {
        "id": "batch",
        "label": "Lote",
        "widthPercent": 11
    },
    {
        "id": "performedBy",
        "label": "Realizó",
        "widthPercent": 17
    },
    {
        "id": "verified",
        "label": "Verificado",
        "widthPercent": 10,
        "status": true
    }
] as const satisfies readonly EppiTableColumnDefinition[];
const processColumns = [
    {
        "id": "order",
        "label": "Lote (Orden)",
        "widthPercent": 12
    },
    {
        "id": "process",
        "label": "Proceso de producto",
        "widthPercent": 17
    },
    {
        "id": "product",
        "label": "Producto",
        "widthPercent": 15
    },
    {
        "id": "box",
        "label": "Box",
        "widthPercent": 9
    },
    {
        "id": "status",
        "label": "Estado",
        "widthPercent": 13,
        "status": true
    },
    {
        "id": "pharmaForm",
        "label": "Forma farmacéutica",
        "widthPercent": 13
    },
    {
        "id": "finalForm",
        "label": "Forma final",
        "widthPercent": 8
    },
    {
        "id": "blocked",
        "label": "Bloqueado",
        "widthPercent": 7
    },
    {
        "id": "hidden",
        "label": "Oculto",
        "widthPercent": 6
    }
] as const satisfies readonly EppiTableColumnDefinition[];
const productionColumns = [
    {
        "id": "name",
        "label": "Nombre",
        "widthPercent": 16
    },
    {
        "id": "tag",
        "label": "Tag",
        "widthPercent": 12
    },
    {
        "id": "use",
        "label": "Uso",
        "widthPercent": 11
    },
    {
        "id": "label",
        "label": "Rótulo",
        "widthPercent": 15,
        "status": true
    },
    {
        "id": "processType",
        "label": "Tipo de proceso",
        "widthPercent": 13
    },
    {
        "id": "order",
        "label": "Lote (Orden)",
        "widthPercent": 13
    },
    {
        "id": "product",
        "label": "Producto",
        "widthPercent": 12
    },
    {
        "id": "status",
        "label": "Estado",
        "widthPercent": 8,
        "status": true
    }
] as const satisfies readonly EppiTableColumnDefinition[];

// Provenance: ui-audit-structural/screens/004-locales.json
export const locationRows = [
    [
        "Calibración y Mezclado III",
        "Mezclado III",
        "granulacion",
        "N/A",
        "En proceso (en campaña)"
    ],
    [
        "Central de Pesadas",
        "Central de Pesadas",
        "pesadas",
        "N/A",
        "Limpio"
    ],
    [
        "Compresión I",
        "Compresión I",
        "compresion",
        "N/A",
        "En proceso"
    ],
    [
        "Compresión II",
        "Compresión II",
        "compresion",
        "N/A",
        "En proceso (en campaña)"
    ],
    [
        "Compresión III",
        "Compresión III",
        "compresion",
        "N/A",
        "En proceso (en campaña)"
    ],
    [
        "Compresión IV",
        "Compresión IV",
        "compresion",
        "N/A",
        "En proceso (en campaña)"
    ],
    [
        "Compresión V",
        "Compresión V",
        "compresion",
        "N/A",
        "En proceso (en campaña)"
    ],
    [
        "Compresión VI",
        "Compresión VI",
        "compresion",
        "N/A",
        "En proceso (en campaña)"
    ],
    [
        "Granulación I",
        "Granulación I",
        "granulacion",
        "N/A",
        "En proceso (en campaña)"
    ],
    [
        "Granulación II",
        "Granulación II",
        "granulacion",
        "N/A",
        "En proceso"
    ],
    [
        "Granulación III",
        "Granulación III",
        "granulacion",
        "N/A",
        "Para limpiar"
    ],
    [
        "Mezclado I",
        "Mezclado I",
        "granulacion",
        "N/A",
        "Para limpiar"
    ],
    [
        "Mezclado II",
        "Mezclado II",
        "granulacion",
        "N/A",
        "Para limpiar"
    ],
    [
        "Recubrimiento",
        "Recubrimiento",
        "recubrimiento",
        "N/A",
        "Limpio"
    ],
    [
        "Recubrimiento II",
        "Recubrimiento II",
        "recubrimiento",
        "N/A",
        "Para limpiar"
    ],
    [
        "Recubrimiento III",
        "Recubrimiento III",
        "recubrimiento",
        "N/A",
        "En proceso (en campaña)"
    ],
    [
        "Secado I",
        "Secado I",
        "granulacion",
        "N/A",
        "En proceso"
    ],
    [
        "Secado II",
        "Secado II",
        "granulacion",
        "N/A",
        "Limpio"
    ],
    [
        "Secado III",
        "Secado III",
        "granulacion",
        "N/A",
        "En proceso"
    ]
] as const satisfies readonly CapturedTableRow[];
// Provenance: ui-audit-structural/screens/005-bitacora.json
export const logbookPageOneRows = [
    [
        "Limpio",
        "hace 16 días\n08/08/2026 05:00:00",
        "Box M3",
        "Antipresol D",
        "239425",
        "Mariano Alberto Suarez",
        "Verificado"
    ],
    [
        "Limpio",
        "hace 16 días\n08/08/2026 05:00:00",
        "EP-085",
        "N/A",
        "N/A",
        "Mariano Alberto Suarez",
        "Verificado"
    ],
    [
        "Limpio",
        "hace 16 días\n08/08/2026 05:00:00",
        "EP-052",
        "N/A",
        "N/A",
        "Mariano Alberto Suarez",
        "Verificado"
    ],
    [
        "Limpio",
        "hace 16 días\n08/08/2026 05:00:00",
        "EP-172",
        "N/A",
        "N/A",
        "Mariano Alberto Suarez",
        "Verificado"
    ],
    [
        "Limpio",
        "hace 16 días\n08/08/2026 05:00:00",
        "EP-183",
        "N/A",
        "N/A",
        "Mariano Alberto Suarez",
        "Verificado"
    ],
    [
        "Limpio",
        "hace 16 días\n08/08/2026 05:00:00",
        "EP-246",
        "N/A",
        "N/A",
        "Mariano Alberto Suarez",
        "Verificado"
    ],
    [
        "En proceso",
        "hace 17 días\n07/08/2026 16:25:51",
        "EP-082",
        "Dilcoran 160 mg",
        "TC26M",
        "Ricardo Ariel Gonzalez",
        "Verificado"
    ],
    [
        "En proceso",
        "hace 17 días\n07/08/2026 16:05:30",
        "EUP-052",
        "Dilcoran 160 mg",
        "TC26M",
        "Maria Laura Maurizio",
        "Verificado"
    ],
    [
        "En proceso",
        "hace 17 días\n07/08/2026 16:05:21",
        "EUP-036",
        "Dilcoran 160 mg",
        "TC26M",
        "Maria Laura Maurizio",
        "Verificado"
    ],
    [
        "En proceso",
        "hace 17 días\n07/08/2026 16:05:10",
        "EP-042",
        "Dilcoran 160 mg",
        "TC26M",
        "Maria Laura Maurizio",
        "Verificado"
    ],
    [
        "En proceso",
        "hace 17 días\n07/08/2026 16:04:59",
        "EP-086",
        "Dilcoran 160 mg",
        "TC26M",
        "Maria Laura Maurizio",
        "Verificado"
    ],
    [
        "En proceso",
        "hace 17 días\n07/08/2026 16:03:34",
        "EP-103",
        "Dilcoran 160 mg",
        "TC26M",
        "Ricardo Ariel Gonzalez",
        "Verificado"
    ],
    [
        "En proceso",
        "hace 17 días\n07/08/2026 16:03:34",
        "Granulación II",
        "Dilcoran 160 mg",
        "TC26M",
        "Ricardo Ariel Gonzalez",
        "Verificado"
    ],
    [
        "Limpio",
        "hace 17 días\n07/08/2026 16:00:46",
        "Granulación II",
        "Dilcoran 80 mg",
        "TM55M",
        "Maria Laura Maurizio",
        "Verificado"
    ],
    [
        "Limpio",
        "hace 17 días\n07/08/2026 15:47:53",
        "EP-067",
        "Duflegrip",
        "196426",
        "Fernando Gabriel Perez",
        "Pendiente"
    ],
    [
        "Limpio",
        "hace 17 días\n07/08/2026 15:47:53",
        "Mezclado II",
        "Duflegrip",
        "196426",
        "Fernando Gabriel Perez",
        "Pendiente"
    ],
    [
        "En proceso (en campaña)",
        "hace 17 días\n07/08/2026 15:15:02",
        "EP-176",
        "Dilcoran 80 mg",
        "TM55K",
        "Sergio Emanuel Quiroga",
        "Verificado"
    ],
    [
        "En proceso (en campaña)",
        "hace 17 días\n07/08/2026 15:15:02",
        "EP-056",
        "Dilcoran 80 mg",
        "TM55K",
        "Sergio Emanuel Quiroga",
        "Verificado"
    ],
    [
        "En proceso (en campaña)",
        "hace 17 días\n07/08/2026 15:15:02",
        "EP-174",
        "Dilcoran 80 mg",
        "TM55K",
        "Sergio Emanuel Quiroga",
        "Verificado"
    ],
    [
        "En proceso (en campaña)",
        "hace 17 días\n07/08/2026 15:15:02",
        "EP-112",
        "Dilcoran 80 mg",
        "TM55K",
        "Sergio Emanuel Quiroga",
        "Verificado"
    ],
    [
        "En proceso (en campaña)",
        "hace 17 días\n07/08/2026 15:15:02",
        "Compresión V",
        "Dilcoran 80 mg",
        "TM55K",
        "Sergio Emanuel Quiroga",
        "Verificado"
    ],
    [
        "Limpio",
        "hace 17 días\n07/08/2026 15:13:37",
        "EP-184",
        "Dilcoran 80 mg",
        "TM54K",
        "Sergio Emanuel Quiroga",
        "Verificado"
    ],
    [
        "Limpio",
        "hace 17 días\n07/08/2026 15:12:17",
        "Compresión V",
        "Dilcoran 80 mg",
        "TM54K",
        "Sergio Emanuel Quiroga",
        "Verificado"
    ],
    [
        "Limpio",
        "hace 17 días\n07/08/2026 15:12:17",
        "EP-112",
        "Dilcoran 80 mg",
        "TM54K",
        "Sergio Emanuel Quiroga",
        "Verificado"
    ],
    [
        "Limpio",
        "hace 17 días\n07/08/2026 15:12:17",
        "EP-174",
        "Dilcoran 80 mg",
        "TM54K",
        "Sergio Emanuel Quiroga",
        "Verificado"
    ],
    [
        "Limpio",
        "hace 17 días\n07/08/2026 15:12:17",
        "EP-056",
        "Dilcoran 80 mg",
        "TM54K",
        "Sergio Emanuel Quiroga",
        "Verificado"
    ],
    [
        "Limpio",
        "hace 17 días\n07/08/2026 15:12:17",
        "EP-176",
        "Dilcoran 80 mg",
        "TM54K",
        "Sergio Emanuel Quiroga",
        "Verificado"
    ],
    [
        "Para limpiar",
        "hace 17 días\n07/08/2026 15:12:01",
        "Compresión V",
        "Dilcoran 80 mg",
        "TM54K",
        "Sergio Emanuel Quiroga",
        "Verificado"
    ],
    [
        "Para limpiar",
        "hace 17 días\n07/08/2026 15:12:01",
        "EP-176",
        "Dilcoran 80 mg",
        "TM54K",
        "Sergio Emanuel Quiroga",
        "Verificado"
    ],
    [
        "Para limpiar",
        "hace 17 días\n07/08/2026 15:12:01",
        "EP-112",
        "Dilcoran 80 mg",
        "TM54K",
        "Sergio Emanuel Quiroga",
        "Verificado"
    ],
    [
        "Para limpiar",
        "hace 17 días\n07/08/2026 15:12:01",
        "EP-174",
        "Dilcoran 80 mg",
        "TM54K",
        "Sergio Emanuel Quiroga",
        "Verificado"
    ],
    [
        "Para limpiar",
        "hace 17 días\n07/08/2026 15:12:01",
        "EP-184",
        "Dilcoran 80 mg",
        "TM54K",
        "Sergio Emanuel Quiroga",
        "Verificado"
    ],
    [
        "Para limpiar",
        "hace 17 días\n07/08/2026 15:12:01",
        "EP-056",
        "Dilcoran 80 mg",
        "TM54K",
        "Sergio Emanuel Quiroga",
        "Verificado"
    ],
    [
        "En proceso (en campaña)",
        "hace 17 días\n07/08/2026 15:05:07",
        "EP-002",
        "Ampliar 40 mg",
        "TH21M",
        "Silvio Alejandro Alvarez",
        "Verificado"
    ],
    [
        "En proceso (en campaña)",
        "hace 17 días\n07/08/2026 15:05:07",
        "EUP-007",
        "Ampliar 40 mg",
        "TH21M",
        "Silvio Alejandro Alvarez",
        "Verificado"
    ],
    [
        "En proceso (en campaña)",
        "hace 17 días\n07/08/2026 15:05:07",
        "EUP-011",
        "Ampliar 40 mg",
        "TH21M",
        "Silvio Alejandro Alvarez",
        "Verificado"
    ],
    [
        "En proceso (en campaña)",
        "hace 17 días\n07/08/2026 15:05:07",
        "Mezclado III",
        "Ampliar 40 mg",
        "TH21M",
        "Silvio Alejandro Alvarez",
        "Verificado"
    ],
    [
        "Limpio",
        "hace 17 días\n07/08/2026 15:04:17",
        "EUP-036",
        "Dilcoran 80 mg",
        "TM55M",
        "Gabriel Nicolas Mieres",
        "Verificado"
    ],
    [
        "Limpio",
        "hace 17 días\n07/08/2026 15:04:02",
        "EUP-052",
        "Dilcoran 80 mg",
        "TM55M",
        "Gabriel Nicolas Mieres",
        "Verificado"
    ],
    [
        "Limpio",
        "hace 17 días\n07/08/2026 15:03:33",
        "EP-086",
        "Dilcoran 80 mg",
        "TM55M",
        "Gabriel Nicolas Mieres",
        "Verificado"
    ],
    [
        "Limpio",
        "hace 17 días\n07/08/2026 15:03:18",
        "EP-042",
        "Dilcoran 80 mg",
        "TM55M",
        "Gabriel Nicolas Mieres",
        "Verificado"
    ],
    [
        "Limpio",
        "hace 17 días\n07/08/2026 15:02:59",
        "EP-103",
        "Dilcoran 80 mg",
        "TM55M",
        "Gabriel Nicolas Mieres",
        "Verificado"
    ],
    [
        "Limpio",
        "hace 17 días\n07/08/2026 15:01:14",
        "EP-082",
        "Dilcoran 80 mg",
        "TM55M",
        "Gabriel Nicolas Mieres",
        "Verificado"
    ],
    [
        "Limpio",
        "hace 17 días\n07/08/2026 15:01:14",
        "Granulación II",
        "Dilcoran 80 mg",
        "TM55M",
        "Gabriel Nicolas Mieres",
        "Verificado"
    ],
    [
        "Para limpiar",
        "hace 17 días\n07/08/2026 15:00:51",
        "EUP-036",
        "Dilcoran 80 mg",
        "TM55M",
        "Gabriel Nicolas Mieres",
        "Verificado"
    ],
    [
        "Para limpiar",
        "hace 17 días\n07/08/2026 15:00:51",
        "Granulación II",
        "Dilcoran 80 mg",
        "TM55M",
        "Gabriel Nicolas Mieres",
        "Verificado"
    ],
    [
        "Para limpiar",
        "hace 17 días\n07/08/2026 15:00:51",
        "EUP-052",
        "Dilcoran 80 mg",
        "TM55M",
        "Gabriel Nicolas Mieres",
        "Verificado"
    ],
    [
        "Para limpiar",
        "hace 17 días\n07/08/2026 15:00:51",
        "EP-103",
        "Dilcoran 80 mg",
        "TM55M",
        "Gabriel Nicolas Mieres",
        "Verificado"
    ],
    [
        "Para limpiar",
        "hace 17 días\n07/08/2026 15:00:51",
        "EP-086",
        "Dilcoran 80 mg",
        "TM55M",
        "Gabriel Nicolas Mieres",
        "Verificado"
    ],
    [
        "Para limpiar",
        "hace 17 días\n07/08/2026 15:00:51",
        "EP-082",
        "Dilcoran 80 mg",
        "TM55M",
        "Gabriel Nicolas Mieres",
        "Verificado"
    ]
] as const satisfies readonly CapturedTableRow[];
// Provenance: ui-audit-structural/screens/044-bitacora-pagina-2.json
export const logbookPageTwoRows = [
    [
        "Para limpiar",
        "hace 17 días\n07/08/2026 15:00:51",
        "EUP-052",
        "Dilcoran 80 mg",
        "TM55M",
        "Gabriel Nicolas Mieres",
        "Verificado"
    ],
    [
        "Limpio",
        "hace 17 días\n07/08/2026 14:59:55",
        "EUP-011",
        "Ampliar 40 mg",
        "TH20M",
        "Silvio Alejandro Alvarez",
        "Verificado"
    ],
    [
        "Limpio",
        "hace 17 días\n07/08/2026 14:59:36",
        "EUP-007",
        "Ampliar 40 mg",
        "TH20M",
        "Silvio Alejandro Alvarez",
        "Verificado"
    ],
    [
        "Limpio",
        "hace 17 días\n07/08/2026 14:59:11",
        "EP-002",
        "Ampliar 40 mg",
        "TH20M",
        "Silvio Alejandro Alvarez",
        "Verificado"
    ],
    [
        "Limpio",
        "hace 17 días\n07/08/2026 14:57:37",
        "Mezclado III",
        "Ampliar 40 mg",
        "TH20M",
        "Silvio Alejandro Alvarez",
        "Verificado"
    ],
    [
        "Para limpiar",
        "hace 17 días\n07/08/2026 14:56:55",
        "Mezclado III",
        "Ampliar 40 mg",
        "TH20M",
        "Silvio Alejandro Alvarez",
        "Verificado"
    ],
    [
        "Para limpiar",
        "hace 17 días\n07/08/2026 14:56:55",
        "EP-002",
        "Ampliar 40 mg",
        "TH20M",
        "Silvio Alejandro Alvarez",
        "Verificado"
    ],
    [
        "Para limpiar",
        "hace 17 días\n07/08/2026 14:56:55",
        "EUP-007",
        "Ampliar 40 mg",
        "TH20M",
        "Silvio Alejandro Alvarez",
        "Verificado"
    ],
    [
        "Para limpiar",
        "hace 17 días\n07/08/2026 14:56:55",
        "EUP-011",
        "Ampliar 40 mg",
        "TH20M",
        "Silvio Alejandro Alvarez",
        "Verificado"
    ],
    [
        "En proceso (en campaña)",
        "hace 17 días\n07/08/2026 13:52:11",
        "EUP-070",
        "Dilcoran 80 mg",
        "TM55M",
        "Mauricio David Alonso",
        "Verificado"
    ],
    [
        "En proceso (en campaña)",
        "hace 17 días\n07/08/2026 13:52:11",
        "EUP-062",
        "Dilcoran 80 mg",
        "TM55M",
        "Mauricio David Alonso",
        "Verificado"
    ],
    [
        "En proceso (en campaña)",
        "hace 17 días\n07/08/2026 13:52:11",
        "EP-110",
        "Dilcoran 80 mg",
        "TM55M",
        "Mauricio David Alonso",
        "Verificado"
    ],
    [
        "En proceso (en campaña)",
        "hace 17 días\n07/08/2026 13:52:11",
        "EP-119",
        "Dilcoran 80 mg",
        "TM55M",
        "Mauricio David Alonso",
        "Verificado"
    ],
    [
        "En proceso (en campaña)",
        "hace 17 días\n07/08/2026 13:52:11",
        "Granulación I",
        "Dilcoran 80 mg",
        "TM55M",
        "Mauricio David Alonso",
        "Verificado"
    ],
    [
        "Limpio",
        "hace 17 días\n07/08/2026 13:49:21",
        "EUP-070",
        "Xina",
        "D685",
        "Mauricio David Alonso",
        "Verificado"
    ],
    [
        "Limpio",
        "hace 17 días\n07/08/2026 13:49:09",
        "Central de Pesadas",
        "VALQUIR 5 mg",
        "00004",
        "Walter Gabriel Barral",
        "Verificado"
    ],
    [
        "Limpio",
        "hace 17 días\n07/08/2026 13:49:01",
        "EUP-062",
        "Dilcoran 80 mg",
        "TM54M",
        "Mauricio David Alonso",
        "Verificado"
    ],
    [
        "Limpio",
        "hace 17 días\n07/08/2026 13:48:34",
        "Granulación I",
        "Dilcoran 80 mg",
        "TM55M",
        "Mauricio David Alonso",
        "Verificado"
    ],
    [
        "Limpio",
        "hace 17 días\n07/08/2026 13:48:34",
        "EP-072",
        "Dilcoran 80 mg",
        "TM55M",
        "Mauricio David Alonso",
        "Verificado"
    ],
    [
        "Para limpiar",
        "hace 17 días\n07/08/2026 13:48:19",
        "Granulación I",
        "Dilcoran 80 mg",
        "TM55M",
        "Mauricio David Alonso",
        "Verificado"
    ],
    [
        "Para limpiar",
        "hace 17 días\n07/08/2026 13:48:19",
        "EP-072",
        "Dilcoran 80 mg",
        "TM55M",
        "Mauricio David Alonso",
        "Verificado"
    ],
    [
        "Para limpiar",
        "hace 17 días\n07/08/2026 13:47:18",
        "Recubrimiento II",
        "Virilon max 5 mg",
        "1342",
        "Leandro Leonel Victoria",
        "Verificado"
    ],
    [
        "Para limpiar",
        "hace 17 días\n07/08/2026 13:47:18",
        "EP-041",
        "Virilon max 5 mg",
        "1342",
        "Leandro Leonel Victoria",
        "Verificado"
    ],
    [
        "Para limpiar",
        "hace 17 días\n07/08/2026 13:47:18",
        "EP-071",
        "Virilon max 5 mg",
        "1342",
        "Leandro Leonel Victoria",
        "Verificado"
    ],
    [
        "Para limpiar",
        "hace 17 días\n07/08/2026 13:47:18",
        "EUP-030",
        "Virilon max 5 mg",
        "1342",
        "Leandro Leonel Victoria",
        "Verificado"
    ],
    [
        "Para limpiar",
        "hace 17 días\n07/08/2026 13:47:18",
        "EP-198",
        "Virilon max 5 mg",
        "1342",
        "Leandro Leonel Victoria",
        "Verificado"
    ],
    [
        "Para limpiar",
        "hace 17 días\n07/08/2026 13:47:18",
        "EP-113",
        "Virilon max 5 mg",
        "1342",
        "Leandro Leonel Victoria",
        "Verificado"
    ],
    [
        "Limpio",
        "hace 17 días\n07/08/2026 13:28:49",
        "Secado II",
        "Zoxx 100 mg",
        "RN14M",
        "Lucas Agustin Lezcano",
        "Verificado"
    ],
    [
        "Limpio",
        "hace 17 días\n07/08/2026 13:28:49",
        "EP-066",
        "Zoxx 100 mg",
        "RN14M",
        "Lucas Agustin Lezcano",
        "Verificado"
    ],
    [
        "En proceso (en campaña)",
        "hace 17 días\n07/08/2026 13:21:31",
        "ES-035",
        "Dilcoran 80 mg",
        "TM53P",
        "Jonathan Ezequiel Stricker",
        "Verificado"
    ],
    [
        "En proceso (en campaña)",
        "hace 17 días\n07/08/2026 13:21:31",
        "EP-118",
        "Dilcoran 80 mg",
        "TM53P",
        "Jonathan Ezequiel Stricker",
        "Verificado"
    ],
    [
        "En proceso (en campaña)",
        "hace 17 días\n07/08/2026 13:21:31",
        "EP-179",
        "Dilcoran 80 mg",
        "TM53P",
        "Jonathan Ezequiel Stricker",
        "Verificado"
    ],
    [
        "En proceso (en campaña)",
        "hace 17 días\n07/08/2026 13:21:31",
        "EP-155",
        "Dilcoran 80 mg",
        "TM53P",
        "Jonathan Ezequiel Stricker",
        "Verificado"
    ],
    [
        "En proceso (en campaña)",
        "hace 17 días\n07/08/2026 13:21:31",
        "Recubrimiento III",
        "Dilcoran 80 mg",
        "TM53P",
        "Jonathan Ezequiel Stricker",
        "Verificado"
    ],
    [
        "Para limpiar",
        "hace 17 días\n07/08/2026 13:13:13",
        "Mezclado II",
        "Duflegrip",
        "196426",
        "Matias Ezequiel Sanchez",
        "Verificado"
    ],
    [
        "Para limpiar",
        "hace 17 días\n07/08/2026 13:13:13",
        "EP-067",
        "Duflegrip",
        "196426",
        "Matias Ezequiel Sanchez",
        "Verificado"
    ],
    [
        "Para limpiar",
        "hace 17 días\n07/08/2026 13:13:13",
        "EP-075",
        "Duflegrip",
        "196426",
        "Matias Ezequiel Sanchez",
        "Verificado"
    ],
    [
        "Para limpiar",
        "hace 17 días\n07/08/2026 13:13:13",
        "EUP-002",
        "Duflegrip",
        "196426",
        "Matias Ezequiel Sanchez",
        "Verificado"
    ],
    [
        "Para limpiar",
        "hace 17 días\n07/08/2026 13:13:13",
        "EUP-019",
        "Duflegrip",
        "196426",
        "Matias Ezequiel Sanchez",
        "Verificado"
    ],
    [
        "Para limpiar",
        "hace 17 días\n07/08/2026 13:13:13",
        "EUP-021",
        "Duflegrip",
        "196426",
        "Matias Ezequiel Sanchez",
        "Verificado"
    ],
    [
        "Limpio",
        "hace 17 días\n07/08/2026 12:09:50",
        "Mezclado II",
        "Duflegrip",
        "196426",
        "Sebastian Lihue Frangi",
        "Verificado"
    ],
    [
        "Para limpiar",
        "hace 17 días\n07/08/2026 12:02:07",
        "Mezclado I",
        "Diclofenac Gesic",
        "TZ82M",
        "Federico Roman Paez",
        "Verificado"
    ],
    [
        "Para limpiar",
        "hace 17 días\n07/08/2026 12:02:07",
        "EP-083",
        "Diclofenac Gesic",
        "TZ82M",
        "Federico Roman Paez",
        "Verificado"
    ],
    [
        "Para limpiar",
        "hace 17 días\n07/08/2026 12:02:07",
        "EUP-004",
        "Diclofenac Gesic",
        "TZ82M",
        "Federico Roman Paez",
        "Verificado"
    ],
    [
        "Para limpiar",
        "hace 17 días\n07/08/2026 12:02:07",
        "EUP-040",
        "Diclofenac Gesic",
        "TZ82M",
        "Federico Roman Paez",
        "Verificado"
    ],
    [
        "Para limpiar",
        "hace 17 días\n07/08/2026 12:02:07",
        "EP-004-1",
        "Diclofenac Gesic",
        "TZ82M",
        "Federico Roman Paez",
        "Verificado"
    ],
    [
        "En proceso (en campaña)",
        "hace 17 días\n07/08/2026 11:30:32",
        "EUP-019",
        "Duflegrip",
        "196426",
        "Hernan Dario Segovia",
        "Verificado"
    ],
    [
        "En proceso (en campaña)",
        "hace 17 días\n07/08/2026 11:30:32",
        "EUP-021",
        "Duflegrip",
        "196426",
        "Hernan Dario Segovia",
        "Verificado"
    ],
    [
        "En proceso (en campaña)",
        "hace 17 días\n07/08/2026 11:30:32",
        "EUP-002",
        "Duflegrip",
        "196426",
        "Hernan Dario Segovia",
        "Verificado"
    ],
    [
        "En proceso (en campaña)",
        "hace 17 días\n07/08/2026 11:30:32",
        "EP-075",
        "Duflegrip",
        "196426",
        "Hernan Dario Segovia",
        "Verificado"
    ]
] as const satisfies readonly CapturedTableRow[];
// Provenance: ui-audit-structural/screens/009-procesos.json
export const processRows = [
    [
        "L025M (#1)",
        "Compresión (#447)",
        "Euretico 50mg",
        "Sin box",
        "En curso",
        "Comprimido",
        "Sí",
        "Sí",
        "No"
    ],
    [
        "104 (#254)",
        "Compresión de núcleos (#9)",
        "Unilevo 750mg",
        "Sin box",
        "Pendiente verificación final",
        "Núcleo",
        "No",
        "No",
        "Sí"
    ],
    [
        "104 (#254)",
        "Recubrimiento (#10)",
        "Unilevo 750mg",
        "Sin box",
        "Pendiente verificación final",
        "Comprimido recubierto",
        "Sí",
        "No",
        "Sí"
    ],
    [
        "122 (#255)",
        "Compresión (#8)",
        "Amlodicord 10mg",
        "Sin box",
        "Pendiente verificación final",
        "Comprimido",
        "Sí",
        "No",
        "Sí"
    ],
    [
        "S001 (#256)",
        "Compresión de núcleos (#55)",
        "Mebutar Compuesto",
        "Sin box",
        "Pendiente verificación final",
        "Núcleo",
        "No",
        "No",
        "Sí"
    ],
    [
        "S001 (#256)",
        "Paila 1 (#56)",
        "Mebutar Compuesto",
        "Sin box",
        "Pendiente verificación final",
        "Comprimido recubierto",
        "Sí",
        "No",
        "Sí"
    ],
    [
        "S001 (#256)",
        "Compresión de núcleos (1) (#57)",
        "Mebutar Compuesto",
        "Sin box",
        "Pendiente verificación final",
        "Núcleo",
        "No",
        "No",
        "Sí"
    ],
    [
        "S001 (#256)",
        "Paila 2 (#58)",
        "Mebutar Compuesto",
        "Sin box",
        "Pendiente verificación final",
        "Comprimido recubierto",
        "Sí",
        "No",
        "Sí"
    ],
    [
        "123 (#257)",
        "Compresión (#38)",
        "Amlodicord 5mg",
        "Sin box",
        "Pendiente verificación final",
        "Comprimido",
        "Sí",
        "No",
        "Sí"
    ],
    [
        "2AQDG (#258)",
        "Compresión (#6)",
        "Mectin XR 850mg",
        "Sin box",
        "Pendiente verificación final",
        "Comprimido",
        "Sí",
        "No",
        "Sí"
    ],
    [
        "2AQDG (#258)",
        "Otro (#7)",
        "Mectin XR 850mg",
        "Sin box",
        "Pendiente verificación final",
        "Otro",
        "No",
        "No",
        "Sí"
    ],
    [
        "286518 (#259)",
        "Compresión (#179)",
        "Furosemida",
        "Sin box",
        "Pendiente verificación final",
        "Comprimido",
        "Sí",
        "No",
        "Sí"
    ],
    [
        "285518 (#260)",
        "Compresión (#179)",
        "Furosemida",
        "Sin box",
        "Pendiente verificación final",
        "Comprimido",
        "Sí",
        "No",
        "Sí"
    ],
    [
        "2AQDH (#261)",
        "Compresión (#6)",
        "Mectin XR 850mg",
        "Sin box",
        "Pendiente verificación final",
        "Comprimido",
        "Sí",
        "No",
        "Sí"
    ],
    [
        "2AQDH (#261)",
        "Otro (#7)",
        "Mectin XR 850mg",
        "Sin box",
        "Pendiente verificación final",
        "Otro",
        "No",
        "No",
        "Sí"
    ],
    [
        "2AQDI (#262)",
        "Compresión (#6)",
        "Mectin XR 850mg",
        "Sin box",
        "Pendiente verificación final",
        "Comprimido",
        "Sí",
        "No",
        "Sí"
    ],
    [
        "2AQDI (#262)",
        "Otro (#7)",
        "Mectin XR 850mg",
        "Sin box",
        "Pendiente verificación final",
        "Otro",
        "No",
        "No",
        "Sí"
    ],
    [
        "2AQDK (#263)",
        "Compresión (#6)",
        "Mectin XR 850mg",
        "Sin box",
        "Pendiente verificación final",
        "Comprimido",
        "Sí",
        "No",
        "Sí"
    ],
    [
        "2AQDK (#263)",
        "Otro (#7)",
        "Mectin XR 850mg",
        "Sin box",
        "Pendiente verificación final",
        "Otro",
        "No",
        "No",
        "Sí"
    ],
    [
        "2AQDJ (#264)",
        "Compresión (#6)",
        "Mectin XR 850mg",
        "Sin box",
        "Pendiente verificación final",
        "Comprimido",
        "Sí",
        "No",
        "Sí"
    ],
    [
        "2AQDJ (#264)",
        "Otro (#7)",
        "Mectin XR 850mg",
        "Sin box",
        "Pendiente verificación final",
        "Otro",
        "No",
        "No",
        "Sí"
    ],
    [
        "2AQDL (#265)",
        "Compresión (#6)",
        "Mectin XR 850mg",
        "Sin box",
        "Pendiente verificación final",
        "Comprimido",
        "Sí",
        "No",
        "Sí"
    ],
    [
        "2AQDL (#265)",
        "Otro (#7)",
        "Mectin XR 850mg",
        "Sin box",
        "Pendiente verificación final",
        "Otro",
        "No",
        "No",
        "Sí"
    ],
    [
        "2ARAK (#266)",
        "Compresión (#92)",
        "Naproxeno Teva 500mg",
        "Sin box",
        "Pendiente verificación final",
        "Comprimido",
        "Sí",
        "No",
        "Sí"
    ],
    [
        "S001 (#267)",
        "Compresión (#49)",
        "Naprux 250mg",
        "Sin box",
        "Pendiente verificación final",
        "Comprimido",
        "Sí",
        "No",
        "Sí"
    ],
    [
        "3000 (#268)",
        "Compresión (#1)",
        "Naprux 500mg",
        "Sin box",
        "Pendiente verificación final",
        "Comprimido",
        "Sí",
        "No",
        "Sí"
    ],
    [
        "3000 (#269)",
        "Compresión de núcleos (#55)",
        "Mebutar Compuesto",
        "Sin box",
        "Pendiente verificación final",
        "Núcleo",
        "No",
        "No",
        "Sí"
    ],
    [
        "3000 (#269)",
        "Paila 1 (#56)",
        "Mebutar Compuesto",
        "Sin box",
        "Pendiente verificación final",
        "Comprimido recubierto",
        "Sí",
        "No",
        "Sí"
    ],
    [
        "3000 (#269)",
        "Compresión de núcleos (1) (#57)",
        "Mebutar Compuesto",
        "Sin box",
        "Pendiente verificación final",
        "Núcleo",
        "No",
        "No",
        "Sí"
    ],
    [
        "3000 (#269)",
        "Paila 2 (#58)",
        "Mebutar Compuesto",
        "Sin box",
        "Pendiente verificación final",
        "Comprimido recubierto",
        "Sí",
        "No",
        "Sí"
    ],
    [
        "102 (#270)",
        "Compresión (#74)",
        "Mudantil F 120mg",
        "Sin box",
        "Pendiente verificación final",
        "Comprimido",
        "Sí",
        "No",
        "Sí"
    ],
    [
        "104 (#271)",
        "Compresión (#95)",
        "Mudantil F 180mg",
        "Sin box",
        "Pendiente verificación final",
        "Comprimido",
        "Sí",
        "No",
        "Sí"
    ],
    [
        "306518 (#272)",
        "Compresión de núcleos (#2)",
        "Septocort 500mg",
        "Sin box",
        "Pendiente verificación final",
        "Núcleo",
        "No",
        "No",
        "Sí"
    ],
    [
        "306518 (#272)",
        "Recubrimiento (#3)",
        "Septocort 500mg",
        "Sin box",
        "Pendiente verificación final",
        "Comprimido recubierto",
        "Sí",
        "No",
        "Sí"
    ],
    [
        "3000 (#273)",
        "Compresión (#49)",
        "Naprux 250mg",
        "Sin box",
        "Pendiente verificación final",
        "Comprimido",
        "Sí",
        "No",
        "Sí"
    ],
    [
        "S001 (#274)",
        "Compresión (1) (#60)",
        "Mebutar 200mg",
        "Sin box",
        "Pendiente verificación final",
        "Comprimido",
        "Sí",
        "No",
        "Sí"
    ],
    [
        "S001 (#274)",
        "Compresión (#61)",
        "Mebutar 200mg",
        "Sin box",
        "Pendiente verificación final",
        "Comprimido",
        "Sí",
        "No",
        "Sí"
    ],
    [
        "S001 (#274)",
        "Compresión (2) (#62)",
        "Mebutar 200mg",
        "Sin box",
        "Pendiente verificación final",
        "Comprimido",
        "Sí",
        "No",
        "Sí"
    ],
    [
        "S001 (#275)",
        "Compresión (#52)",
        "Naprux Disten",
        "Sin box",
        "Pendiente verificación final",
        "Comprimido",
        "Sí",
        "No",
        "Sí"
    ],
    [
        "S001 (#277)",
        "Compresión (#96)",
        "Mebutar Masticable 200mg",
        "Sin box",
        "Pendiente verificación final",
        "Comprimido",
        "Sí",
        "No",
        "Sí"
    ],
    [
        "130 (#278)",
        "Compresión de núcleos (#4)",
        "Rodinac B12",
        "Sin box",
        "Pendiente verificación final",
        "Núcleo",
        "No",
        "No",
        "Sí"
    ],
    [
        "130 (#278)",
        "Recubrimiento (#5)",
        "Rodinac B12",
        "Sin box",
        "Pendiente verificación final",
        "Comprimido recubierto",
        "Sí",
        "No",
        "Sí"
    ],
    [
        "3000 (#279)",
        "Compresión (1) (#60)",
        "Mebutar 200mg",
        "Sin box",
        "Pendiente verificación final",
        "Comprimido",
        "Sí",
        "No",
        "Sí"
    ],
    [
        "3000 (#279)",
        "Compresión (#61)",
        "Mebutar 200mg",
        "Sin box",
        "Pendiente verificación final",
        "Comprimido",
        "Sí",
        "No",
        "Sí"
    ],
    [
        "3000 (#279)",
        "Compresión (2) (#62)",
        "Mebutar 200mg",
        "Sin box",
        "Pendiente verificación final",
        "Comprimido",
        "Sí",
        "No",
        "Sí"
    ],
    [
        "3000 (#281)",
        "Compresión (#96)",
        "Mebutar Masticable 200mg",
        "Sin box",
        "Pendiente verificación final",
        "Comprimido",
        "Sí",
        "No",
        "Sí"
    ],
    [
        "S001 (#284)",
        "Compresión de núcleos (#100)",
        "Naprux Rapid 550mg",
        "Sin box",
        "Pendiente verificación final",
        "Núcleo",
        "No",
        "No",
        "Sí"
    ],
    [
        "S001 (#284)",
        "Recubrimiento (#101)",
        "Naprux Rapid 550mg",
        "Sin box",
        "Pendiente verificación final",
        "Comprimido recubierto",
        "Sí",
        "No",
        "Sí"
    ],
    [
        "S001 (#285)",
        "Compresión de núcleos (#86)",
        "Levomine",
        "Sin box",
        "Pendiente verificación final",
        "Núcleo",
        "No",
        "No",
        "Sí"
    ],
    [
        "S001 (#285)",
        "Recubrimiento (#87)",
        "Levomine",
        "Sin box",
        "Pendiente verificación final",
        "Comprimido recubierto",
        "Sí",
        "No",
        "Sí"
    ]
] as const satisfies readonly CapturedTableRow[];
// Provenance: ui-audit-structural/screens/010-produccion.json
export const productionRows = [
    [
        "Calibración y Mezclado III",
        "Mezclado III",
        "granulacion",
        "En proceso (en campaña)",
        "Producción",
        "TH21M (#23399)",
        "Ampliar 40 mg",
        "En curso"
    ],
    [
        "Central de Pesadas",
        "Central de Pesadas",
        "pesadas",
        "Limpio",
        "-",
        "-",
        "-",
        "Sin asignar"
    ],
    [
        "Compresión I",
        "Compresión I",
        "compresion",
        "En proceso",
        "Producción",
        "01298 (#22801)",
        "Total Magnesiano",
        "En curso"
    ],
    [
        "Compresión II",
        "Compresión II",
        "compresion",
        "En proceso (en campaña)",
        "Producción",
        "UD79K (#23199)",
        "Urokit",
        "En curso"
    ],
    [
        "Compresión III",
        "Compresión III",
        "compresion",
        "En proceso (en campaña)",
        "Producción",
        "UD95K (#22428)",
        "Diclofenac Flex",
        "En curso"
    ],
    [
        "Compresión IV",
        "Compresión IV",
        "compresion",
        "En proceso (en campaña)",
        "Producción",
        "TZ79K (#23084)",
        "Diclofenac Gesic",
        "En curso"
    ],
    [
        "Compresión V",
        "Compresión V",
        "compresion",
        "En proceso (en campaña)",
        "Producción",
        "TM55K (#23335)",
        "Dilcoran 80 mg",
        "En curso"
    ],
    [
        "Compresión VI",
        "Compresión VI",
        "compresion",
        "En proceso (en campaña)",
        "Producción",
        "TR71K (#23195)",
        "Milcanor 500 mg",
        "En curso"
    ],
    [
        "Granulación I",
        "Granulación I",
        "granulacion",
        "En proceso (en campaña)",
        "Producción",
        "TM55M (#23313)",
        "Dilcoran 80 mg",
        "En curso"
    ],
    [
        "Granulación II",
        "Granulación II",
        "granulacion",
        "En proceso",
        "Producción",
        "TC26M (#23393)",
        "Dilcoran 160 mg",
        "En curso"
    ],
    [
        "Granulación III",
        "Granulación III",
        "granulacion",
        "Para limpiar",
        "-",
        "-",
        "-",
        "Sin asignar"
    ],
    [
        "Mezclado I",
        "Mezclado I",
        "granulacion",
        "Para limpiar",
        "Limpieza",
        "-",
        "-",
        "En curso"
    ],
    [
        "Mezclado II",
        "Mezclado II",
        "granulacion",
        "Para limpiar",
        "Limpieza",
        "-",
        "-",
        "Pendiente verificación final"
    ],
    [
        "Recubrimiento",
        "Recubrimiento",
        "recubrimiento",
        "Limpio",
        "-",
        "-",
        "-",
        "Sin asignar"
    ],
    [
        "Recubrimiento II",
        "Recubrimiento II",
        "recubrimiento",
        "Para limpiar",
        "-",
        "-",
        "-",
        "Sin asignar"
    ],
    [
        "Recubrimiento III",
        "Recubrimiento III",
        "recubrimiento",
        "En proceso (en campaña)",
        "Producción",
        "TM53P (#23340)",
        "Dilcoran 80 mg",
        "En curso"
    ],
    [
        "Secado I",
        "Secado I",
        "granulacion",
        "En proceso",
        "Producción",
        "TH20M (#23272)",
        "Ampliar 40 mg",
        "En curso"
    ],
    [
        "Secado II",
        "Secado II",
        "granulacion",
        "Limpio",
        "-",
        "-",
        "-",
        "Sin asignar"
    ],
    [
        "Secado III",
        "Secado III",
        "granulacion",
        "En proceso",
        "Producción",
        "ST36M (#22901)",
        "Montrate 10 mg",
        "En curso"
    ]
] as const satisfies readonly CapturedTableRow[];

export const eppiLogbookCapture: EppiCapturedPagination = {
    advertisedPageCount: 5918,
    visiblePageLabels: ['1', '2', '3', '4', '...', '5918'],
    pages: [
        createCapturedPage(1, 'ui-audit-structural/screens/005-bitacora.json', 'logbook-page-1', logbookColumns, logbookPageOneRows),
        createCapturedPage(2, 'ui-audit-structural/screens/044-bitacora-pagina-2.json', 'logbook-page-2', logbookColumns, logbookPageTwoRows),
    ],
    unavailableRanges: [{ from: 3, to: 5918 }],
};

export const eppiLocationsTable: EppiTableDefinition = createTableDefinition('locations', 'Locales', locationColumns, locationRows);
export const eppiLogbookTable: EppiTableDefinition = createTableDefinition('logbook-page-1', 'Bitácora', logbookColumns, logbookPageOneRows, { minWidth: 1050, pagination: eppiLogbookCapture });
export const eppiProcessesTable: EppiTableDefinition = createTableDefinition('processes', 'Procesos', processColumns, processRows, { minWidth: 1450 });
export const eppiProductionTable: EppiTableDefinition = createTableDefinition('production', 'Producción', productionColumns, productionRows, { minWidth: 1320 });
