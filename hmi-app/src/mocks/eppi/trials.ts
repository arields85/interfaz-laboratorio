import type { EppiTableColumnDefinition, EppiTableDefinition } from '../../domain';
import { createCapturedPage, createTableDefinition, type CapturedTableRow } from './shared';
import type { EppiCapturedPagination } from '../../domain';

const pharmaTrialColumns = [
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
        "widthPercent": 9
    },
    {
        "id": "client",
        "label": "Cliente",
        "widthPercent": 11
    },
    {
        "id": "product",
        "label": "Producto",
        "widthPercent": 18
    },
    {
        "id": "batch",
        "label": "Lote",
        "widthPercent": 10
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
        "widthPercent": 6
    }
] as const satisfies readonly EppiTableColumnDefinition[];

// Provenance: ui-audit-structural/screens/011-ensayo-farmacotecnico.json
export const pharmaTrialPageOneRows = [
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
        "23340",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Dilcoran 80 mg",
        "TM53P",
        "Comprimido recubierto",
        "Sí",
        ""
    ],
    [
        "23339",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Dilcoran 80 mg",
        "TM53K",
        "Núcleo",
        "Sí",
        ""
    ],
    [
        "23335",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Dilcoran 80 mg",
        "TM55K",
        "Núcleo",
        "Sí",
        ""
    ],
    [
        "23337",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Dilcoran 80 mg",
        "TM54K",
        "Núcleo",
        "Sí",
        ""
    ],
    [
        "23312",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Dilcoran 80 mg",
        "TM54M",
        "Granulado",
        "Sí",
        ""
    ],
    [
        "23313",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Dilcoran 80 mg",
        "TM55M",
        "Granulado",
        "Sí",
        ""
    ],
    [
        "23308",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Dilcoran 80 mg",
        "TM53S",
        "Suspensión",
        "Sí",
        ""
    ],
    [
        "23307",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Dilcoran 80 mg",
        "TM53M",
        "Granulado",
        "Sí",
        ""
    ],
    [
        "23272",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Ampliar 40 mg",
        "TH20M",
        "Granulado",
        "Sí",
        ""
    ],
    [
        "23249",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Zoxx 100 mg",
        "RN14K",
        "Núcleo",
        "Sí",
        ""
    ],
    [
        "23233",
        "Victoria Del Rosario",
        "A 1",
        "Temis Lostaló",
        "Virilon max 5 mg",
        "1342",
        "Comprimido recubierto",
        "Sí",
        ""
    ],
    [
        "23231",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Factor A-G 200 mg",
        "TI49K",
        "Comprimido",
        "Sí",
        ""
    ],
    [
        "23232",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Factor A-G 200 mg",
        "TI48K",
        "Comprimido",
        "Sí",
        ""
    ],
    [
        "23207",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Sactan 80 mg",
        "UI99K",
        "Comprimido",
        "Sí",
        ""
    ],
    [
        "23202",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Urokit",
        "TB86K",
        "Comprimido",
        "Sí",
        ""
    ],
    [
        "23199",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Urokit",
        "UD79K",
        "Comprimido",
        "Sí",
        ""
    ],
    [
        "23197",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Milcanor 1000 mg",
        "TR77K",
        "Comprimido",
        "Sí",
        ""
    ],
    [
        "23196",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Milcanor 500 mg",
        "TR69K",
        "Comprimido",
        "Sí",
        ""
    ],
    [
        "23195",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Milcanor 500 mg",
        "TR71K",
        "Comprimido",
        "Sí",
        ""
    ],
    [
        "23194",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Sactan 80 mg",
        "UI99M",
        "Granulado",
        "Sí",
        ""
    ],
    [
        "23182",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Urokit",
        "TB86M",
        "Granulado",
        "Sí",
        ""
    ],
    [
        "23180",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Urokit",
        "UD79M",
        "Granulado",
        "Sí",
        ""
    ],
    [
        "23178",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Zoxx 100 mg",
        "RN14M",
        "Granulado",
        "Sí",
        ""
    ],
    [
        "23176",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Milcanor 500 mg",
        "TR71S",
        "Suspensión",
        "Sí",
        ""
    ],
    [
        "23177",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Milcanor 1000 mg",
        "TR77S",
        "Suspensión",
        "Sí",
        ""
    ],
    [
        "23175",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Milcanor 500 mg",
        "TR69S",
        "Suspensión",
        "Sí",
        ""
    ],
    [
        "23174",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Milcanor 1000 mg",
        "TR77M",
        "Granulado",
        "Sí",
        ""
    ],
    [
        "23172",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Milcanor 500 mg",
        "TR71M",
        "Granulado",
        "Sí",
        ""
    ],
    [
        "23171",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Diclofenac 75 mg",
        "SR56S",
        "Suspensión",
        "Sí",
        ""
    ],
    [
        "23155",
        "Sebastián Ignacio",
        "A 2",
        "Casasco",
        "Factor A-G 200 mg",
        "TI49M",
        "Granulado",
        "Sí",
        ""
    ],
    [
        "23154",
        "Sebastián Ignacio",
        "A 2",
        "Casasco",
        "Urokit",
        "TB75M",
        "Granulado",
        "Sí",
        ""
    ],
    [
        "23153",
        "Sebastián Ignacio",
        "A 1",
        "Casasco",
        "Factor A-G 200 mg",
        "TI48M",
        "Granulado",
        "Sí",
        ""
    ],
    [
        "23148",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Loplac 50 mg",
        "TN84S",
        "Suspensión",
        "Sí",
        ""
    ],
    [
        "23135",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Loplac 50 mg",
        "TN78M",
        "Granulado",
        "Sí",
        ""
    ],
    [
        "23136",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Loplac 50 mg",
        "TN78S",
        "Suspensión",
        "Sí",
        ""
    ],
    [
        "23137",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Loplac 50 mg",
        "TN79M",
        "Granulado",
        "Sí",
        ""
    ],
    [
        "23138",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Loplac 50 mg",
        "TN80M",
        "Granulado",
        "Sí",
        ""
    ],
    [
        "23139",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Loplac 50 mg",
        "TN81M",
        "Granulado",
        "Sí",
        ""
    ],
    [
        "23140",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Loplac 50 mg",
        "TN82M",
        "Granulado",
        "Sí",
        ""
    ],
    [
        "23142",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Loplac 50 mg",
        "TN84M",
        "Granulado",
        "Sí",
        ""
    ],
    [
        "23143",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Loplac 50 mg",
        "TN79S",
        "Suspensión",
        "Sí",
        ""
    ],
    [
        "23144",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Loplac 50 mg",
        "TN80S",
        "Suspensión",
        "Sí",
        ""
    ],
    [
        "23146",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Loplac 50 mg",
        "TN82S",
        "Suspensión",
        "Sí",
        ""
    ],
    [
        "23147",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Loplac 50 mg",
        "TN83S",
        "Suspensión",
        "Sí",
        ""
    ],
    [
        "23132",
        "Victoria Del Rosario",
        "A 1",
        "Fecofar",
        "Duflegrip",
        "194426",
        "Comprimido",
        "Sí",
        ""
    ],
    [
        "23133",
        "Victoria Del Rosario",
        "A 1",
        "Fecofar",
        "Duflegrip",
        "195426",
        "Comprimido",
        "Sí",
        ""
    ],
    [
        "23134",
        "Victoria Del Rosario",
        "A 1",
        "Fecofar",
        "Duflegrip",
        "196426",
        "Comprimido",
        "Sí",
        ""
    ],
    [
        "23131",
        "Victoria Del Rosario",
        "A 1",
        "Fecofar",
        "Duflegrip",
        "193426",
        "Comprimido",
        "Sí",
        ""
    ]
] as const satisfies readonly CapturedTableRow[];
// Provenance: ui-audit-structural/screens/048-ensayos-farmacotecnicos-pagina-2.json
export const pharmaTrialPageTwoRows = [
    [
        "23129",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Ampliar 80 mg",
        "TN47K",
        "Núcleo",
        "Sí",
        ""
    ],
    [
        "23125",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Ampliar 80 mg",
        "UA03K",
        "Núcleo",
        "Sí",
        ""
    ],
    [
        "23123",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Ampliar 80 mg",
        "TN48K",
        "Núcleo",
        "Sí",
        ""
    ],
    [
        "23121",
        "Victoria Del Rosario",
        "A 1",
        "Gezzi",
        "Loratadina Gezzi",
        "076006",
        "Comprimido",
        "Sí",
        ""
    ],
    [
        "23119",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Milcanor 500 mg",
        "TR71P",
        "Comprimido recubierto",
        "Sí",
        ""
    ],
    [
        "23117",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Ampliar 80 mg",
        "UA03S",
        "Suspensión",
        "Sí",
        ""
    ],
    [
        "23116",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Ampliar 80 mg",
        "TN49S",
        "Suspensión",
        "Sí",
        ""
    ],
    [
        "23115",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Ampliar 80 mg",
        "TN47S",
        "Suspensión",
        "Sí",
        ""
    ],
    [
        "23114",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Ampliar 80 mg",
        "TN48S",
        "Suspensión",
        "Sí",
        ""
    ],
    [
        "23113",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Ampliar 80 mg",
        "UA03M",
        "Granulado",
        "Sí",
        ""
    ],
    [
        "23104",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Loplac 50 mg",
        "TN79K",
        "Núcleo",
        "Sí",
        ""
    ],
    [
        "23102",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Loplac 50 mg",
        "TN78K",
        "Núcleo",
        "Sí",
        ""
    ],
    [
        "23100",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Alercas 120 mg",
        "SN63K",
        "Núcleo",
        "Sí",
        ""
    ],
    [
        "23091",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Diclofenac Gesic",
        "SL73P",
        "Comprimido recubierto",
        "Sí",
        ""
    ],
    [
        "23090",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Diclofenac Gesic",
        "SL73K",
        "Núcleo",
        "Sí",
        ""
    ],
    [
        "23089",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Diclofenac Gesic",
        "SL74P",
        "Comprimido recubierto",
        "Sí",
        ""
    ],
    [
        "23088",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Diclofenac Gesic",
        "SL74K",
        "Núcleo",
        "Sí",
        ""
    ],
    [
        "23086",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Diclofenac Gesic",
        "SL75K",
        "Núcleo",
        "Sí",
        ""
    ],
    [
        "23084",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Diclofenac Gesic",
        "TZ79K",
        "Núcleo",
        "Sí",
        ""
    ],
    [
        "23072",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Diclofenac 75 mg",
        "SR56K",
        "Núcleo",
        "Sí",
        ""
    ],
    [
        "23070",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Loplac 50 mg",
        "TN81K",
        "Núcleo",
        "Sí",
        ""
    ],
    [
        "23069",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Loplac 50 mg",
        "TN84P",
        "Comprimido recubierto",
        "Sí",
        ""
    ],
    [
        "23068",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Loplac 50 mg",
        "TN84K",
        "Núcleo",
        "Sí",
        ""
    ],
    [
        "23066",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Loplac 50 mg",
        "TN83K",
        "Núcleo",
        "Sí",
        ""
    ],
    [
        "23064",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Loplac 50 mg",
        "TN82K",
        "Núcleo",
        "Sí",
        ""
    ],
    [
        "23062",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Loplac 50 mg",
        "TN80K",
        "Núcleo",
        "Sí",
        ""
    ],
    [
        "23039",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Nedal 10 mg",
        "UA92S",
        "Suspensión",
        "Sí",
        ""
    ],
    [
        "23035",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Nedal 10 mg",
        "UA91S",
        "Suspensión",
        "Sí",
        ""
    ],
    [
        "23031",
        "Victoria Del Rosario",
        "",
        "Casasco",
        "Nedal 10 mg",
        "UA90S",
        "Suspensión",
        "Sí",
        ""
    ],
    [
        "23027",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Nedal 10 mg",
        "UA89K",
        "Núcleo",
        "Sí",
        ""
    ],
    [
        "23026",
        "Victoria Del Rosario",
        "",
        "Casasco",
        "Nedal 10 mg",
        "UA89S",
        "Suspensión",
        "Sí",
        ""
    ],
    [
        "23023",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Nedal 10 mg",
        "UA96S",
        "Suspensión",
        "Sí",
        ""
    ],
    [
        "23022",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Nedal 10 mg",
        "UA96K",
        "Núcleo",
        "Sí",
        ""
    ],
    [
        "23020",
        "Victoria Del Rosario",
        "A 1",
        "Géminis Farmacéutica",
        "Rosucol 20 mg",
        "1838",
        "Comprimido recubierto",
        "Sí",
        ""
    ],
    [
        "23019",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Hipolipol 10 mg",
        "TP25S",
        "Suspensión",
        "Sí",
        ""
    ],
    [
        "23011",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Hipolipol 10 mg",
        "TP24S",
        "Suspensión",
        "Sí",
        ""
    ],
    [
        "23010",
        "Victoria Del Rosario",
        "",
        "Casasco",
        "Hipolipol 10 mg",
        "TP24K",
        "Núcleo",
        "Sí",
        ""
    ],
    [
        "23007",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Hipolipol 10 mg",
        "TP25K",
        "Núcleo",
        "Sí",
        ""
    ],
    [
        "23004",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Hipolipol 10 mg",
        "TP26S",
        "Suspensión",
        "Sí",
        ""
    ],
    [
        "23003",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Hipolipol 10 mg",
        "TP26K",
        "Núcleo",
        "Sí",
        ""
    ],
    [
        "23000",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Hipolipol 10 mg",
        "TP28S",
        "Suspensión",
        "Sí",
        ""
    ],
    [
        "22999",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Hipolipol 10 mg",
        "TP28K",
        "Núcleo",
        "Sí",
        ""
    ],
    [
        "22996",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Hipolipol 10 mg",
        "TP23S",
        "Suspensión",
        "Sí",
        ""
    ],
    [
        "22995",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Hipolipol 10 mg",
        "TP23K",
        "Núcleo",
        "Sí",
        ""
    ],
    [
        "22994",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Hipolipol 10 mg",
        "TP29K",
        "Núcleo",
        "Sí",
        ""
    ],
    [
        "22991",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Hipolipol 10 mg",
        "TP29S",
        "Suspensión",
        "Sí",
        ""
    ],
    [
        "22990",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Diclofenac Gesic",
        "SL73M1",
        "Granulado",
        "Sí",
        ""
    ],
    [
        "22963",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Nirpol 10 mg",
        "UA38M",
        "Granulado",
        "Sí",
        ""
    ],
    [
        "22962",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Diclofenac Gesic",
        "SL73S",
        "Suspensión",
        "Sí",
        ""
    ],
    [
        "22955",
        "Victoria Del Rosario",
        "A 1",
        "Casasco",
        "Diclofenac Gesic",
        "SL75M1",
        "Granulado",
        "Sí",
        ""
    ]
] as const satisfies readonly CapturedTableRow[];

export const eppiPharmaTrialsCapture: EppiCapturedPagination = {
    advertisedPageCount: 81,
    visiblePageLabels: ['1', '2', '3', '4', '...', '81'],
    pages: [
        createCapturedPage(1, 'ui-audit-structural/screens/011-ensayo-farmacotecnico.json', 'pharma-trials-page-1', pharmaTrialColumns, pharmaTrialPageOneRows),
        createCapturedPage(2, 'ui-audit-structural/screens/048-ensayos-farmacotecnicos-pagina-2.json', 'pharma-trials-page-2', pharmaTrialColumns, pharmaTrialPageTwoRows),
    ],
    unavailableRanges: [{ from: 3, to: 81 }],
};

export const eppiPharmaTrialsTable: EppiTableDefinition = createTableDefinition('pharma-trials-page-1', 'Ensayos farmacotécnicos', pharmaTrialColumns, pharmaTrialPageOneRows, { minWidth: 1200, pagination: eppiPharmaTrialsCapture });
