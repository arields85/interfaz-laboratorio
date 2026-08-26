import type { EppiTableColumnDefinition, EppiTableDefinition } from '../../domain';
import { createCapturedPage, createTableDefinition, type CapturedTableRow } from './shared';
import type { EppiCapturedPagination } from '../../domain';

const orderColumns = [
    {
        "id": "order",
        "label": "Orden",
        "widthPercent": 8
    },
    {
        "id": "responsible",
        "label": "Responsable",
        "widthPercent": 16
    },
    {
        "id": "location",
        "label": "Ubicación",
        "widthPercent": 8
    },
    {
        "id": "client",
        "label": "Cliente",
        "widthPercent": 10
    },
    {
        "id": "product",
        "label": "Producto",
        "widthPercent": 19
    },
    {
        "id": "batch",
        "label": "Lote",
        "widthPercent": 9
    },
    {
        "id": "form",
        "label": "Forma Farmacéutica",
        "widthPercent": 14
    },
    {
        "id": "inProcess",
        "label": "En proceso",
        "widthPercent": 8
    },
    {
        "id": "verified",
        "label": "Verificada",
        "widthPercent": 8
    }
] as const satisfies readonly EppiTableColumnDefinition[];

// Provenance: mockup/src/data.ts; ui-audit-structural/screens/002-ordenes-de-produccion.json
export const orderPageOneRows = [
    [
        "23451",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Dilcoran D 160 / 12,5 Mg",
        "TN60S",
        "Suspensión",
        "No",
        ""
    ],
    [
        "23450",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Dilcoran D 160 / 12,5 Mg",
        "TN59S",
        "Suspensión",
        "No",
        ""
    ],
    [
        "23449",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Dilcoran D 160 / 12,5 Mg",
        "TN58S",
        "Suspensión",
        "No",
        ""
    ],
    [
        "23448",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Dilcoran D 160 / 12,5 Mg",
        "UA68S",
        "Suspensión",
        "No",
        ""
    ],
    [
        "23447",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Dilcoran D 160 / 12,5 Mg",
        "UA67S",
        "Suspensión",
        "No",
        ""
    ],
    [
        "23446",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Dilcoran D 160 / 12,5 Mg",
        "TN60M",
        "Granulado",
        "No",
        ""
    ],
    [
        "23445",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Dilcoran D 160 / 12,5 Mg",
        "TN59M",
        "Granulado",
        "No",
        ""
    ],
    [
        "23444",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Dilcoran D 160 / 12,5 Mg",
        "TN58M",
        "Granulado",
        "No",
        ""
    ],
    [
        "23443",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Dilcoran D 160 / 12,5 Mg",
        "UA68M",
        "Granulado",
        "No",
        ""
    ],
    [
        "23442",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Dilcoran D 160 / 12,5 Mg",
        "UA67M",
        "Granulado",
        "No",
        ""
    ],
    [
        "23441",
        "Victoria Del Rosario",
        "A 1",
        "Roemmers",
        "Procetina 20 mg",
        "00004",
        "Comprimido recubierto",
        "No",
        ""
    ],
    [
        "23440",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Montrate 10 mg",
        "SS35P",
        "Comprimido recubierto",
        "No",
        ""
    ],
    [
        "23439",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Montrate 10 mg",
        "SS35K",
        "Núcleo",
        "No",
        ""
    ],
    [
        "23438",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Montrate 10 mg",
        "SS34P",
        "Comprimido recubierto",
        "No",
        ""
    ],
    [
        "23437",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Montrate 10 mg",
        "SS34K",
        "Núcleo",
        "No",
        ""
    ],
    [
        "23436",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Sotil Met 50 / 1000",
        "UF33P",
        "Comprimido recubierto",
        "No",
        ""
    ],
    [
        "23435",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Sotil Met 50 / 1000",
        "UF33K",
        "Núcleo",
        "No",
        ""
    ],
    [
        "23434",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Diclofenac B12",
        "TN31P",
        "Comprimido recubierto",
        "No",
        ""
    ],
    [
        "23433",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Diclofenac B12",
        "TN31K",
        "Núcleo",
        "No",
        ""
    ],
    [
        "23432",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Diclofenac B12",
        "TA58P",
        "Comprimido recubierto",
        "No",
        ""
    ],
    [
        "23431",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Diclofenac B12",
        "TA58K",
        "Núcleo",
        "No",
        ""
    ],
    [
        "23430",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Ampliar 40 mg",
        "TH25P",
        "Comprimido recubierto",
        "No",
        ""
    ],
    [
        "23429",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Ampliar 40 mg",
        "TH25K",
        "Núcleo",
        "No",
        ""
    ],
    [
        "23428",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Ampliar 40 mg",
        "TH22P",
        "Comprimido recubierto",
        "No",
        ""
    ],
    [
        "23427",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Ampliar 40 mg",
        "TH22K",
        "Núcleo",
        "No",
        ""
    ],
    [
        "23426",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Ampliar 40 mg",
        "TH23P",
        "Comprimido recubierto",
        "No",
        ""
    ],
    [
        "23425",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Ampliar 40 mg",
        "TH23K",
        "Núcleo",
        "No",
        ""
    ],
    [
        "23424",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Ampliar 40 mg",
        "TH24P",
        "Comprimido recubierto",
        "No",
        ""
    ],
    [
        "23423",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Ampliar 40 mg",
        "TH24K",
        "Núcleo",
        "No",
        ""
    ],
    [
        "23422",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Polper B12 Forte",
        "TU41P",
        "Comprimido recubierto",
        "No",
        ""
    ],
    [
        "23421",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Polper B12 Forte",
        "TU41K",
        "Núcleo",
        "No",
        ""
    ],
    [
        "23420",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Polper B12 Forte",
        "TU40P",
        "Comprimido recubierto",
        "No",
        ""
    ],
    [
        "23419",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Polper B12 Forte",
        "TU40K",
        "Núcleo",
        "No",
        ""
    ],
    [
        "23418",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Polper B12 Forte",
        "TU39P",
        "Comprimido recubierto",
        "No",
        ""
    ],
    [
        "23417",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Polper B12 Forte",
        "TU39K",
        "Núcleo",
        "No",
        ""
    ],
    [
        "23416",
        "Victoria Del Rosario",
        "A 1",
        "Vannier",
        "Metronidazol Vannier 500 mg",
        "101124",
        "Comprimido",
        "No",
        ""
    ],
    [
        "23415",
        "Victoria Del Rosario",
        "A 1",
        "Vannier",
        "Metronidazol Vannier 500 mg",
        "101123",
        "Comprimido",
        "No",
        ""
    ],
    [
        "23414",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Loplac 50 mg",
        "TO46S",
        "Suspensión",
        "No",
        ""
    ],
    [
        "23413",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Loplac 50 mg",
        "TO47S",
        "Suspensión",
        "No",
        ""
    ],
    [
        "23412",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Loplac 50 mg",
        "TO46M",
        "Granulado",
        "No",
        ""
    ],
    [
        "23411",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Loplac 50 mg",
        "TO47M",
        "Granulado",
        "No",
        ""
    ],
    [
        "23410",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Diclofenac Gesic",
        "TZ78S",
        "Suspensión",
        "No",
        ""
    ],
    [
        "23409",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Diclofenac Gesic",
        "TZ77S",
        "Suspensión",
        "No",
        ""
    ],
    [
        "23408",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Diclofenac Gesic",
        "TZ76S",
        "Suspensión",
        "No",
        ""
    ],
    [
        "23407",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Diclofenac Gesic",
        "TZ78M",
        "Granulado",
        "No",
        ""
    ],
    [
        "23406",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Diclofenac Gesic",
        "TZ77M",
        "Granulado",
        "No",
        ""
    ],
    [
        "23405",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Diclofenac Gesic",
        "TZ76M",
        "Granulado",
        "No",
        ""
    ],
    [
        "23404",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Ampliar 40 mg",
        "TH23S",
        "Suspensión",
        "No",
        ""
    ],
    [
        "23403",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Ampliar 40 mg",
        "TH22S",
        "Suspensión",
        "No",
        ""
    ],
    [
        "23402",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Ampliar 40 mg",
        "TH21S",
        "Suspensión",
        "No",
        ""
    ]
] as const satisfies readonly CapturedTableRow[];

// Provenance: ui-audit-structural/screens/045-ordenes-pagina-2.json
export const orderPageTwoRows = [
    [
        "23401",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Ampliar 40 mg",
        "TH23M",
        "Granulado",
        "No",
        ""
    ],
    [
        "23400",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Ampliar 40 mg",
        "TH22M",
        "Granulado",
        "No",
        ""
    ],
    [
        "23399",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Ampliar 40 mg",
        "TH21M",
        "Granulado",
        "Sí",
        ""
    ],
    [
        "23398",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Dilcoran 160 mg",
        "TC29S",
        "Suspensión",
        "No",
        ""
    ],
    [
        "23397",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Dilcoran 160 mg",
        "TC28S",
        "Suspensión",
        "No",
        ""
    ],
    [
        "23396",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Dilcoran 160 mg",
        "TC26S",
        "Suspensión",
        "No",
        ""
    ],
    [
        "23395",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Dilcoran 160 mg",
        "TC27S",
        "Suspensión",
        "No",
        ""
    ],
    [
        "23394",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Dilcoran 160 mg",
        "TC37S",
        "Suspensión",
        "No",
        ""
    ],
    [
        "23393",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Dilcoran 160 mg",
        "TC26M",
        "Granulado",
        "Sí",
        ""
    ],
    [
        "23392",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Dilcoran 160 mg",
        "TC27M",
        "Granulado",
        "No",
        ""
    ],
    [
        "23391",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Dilcoran 160 mg",
        "TC28M",
        "Granulado",
        "No",
        ""
    ],
    [
        "23390",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Dilcoran 160 mg",
        "TC29M",
        "Granulado",
        "No",
        ""
    ],
    [
        "23389",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Dilcoran 160 mg",
        "TC37M",
        "Granulado",
        "No",
        ""
    ],
    [
        "23388",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Dilcoran D 80 / 12,5 Mg",
        "TN45S",
        "Suspensión",
        "No",
        ""
    ],
    [
        "23387",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Dilcoran D 80 / 12,5 Mg",
        "TN45M",
        "Granulado",
        "No",
        ""
    ],
    [
        "23386",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Dilcoran 320 mg",
        "TM40S",
        "Suspensión",
        "No",
        ""
    ],
    [
        "23385",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Dilcoran 320 mg",
        "TM40M",
        "Granulado",
        "No",
        ""
    ],
    [
        "23384",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Loplac 50 mg",
        "TO47P",
        "Comprimido recubierto",
        "No",
        ""
    ],
    [
        "23383",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Loplac 50 mg",
        "TO47K",
        "Núcleo",
        "No",
        ""
    ],
    [
        "23382",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Loplac 50 mg",
        "TO46P",
        "Comprimido recubierto",
        "No",
        ""
    ],
    [
        "23381",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Loplac 50 mg",
        "TO46K",
        "Núcleo",
        "No",
        ""
    ],
    [
        "23380",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Diclofenac Flex",
        "UP37P",
        "Comprimido recubierto",
        "No",
        ""
    ],
    [
        "23379",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Diclofenac Flex",
        "UP37K",
        "Núcleo",
        "No",
        ""
    ],
    [
        "23378",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Diclofenac Flex",
        "UP36P",
        "Comprimido recubierto",
        "No",
        ""
    ],
    [
        "23377",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Diclofenac Flex",
        "UP36K",
        "Núcleo",
        "No",
        ""
    ],
    [
        "23376",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Ampliar 40 mg",
        "TH21P",
        "Comprimido recubierto",
        "No",
        ""
    ],
    [
        "23375",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Ampliar 40 mg",
        "TH21K",
        "Núcleo",
        "No",
        ""
    ],
    [
        "23374",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Ampliar 10 mg",
        "UP06P",
        "Comprimido recubierto",
        "No",
        ""
    ],
    [
        "23373",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Ampliar 10 mg",
        "UP06K",
        "Núcleo",
        "No",
        ""
    ],
    [
        "23372",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Diclofenac Gesic",
        "TZ78P",
        "Comprimido recubierto",
        "No",
        ""
    ],
    [
        "23371",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Diclofenac Gesic",
        "TZ78K",
        "Núcleo",
        "No",
        ""
    ],
    [
        "23370",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Diclofenac Gesic",
        "TZ77P",
        "Comprimido recubierto",
        "No",
        ""
    ],
    [
        "23369",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Diclofenac Gesic",
        "TZ77K",
        "Núcleo",
        "No",
        ""
    ],
    [
        "23368",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Diclofenac Gesic",
        "TZ76P",
        "Comprimido recubierto",
        "No",
        ""
    ],
    [
        "23367",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Diclofenac Gesic",
        "TZ76K",
        "Comprimido",
        "No",
        ""
    ],
    [
        "23366",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Sotil Met 50 / 850",
        "TS40P",
        "Comprimido recubierto",
        "No",
        ""
    ],
    [
        "23365",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Sotil Met 50 / 850",
        "TS40K",
        "Comprimido",
        "No",
        ""
    ],
    [
        "23364",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Sotil Met 50 / 850",
        "TS39P",
        "Comprimido recubierto",
        "No",
        ""
    ],
    [
        "23363",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Sotil Met 50 / 850",
        "TS39K",
        "Comprimido",
        "No",
        ""
    ],
    [
        "23362",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Sotil Met 50 / 850",
        "TS38P",
        "Comprimido recubierto",
        "No",
        ""
    ],
    [
        "23361",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Sotil Met 50 / 850",
        "TS38K",
        "Comprimido",
        "No",
        ""
    ],
    [
        "23360",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Dilcoran 160 mg",
        "TC29P",
        "Comprimido recubierto",
        "No",
        ""
    ],
    [
        "23359",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Dilcoran 160 mg",
        "TC29K",
        "Comprimido",
        "No",
        ""
    ],
    [
        "23358",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Dilcoran 160 mg",
        "TC28P",
        "Comprimido recubierto",
        "No",
        ""
    ],
    [
        "23357",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Dilcoran 160 mg",
        "TC28K",
        "Comprimido",
        "No",
        ""
    ],
    [
        "23356",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Dilcoran 160 mg",
        "TC27P",
        "Comprimido recubierto",
        "No",
        ""
    ],
    [
        "23355",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Dilcoran 160 mg",
        "TC27K",
        "Comprimido",
        "No",
        ""
    ],
    [
        "23354",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Dilcoran 160 mg",
        "TC26P",
        "Comprimido recubierto",
        "No",
        ""
    ],
    [
        "23353",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Dilcoran 160 mg",
        "TC26K",
        "Núcleo",
        "No",
        ""
    ],
    [
        "23352",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Dilcoran 160 mg",
        "TC37P",
        "Comprimido recubierto",
        "No",
        ""
    ]
] as const satisfies readonly CapturedTableRow[];

export const eppiOrdersCapture: EppiCapturedPagination = {
    advertisedPageCount: 461,
    visiblePageLabels: ['1', '2', '3', '4', '...', '461'],
    pages: [
        createCapturedPage(1, 'ui-audit-structural/screens/002-ordenes-de-produccion.json', 'orders-page-1', orderColumns, orderPageOneRows),
        createCapturedPage(2, 'ui-audit-structural/screens/045-ordenes-pagina-2.json', 'orders-page-2', orderColumns, orderPageTwoRows),
    ],
    unavailableRanges: [{ from: 3, to: 461 }],
};

export const eppiOrdersTable: EppiTableDefinition = createTableDefinition(
    'orders-page-1',
    'Órdenes de producción',
    orderColumns,
    orderPageOneRows,
    { minWidth: 1120, pagination: eppiOrdersCapture },
);
