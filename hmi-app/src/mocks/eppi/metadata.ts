import type { EppiTableColumnDefinition, EppiTableDefinition } from '../../domain';
import { createTableDefinition, type CapturedTableRow } from './shared';

// Provenance: ui-audit-structural/screens/012-estadisticas.json; ui-audit-structural/screens/032-estadisticas-producto-tab.json
export const eppiStatisticsCapture = {
    sourceArtifacts: ['ui-audit-structural/screens/012-estadisticas.json', 'ui-audit-structural/screens/032-estadisticas-producto-tab.json'],
    tabs: ['Lote', 'Producto'],
    searchLabel: 'Lote',
    searchPlaceholder: 'Buscar lote',
    disabledControls: ['Proceso: Sin asignar', 'Ensayo: Sin asignar'],
    tables: [],
} as const;

// Provenance: ui-audit-structural/screens/056-procesos-crear-proceso-op-y-proceso-productivo-abierto.json; ui-audit-structural/interactions.json
export const eppiProcessCreateCapture = {
    sourceArtifacts: ['ui-audit-structural/screens/056-procesos-crear-proceso-op-y-proceso-productivo-abierto.json', 'ui-audit-structural/interactions.json'],
    route: '/app/process/add',
    title: 'Crear proceso',
    typeValue: 'Producción',
    typeDisabled: true,
    defaultBox: 'Sin box',
    boxOptions: ['Sin box', 'Central de Pesadas (Central de Pesadas)', 'Granulación III (Granulación III)', 'Recubrimiento (Recubrimiento)', 'Recubrimiento II (Recubrimiento II)', 'Secado II (Secado II)'],
    pharmaceuticalFormLabel: 'Forma farmacéutica',
    searchLabel: 'OP y proceso productivo',
    searchPlaceholder: 'Buscar OP, producto o proceso',
    submitLabel: 'Crear proceso',
    submitDisabled: true,
    productionOrderAndProcessOptions: [
    [
        "Dilcoran D 160 / 12,5 Mg - Compresión de núcleos",
        "Lote UA68S"
    ],
    [
        "Dilcoran D 160 / 12,5 Mg - Granulacion",
        "Lote UA68S"
    ],
    [
        "Dilcoran D 160 / 12,5 Mg - Secado",
        "Lote UA68S"
    ],
    [
        "Dilcoran D 160 / 12,5 Mg - Mezclado",
        "Lote UA68S"
    ],
    [
        "Dilcoran D 160 / 12,5 Mg - Recubrimiento",
        "Lote UA68S"
    ],
    [
        "Dilcoran D 160 / 12,5 Mg - Compresión de núcleos",
        "Lote TN58S"
    ],
    [
        "Dilcoran D 160 / 12,5 Mg - Granulacion",
        "Lote TN58S"
    ],
    [
        "Dilcoran D 160 / 12,5 Mg - Secado",
        "Lote TN58S"
    ],
    [
        "Dilcoran D 160 / 12,5 Mg - Mezclado",
        "Lote TN58S"
    ],
    [
        "Dilcoran D 160 / 12,5 Mg - Recubrimiento",
        "Lote TN58S"
    ],
    [
        "Dilcoran D 160 / 12,5 Mg - Compresión de núcleos",
        "Lote TN59S"
    ],
    [
        "Dilcoran D 160 / 12,5 Mg - Granulacion",
        "Lote TN59S"
    ],
    [
        "Dilcoran D 160 / 12,5 Mg - Secado",
        "Lote TN59S"
    ],
    [
        "Dilcoran D 160 / 12,5 Mg - Mezclado",
        "Lote TN59S"
    ],
    [
        "Dilcoran D 160 / 12,5 Mg - Recubrimiento",
        "Lote TN59S"
    ],
    [
        "Dilcoran D 160 / 12,5 Mg - Compresión de núcleos",
        "Lote TN60S"
    ],
    [
        "Dilcoran D 160 / 12,5 Mg - Granulacion",
        "Lote TN60S"
    ],
    [
        "Dilcoran D 160 / 12,5 Mg - Secado",
        "Lote TN60S"
    ],
    [
        "Dilcoran D 160 / 12,5 Mg - Mezclado",
        "Lote TN60S"
    ],
    [
        "Dilcoran D 160 / 12,5 Mg - Recubrimiento",
        "Lote TN60S"
    ],
    [
        "Dilcoran D 160 / 12,5 Mg - Compresión de núcleos",
        "Lote UA67M"
    ],
    [
        "Dilcoran D 160 / 12,5 Mg - Granulacion",
        "Lote UA67M"
    ],
    [
        "Dilcoran D 160 / 12,5 Mg - Secado",
        "Lote UA67M"
    ],
    [
        "Dilcoran D 160 / 12,5 Mg - Mezclado",
        "Lote UA67M"
    ],
    [
        "Dilcoran D 160 / 12,5 Mg - Recubrimiento",
        "Lote UA67M"
    ],
    [
        "Dilcoran D 160 / 12,5 Mg - Compresión de núcleos",
        "Lote UA68M"
    ],
    [
        "Dilcoran D 160 / 12,5 Mg - Granulacion",
        "Lote UA68M"
    ],
    [
        "Dilcoran D 160 / 12,5 Mg - Secado",
        "Lote UA68M"
    ],
    [
        "Dilcoran D 160 / 12,5 Mg - Mezclado",
        "Lote UA68M"
    ],
    [
        "Dilcoran D 160 / 12,5 Mg - Recubrimiento",
        "Lote UA68M"
    ],
    [
        "Dilcoran D 160 / 12,5 Mg - Compresión de núcleos",
        "Lote TN58M"
    ],
    [
        "Dilcoran D 160 / 12,5 Mg - Granulacion",
        "Lote TN58M"
    ],
    [
        "Dilcoran D 160 / 12,5 Mg - Secado",
        "Lote TN58M"
    ],
    [
        "Dilcoran D 160 / 12,5 Mg - Mezclado",
        "Lote TN58M"
    ],
    [
        "Dilcoran D 160 / 12,5 Mg - Recubrimiento",
        "Lote TN58M"
    ],
    [
        "Dilcoran D 160 / 12,5 Mg - Compresión de núcleos",
        "Lote TN59M"
    ],
    [
        "Dilcoran D 160 / 12,5 Mg - Granulacion",
        "Lote TN59M"
    ],
    [
        "Dilcoran D 160 / 12,5 Mg - Secado",
        "Lote TN59M"
    ],
    [
        "Dilcoran D 160 / 12,5 Mg - Mezclado",
        "Lote TN59M"
    ],
    [
        "Dilcoran D 160 / 12,5 Mg - Recubrimiento",
        "Lote TN59M"
    ],
    [
        "Dilcoran D 160 / 12,5 Mg - Compresión de núcleos",
        "Lote TN60M"
    ],
    [
        "Dilcoran D 160 / 12,5 Mg - Granulacion",
        "Lote TN60M"
    ],
    [
        "Dilcoran D 160 / 12,5 Mg - Secado",
        "Lote TN60M"
    ],
    [
        "Dilcoran D 160 / 12,5 Mg - Mezclado",
        "Lote TN60M"
    ],
    [
        "Dilcoran D 160 / 12,5 Mg - Recubrimiento",
        "Lote TN60M"
    ],
    [
        "Dilcoran D 160 / 12,5 Mg - Compresión de núcleos",
        "Lote UA67S"
    ],
    [
        "Dilcoran D 160 / 12,5 Mg - Granulacion",
        "Lote UA67S"
    ],
    [
        "Dilcoran D 160 / 12,5 Mg - Secado",
        "Lote UA67S"
    ],
    [
        "Dilcoran D 160 / 12,5 Mg - Mezclado",
        "Lote UA67S"
    ],
    [
        "Dilcoran D 160 / 12,5 Mg - Recubrimiento",
        "Lote UA67S"
    ],
    [
        "Procetina 20 mg - Granulación",
        "Lote 00004"
    ],
    [
        "Procetina 20 mg - Secado",
        "Lote 00004"
    ],
    [
        "Procetina 20 mg - Compresión",
        "Lote 00004"
    ],
    [
        "Procetina 20 mg - Paila #1",
        "Lote 00004"
    ],
    [
        "Procetina 20 mg - Paila #2",
        "Lote 00004"
    ],
    [
        "Montrate 10 mg - Compresión de núcleos",
        "Lote SS34K"
    ],
    [
        "Montrate 10 mg - Recubrimiento",
        "Lote SS34K"
    ],
    [
        "Montrate 10 mg - Granulacion",
        "Lote SS34K"
    ],
    [
        "Montrate 10 mg - Secado",
        "Lote SS34K"
    ],
    [
        "Montrate 10 mg - Mezclado",
        "Lote SS34K"
    ],
    [
        "Montrate 10 mg - Compresión de núcleos",
        "Lote SS34P"
    ],
    [
        "Montrate 10 mg - Recubrimiento",
        "Lote SS34P"
    ],
    [
        "Montrate 10 mg - Granulacion",
        "Lote SS34P"
    ],
    [
        "Montrate 10 mg - Secado",
        "Lote SS34P"
    ],
    [
        "Montrate 10 mg - Mezclado",
        "Lote SS34P"
    ],
    [
        "Montrate 10 mg - Compresión de núcleos",
        "Lote SS35K"
    ],
    [
        "Montrate 10 mg - Recubrimiento",
        "Lote SS35K"
    ],
    [
        "Montrate 10 mg - Granulacion",
        "Lote SS35K"
    ],
    [
        "Montrate 10 mg - Secado",
        "Lote SS35K"
    ],
    [
        "Montrate 10 mg - Mezclado",
        "Lote SS35K"
    ],
    [
        "Montrate 10 mg - Compresión de núcleos",
        "Lote SS35P"
    ],
    [
        "Montrate 10 mg - Recubrimiento",
        "Lote SS35P"
    ],
    [
        "Montrate 10 mg - Granulacion",
        "Lote SS35P"
    ],
    [
        "Montrate 10 mg - Secado",
        "Lote SS35P"
    ],
    [
        "Montrate 10 mg - Mezclado",
        "Lote SS35P"
    ],
    [
        "Sotil Met 50 / 1000 - Compresión de núcleos",
        "Lote UF33K"
    ],
    [
        "Sotil Met 50 / 1000 - Granulacion",
        "Lote UF33K"
    ],
    [
        "Sotil Met 50 / 1000 - Secado",
        "Lote UF33K"
    ],
    [
        "Sotil Met 50 / 1000 - Mezclado",
        "Lote UF33K"
    ],
    [
        "Sotil Met 50 / 1000 - Recubrimiento",
        "Lote UF33K"
    ],
    [
        "Sotil Met 50 / 1000 - Compresión de núcleos",
        "Lote UF33P"
    ],
    [
        "Sotil Met 50 / 1000 - Granulacion",
        "Lote UF33P"
    ],
    [
        "Sotil Met 50 / 1000 - Secado",
        "Lote UF33P"
    ],
    [
        "Sotil Met 50 / 1000 - Mezclado",
        "Lote UF33P"
    ],
    [
        "Sotil Met 50 / 1000 - Recubrimiento",
        "Lote UF33P"
    ],
    [
        "Diclofenac B12 - Compresión de núcleos",
        "Lote TA58K"
    ],
    [
        "Diclofenac B12 - Granulacion",
        "Lote TA58K"
    ],
    [
        "Diclofenac B12 - Secado",
        "Lote TA58K"
    ],
    [
        "Diclofenac B12 - Mezclado",
        "Lote TA58K"
    ],
    [
        "Diclofenac B12 - Recubrimiento",
        "Lote TA58K"
    ],
    [
        "Diclofenac B12 - Compresión de núcleos",
        "Lote TA58P"
    ],
    [
        "Diclofenac B12 - Granulacion",
        "Lote TA58P"
    ],
    [
        "Diclofenac B12 - Secado",
        "Lote TA58P"
    ],
    [
        "Diclofenac B12 - Mezclado",
        "Lote TA58P"
    ],
    [
        "Diclofenac B12 - Recubrimiento",
        "Lote TA58P"
    ],
    [
        "Diclofenac B12 - Compresión de núcleos",
        "Lote TN31K"
    ],
    [
        "Diclofenac B12 - Granulacion",
        "Lote TN31K"
    ],
    [
        "Diclofenac B12 - Secado",
        "Lote TN31K"
    ],
    [
        "Diclofenac B12 - Mezclado",
        "Lote TN31K"
    ],
    [
        "Diclofenac B12 - Recubrimiento",
        "Lote TN31K"
    ],
    [
        "Diclofenac B12 - Compresión de núcleos",
        "Lote TN31P"
    ],
    [
        "Diclofenac B12 - Granulacion",
        "Lote TN31P"
    ],
    [
        "Diclofenac B12 - Secado",
        "Lote TN31P"
    ],
    [
        "Diclofenac B12 - Mezclado",
        "Lote TN31P"
    ],
    [
        "Diclofenac B12 - Recubrimiento",
        "Lote TN31P"
    ],
    [
        "Ampliar 40 mg - Compresión de núcleos",
        "Lote TH24K"
    ],
    [
        "Ampliar 40 mg - Paila 1",
        "Lote TH24K"
    ],
    [
        "Ampliar 40 mg - Granulacion",
        "Lote TH24K"
    ],
    [
        "Ampliar 40 mg - Secado",
        "Lote TH24K"
    ],
    [
        "Ampliar 40 mg - Mezclado",
        "Lote TH24K"
    ],
    [
        "Ampliar 40 mg - Compresión de núcleos",
        "Lote TH24P"
    ],
    [
        "Ampliar 40 mg - Paila 1",
        "Lote TH24P"
    ],
    [
        "Ampliar 40 mg - Granulacion",
        "Lote TH24P"
    ],
    [
        "Ampliar 40 mg - Secado",
        "Lote TH24P"
    ],
    [
        "Ampliar 40 mg - Mezclado",
        "Lote TH24P"
    ],
    [
        "Ampliar 40 mg - Compresión de núcleos",
        "Lote TH23K"
    ],
    [
        "Ampliar 40 mg - Paila 1",
        "Lote TH23K"
    ],
    [
        "Ampliar 40 mg - Granulacion",
        "Lote TH23K"
    ],
    [
        "Ampliar 40 mg - Secado",
        "Lote TH23K"
    ],
    [
        "Ampliar 40 mg - Mezclado",
        "Lote TH23K"
    ],
    [
        "Ampliar 40 mg - Compresión de núcleos",
        "Lote TH23P"
    ],
    [
        "Ampliar 40 mg - Paila 1",
        "Lote TH23P"
    ],
    [
        "Ampliar 40 mg - Granulacion",
        "Lote TH23P"
    ],
    [
        "Ampliar 40 mg - Secado",
        "Lote TH23P"
    ],
    [
        "Ampliar 40 mg - Mezclado",
        "Lote TH23P"
    ],
    [
        "Ampliar 40 mg - Compresión de núcleos",
        "Lote TH22K"
    ],
    [
        "Ampliar 40 mg - Paila 1",
        "Lote TH22K"
    ],
    [
        "Ampliar 40 mg - Granulacion",
        "Lote TH22K"
    ],
    [
        "Ampliar 40 mg - Secado",
        "Lote TH22K"
    ],
    [
        "Ampliar 40 mg - Mezclado",
        "Lote TH22K"
    ],
    [
        "Ampliar 40 mg - Compresión de núcleos",
        "Lote TH22P"
    ],
    [
        "Ampliar 40 mg - Paila 1",
        "Lote TH22P"
    ],
    [
        "Ampliar 40 mg - Granulacion",
        "Lote TH22P"
    ],
    [
        "Ampliar 40 mg - Secado",
        "Lote TH22P"
    ],
    [
        "Ampliar 40 mg - Mezclado",
        "Lote TH22P"
    ],
    [
        "Ampliar 40 mg - Compresión de núcleos",
        "Lote TH25K"
    ],
    [
        "Ampliar 40 mg - Paila 1",
        "Lote TH25K"
    ],
    [
        "Ampliar 40 mg - Granulacion",
        "Lote TH25K"
    ],
    [
        "Ampliar 40 mg - Secado",
        "Lote TH25K"
    ],
    [
        "Ampliar 40 mg - Mezclado",
        "Lote TH25K"
    ],
    [
        "Ampliar 40 mg - Compresión de núcleos",
        "Lote TH25P"
    ],
    [
        "Ampliar 40 mg - Paila 1",
        "Lote TH25P"
    ],
    [
        "Ampliar 40 mg - Granulacion",
        "Lote TH25P"
    ],
    [
        "Ampliar 40 mg - Secado",
        "Lote TH25P"
    ],
    [
        "Ampliar 40 mg - Mezclado",
        "Lote TH25P"
    ],
    [
        "Polper B12 Forte - Compresión de núcleos",
        "Lote TU39K"
    ],
    [
        "Polper B12 Forte - Granulacion",
        "Lote TU39K"
    ],
    [
        "Polper B12 Forte - Secado",
        "Lote TU39K"
    ],
    [
        "Polper B12 Forte - Mezclado",
        "Lote TU39K"
    ],
    [
        "Polper B12 Forte - Recubrimiento",
        "Lote TU39K"
    ],
    [
        "Polper B12 Forte - Compresión de núcleos",
        "Lote TU39P"
    ],
    [
        "Polper B12 Forte - Granulacion",
        "Lote TU39P"
    ],
    [
        "Polper B12 Forte - Secado",
        "Lote TU39P"
    ],
    [
        "Polper B12 Forte - Mezclado",
        "Lote TU39P"
    ],
    [
        "Polper B12 Forte - Recubrimiento",
        "Lote TU39P"
    ],
    [
        "Polper B12 Forte - Compresión de núcleos",
        "Lote TU40K"
    ],
    [
        "Polper B12 Forte - Granulacion",
        "Lote TU40K"
    ],
    [
        "Polper B12 Forte - Secado",
        "Lote TU40K"
    ],
    [
        "Polper B12 Forte - Mezclado",
        "Lote TU40K"
    ],
    [
        "Polper B12 Forte - Recubrimiento",
        "Lote TU40K"
    ],
    [
        "Polper B12 Forte - Compresión de núcleos",
        "Lote TU40P"
    ],
    [
        "Polper B12 Forte - Granulacion",
        "Lote TU40P"
    ],
    [
        "Polper B12 Forte - Secado",
        "Lote TU40P"
    ],
    [
        "Polper B12 Forte - Mezclado",
        "Lote TU40P"
    ],
    [
        "Polper B12 Forte - Recubrimiento",
        "Lote TU40P"
    ],
    [
        "Polper B12 Forte - Compresión de núcleos",
        "Lote TU41K"
    ],
    [
        "Polper B12 Forte - Granulacion",
        "Lote TU41K"
    ],
    [
        "Polper B12 Forte - Secado",
        "Lote TU41K"
    ],
    [
        "Polper B12 Forte - Mezclado",
        "Lote TU41K"
    ],
    [
        "Polper B12 Forte - Recubrimiento",
        "Lote TU41K"
    ],
    [
        "Polper B12 Forte - Compresión de núcleos",
        "Lote TU41P"
    ],
    [
        "Polper B12 Forte - Granulacion",
        "Lote TU41P"
    ],
    [
        "Polper B12 Forte - Secado",
        "Lote TU41P"
    ],
    [
        "Polper B12 Forte - Mezclado",
        "Lote TU41P"
    ],
    [
        "Polper B12 Forte - Recubrimiento",
        "Lote TU41P"
    ],
    [
        "Metronidazol Vannier 500 mg - Compresión",
        "Lote 101123"
    ],
    [
        "Metronidazol Vannier 500 mg - Granulacion",
        "Lote 101123"
    ],
    [
        "Metronidazol Vannier 500 mg - Mezclado",
        "Lote 101123"
    ],
    [
        "Metronidazol Vannier 500 mg - Compresión",
        "Lote 101124"
    ],
    [
        "Metronidazol Vannier 500 mg - Granulacion",
        "Lote 101124"
    ],
    [
        "Metronidazol Vannier 500 mg - Mezclado",
        "Lote 101124"
    ],
    [
        "Loplac 50 mg - Compresión de núcleos",
        "Lote TO47S"
    ],
    [
        "Loplac 50 mg - Paila 1",
        "Lote TO47S"
    ],
    [
        "Loplac 50 mg - Paila 2",
        "Lote TO47S"
    ],
    [
        "Loplac 50 mg - Paila 3",
        "Lote TO47S"
    ],
    [
        "Loplac 50 mg - Paila 4",
        "Lote TO47S"
    ],
    [
        "Loplac 50 mg - Mezclado",
        "Lote TO47S"
    ],
    [
        "Loplac 50 mg - Granulacion",
        "Lote TO47S"
    ],
    [
        "Loplac 50 mg - Secado",
        "Lote TO47S"
    ],
    [
        "Loplac 50 mg - Compresión de núcleos",
        "Lote TO46S"
    ],
    [
        "Loplac 50 mg - Paila 1",
        "Lote TO46S"
    ],
    [
        "Loplac 50 mg - Paila 2",
        "Lote TO46S"
    ],
    [
        "Loplac 50 mg - Paila 3",
        "Lote TO46S"
    ],
    [
        "Loplac 50 mg - Paila 4",
        "Lote TO46S"
    ],
    [
        "Loplac 50 mg - Mezclado",
        "Lote TO46S"
    ],
    [
        "Loplac 50 mg - Granulacion",
        "Lote TO46S"
    ],
    [
        "Loplac 50 mg - Secado",
        "Lote TO46S"
    ],
    [
        "Loplac 50 mg - Compresión de núcleos",
        "Lote TO47M"
    ],
    [
        "Loplac 50 mg - Paila 1",
        "Lote TO47M"
    ],
    [
        "Loplac 50 mg - Paila 2",
        "Lote TO47M"
    ],
    [
        "Loplac 50 mg - Paila 3",
        "Lote TO47M"
    ],
    [
        "Loplac 50 mg - Paila 4",
        "Lote TO47M"
    ],
    [
        "Loplac 50 mg - Mezclado",
        "Lote TO47M"
    ],
    [
        "Loplac 50 mg - Granulacion",
        "Lote TO47M"
    ],
    [
        "Loplac 50 mg - Secado",
        "Lote TO47M"
    ],
    [
        "Loplac 50 mg - Compresión de núcleos",
        "Lote TO46M"
    ],
    [
        "Loplac 50 mg - Paila 1",
        "Lote TO46M"
    ],
    [
        "Loplac 50 mg - Paila 2",
        "Lote TO46M"
    ],
    [
        "Loplac 50 mg - Paila 3",
        "Lote TO46M"
    ],
    [
        "Loplac 50 mg - Paila 4",
        "Lote TO46M"
    ],
    [
        "Loplac 50 mg - Mezclado",
        "Lote TO46M"
    ],
    [
        "Loplac 50 mg - Granulacion",
        "Lote TO46M"
    ],
    [
        "Loplac 50 mg - Secado",
        "Lote TO46M"
    ],
    [
        "Diclofenac Gesic - Compresión",
        "Lote TZ76S"
    ],
    [
        "Diclofenac Gesic - Paila 1",
        "Lote TZ76S"
    ],
    [
        "Diclofenac Gesic - Granulacion",
        "Lote TZ76S"
    ],
    [
        "Diclofenac Gesic - Mezclado",
        "Lote TZ76S"
    ],
    [
        "Diclofenac Gesic - Compresión",
        "Lote TZ77S"
    ],
    [
        "Diclofenac Gesic - Paila 1",
        "Lote TZ77S"
    ],
    [
        "Diclofenac Gesic - Granulacion",
        "Lote TZ77S"
    ],
    [
        "Diclofenac Gesic - Mezclado",
        "Lote TZ77S"
    ],
    [
        "Diclofenac Gesic - Compresión",
        "Lote TZ78S"
    ],
    [
        "Diclofenac Gesic - Paila 1",
        "Lote TZ78S"
    ],
    [
        "Diclofenac Gesic - Granulacion",
        "Lote TZ78S"
    ],
    [
        "Diclofenac Gesic - Mezclado",
        "Lote TZ78S"
    ],
    [
        "Diclofenac Gesic - Compresión",
        "Lote TZ76M"
    ],
    [
        "Diclofenac Gesic - Paila 1",
        "Lote TZ76M"
    ],
    [
        "Diclofenac Gesic - Granulacion",
        "Lote TZ76M"
    ],
    [
        "Diclofenac Gesic - Mezclado",
        "Lote TZ76M"
    ],
    [
        "Diclofenac Gesic - Compresión",
        "Lote TZ77M"
    ],
    [
        "Diclofenac Gesic - Paila 1",
        "Lote TZ77M"
    ],
    [
        "Diclofenac Gesic - Granulacion",
        "Lote TZ77M"
    ],
    [
        "Diclofenac Gesic - Mezclado",
        "Lote TZ77M"
    ],
    [
        "Diclofenac Gesic - Compresión",
        "Lote TZ78M"
    ],
    [
        "Diclofenac Gesic - Paila 1",
        "Lote TZ78M"
    ],
    [
        "Diclofenac Gesic - Granulacion",
        "Lote TZ78M"
    ],
    [
        "Diclofenac Gesic - Mezclado",
        "Lote TZ78M"
    ],
    [
        "Ampliar 40 mg - Compresión de núcleos",
        "Lote TH21S"
    ],
    [
        "Ampliar 40 mg - Paila 1",
        "Lote TH21S"
    ],
    [
        "Ampliar 40 mg - Granulacion",
        "Lote TH21S"
    ],
    [
        "Ampliar 40 mg - Secado",
        "Lote TH21S"
    ],
    [
        "Ampliar 40 mg - Mezclado",
        "Lote TH21S"
    ],
    [
        "Ampliar 40 mg - Compresión de núcleos",
        "Lote TH22S"
    ],
    [
        "Ampliar 40 mg - Paila 1",
        "Lote TH22S"
    ],
    [
        "Ampliar 40 mg - Granulacion",
        "Lote TH22S"
    ],
    [
        "Ampliar 40 mg - Secado",
        "Lote TH22S"
    ],
    [
        "Ampliar 40 mg - Mezclado",
        "Lote TH22S"
    ],
    [
        "Ampliar 40 mg - Compresión de núcleos",
        "Lote TH23S"
    ],
    [
        "Ampliar 40 mg - Paila 1",
        "Lote TH23S"
    ],
    [
        "Ampliar 40 mg - Granulacion",
        "Lote TH23S"
    ],
    [
        "Ampliar 40 mg - Secado",
        "Lote TH23S"
    ],
    [
        "Ampliar 40 mg - Mezclado",
        "Lote TH23S"
    ],
    [
        "Ampliar 40 mg - Compresión de núcleos",
        "Lote TH21M"
    ],
    [
        "Ampliar 40 mg - Paila 1",
        "Lote TH21M"
    ],
    [
        "Ampliar 40 mg - Granulacion",
        "Lote TH21M - Ya usado en Calibración y Mezclado III"
    ],
    [
        "Ampliar 40 mg - Secado",
        "Lote TH21M"
    ],
    [
        "Ampliar 40 mg - Mezclado",
        "Lote TH21M"
    ],
    [
        "Ampliar 40 mg - Compresión de núcleos",
        "Lote TH22M"
    ],
    [
        "Ampliar 40 mg - Paila 1",
        "Lote TH22M"
    ],
    [
        "Ampliar 40 mg - Granulacion",
        "Lote TH22M"
    ],
    [
        "Ampliar 40 mg - Secado",
        "Lote TH22M"
    ],
    [
        "Ampliar 40 mg - Mezclado",
        "Lote TH22M"
    ],
    [
        "Ampliar 40 mg - Compresión de núcleos",
        "Lote TH23M"
    ],
    [
        "Ampliar 40 mg - Paila 1",
        "Lote TH23M"
    ],
    [
        "Ampliar 40 mg - Granulacion",
        "Lote TH23M"
    ],
    [
        "Ampliar 40 mg - Secado",
        "Lote TH23M"
    ],
    [
        "Ampliar 40 mg - Mezclado",
        "Lote TH23M"
    ],
    [
        "Dilcoran 160 mg - Compresión de núcleos",
        "Lote TC37S"
    ],
    [
        "Dilcoran 160 mg - Granulacion",
        "Lote TC37S"
    ],
    [
        "Dilcoran 160 mg - Secado",
        "Lote TC37S"
    ],
    [
        "Dilcoran 160 mg - Mezclado",
        "Lote TC37S"
    ],
    [
        "Dilcoran 160 mg - Recubrimiento",
        "Lote TC37S"
    ],
    [
        "Dilcoran 160 mg - Compresión de núcleos",
        "Lote TC27S"
    ],
    [
        "Dilcoran 160 mg - Granulacion",
        "Lote TC27S"
    ],
    [
        "Dilcoran 160 mg - Secado",
        "Lote TC27S"
    ],
    [
        "Dilcoran 160 mg - Mezclado",
        "Lote TC27S"
    ],
    [
        "Dilcoran 160 mg - Recubrimiento",
        "Lote TC27S"
    ],
    [
        "Dilcoran 160 mg - Compresión de núcleos",
        "Lote TC26S"
    ],
    [
        "Dilcoran 160 mg - Granulacion",
        "Lote TC26S"
    ],
    [
        "Dilcoran 160 mg - Secado",
        "Lote TC26S"
    ],
    [
        "Dilcoran 160 mg - Mezclado",
        "Lote TC26S"
    ],
    [
        "Dilcoran 160 mg - Recubrimiento",
        "Lote TC26S"
    ],
    [
        "Dilcoran 160 mg - Compresión de núcleos",
        "Lote TC28S"
    ],
    [
        "Dilcoran 160 mg - Granulacion",
        "Lote TC28S"
    ],
    [
        "Dilcoran 160 mg - Secado",
        "Lote TC28S"
    ],
    [
        "Dilcoran 160 mg - Mezclado",
        "Lote TC28S"
    ],
    [
        "Dilcoran 160 mg - Recubrimiento",
        "Lote TC28S"
    ],
    [
        "Dilcoran 160 mg - Compresión de núcleos",
        "Lote TC29S"
    ],
    [
        "Dilcoran 160 mg - Granulacion",
        "Lote TC29S"
    ],
    [
        "Dilcoran 160 mg - Secado",
        "Lote TC29S"
    ],
    [
        "Dilcoran 160 mg - Mezclado",
        "Lote TC29S"
    ],
    [
        "Dilcoran 160 mg - Recubrimiento",
        "Lote TC29S"
    ],
    [
        "Dilcoran 160 mg - Compresión de núcleos",
        "Lote TC26M"
    ],
    [
        "Dilcoran 160 mg - Granulacion",
        "Lote TC26M - Ya usado en Granulación II"
    ],
    [
        "Dilcoran 160 mg - Secado",
        "Lote TC26M"
    ],
    [
        "Dilcoran 160 mg - Mezclado",
        "Lote TC26M"
    ],
    [
        "Dilcoran 160 mg - Recubrimiento",
        "Lote TC26M"
    ],
    [
        "Dilcoran 160 mg - Compresión de núcleos",
        "Lote TC37M"
    ],
    [
        "Dilcoran 160 mg - Granulacion",
        "Lote TC37M"
    ],
    [
        "Dilcoran 160 mg - Secado",
        "Lote TC37M"
    ],
    [
        "Dilcoran 160 mg - Mezclado",
        "Lote TC37M"
    ],
    [
        "Dilcoran 160 mg - Recubrimiento",
        "Lote TC37M"
    ],
    [
        "Dilcoran 160 mg - Compresión de núcleos",
        "Lote TC29M"
    ],
    [
        "Dilcoran 160 mg - Granulacion",
        "Lote TC29M"
    ],
    [
        "Dilcoran 160 mg - Secado",
        "Lote TC29M"
    ],
    [
        "Dilcoran 160 mg - Mezclado",
        "Lote TC29M"
    ],
    [
        "Dilcoran 160 mg - Recubrimiento",
        "Lote TC29M"
    ],
    [
        "Dilcoran 160 mg - Compresión de núcleos",
        "Lote TC28M"
    ],
    [
        "Dilcoran 160 mg - Granulacion",
        "Lote TC28M"
    ],
    [
        "Dilcoran 160 mg - Secado",
        "Lote TC28M"
    ],
    [
        "Dilcoran 160 mg - Mezclado",
        "Lote TC28M"
    ],
    [
        "Dilcoran 160 mg - Recubrimiento",
        "Lote TC28M"
    ],
    [
        "Dilcoran 160 mg - Compresión de núcleos",
        "Lote TC27M"
    ],
    [
        "Dilcoran 160 mg - Granulacion",
        "Lote TC27M"
    ],
    [
        "Dilcoran 160 mg - Secado",
        "Lote TC27M"
    ],
    [
        "Dilcoran 160 mg - Mezclado",
        "Lote TC27M"
    ],
    [
        "Dilcoran 160 mg - Recubrimiento",
        "Lote TC27M"
    ],
    [
        "Dilcoran D 80 / 12,5 Mg - Compresión de núcleos",
        "Lote TN45S"
    ],
    [
        "Dilcoran D 80 / 12,5 Mg - Recubrimiento",
        "Lote TN45S"
    ],
    [
        "Dilcoran D 80 / 12,5 Mg - Granulacion",
        "Lote TN45S"
    ],
    [
        "Dilcoran D 80 / 12,5 Mg - Secado",
        "Lote TN45S"
    ],
    [
        "Dilcoran D 80 / 12,5 Mg - Mezclado",
        "Lote TN45S"
    ],
    [
        "Dilcoran D 80 / 12,5 Mg - Compresión de núcleos",
        "Lote TN45M"
    ],
    [
        "Dilcoran D 80 / 12,5 Mg - Recubrimiento",
        "Lote TN45M"
    ],
    [
        "Dilcoran D 80 / 12,5 Mg - Granulacion",
        "Lote TN45M"
    ],
    [
        "Dilcoran D 80 / 12,5 Mg - Secado",
        "Lote TN45M"
    ],
    [
        "Dilcoran D 80 / 12,5 Mg - Mezclado",
        "Lote TN45M"
    ],
    [
        "Dilcoran 320 mg - Compresión de núcleos",
        "Lote TM40S"
    ],
    [
        "Dilcoran 320 mg - Granulacion",
        "Lote TM40S"
    ],
    [
        "Dilcoran 320 mg - Secado",
        "Lote TM40S"
    ],
    [
        "Dilcoran 320 mg - Mezclado",
        "Lote TM40S"
    ],
    [
        "Dilcoran 320 mg - Compresión de núcleos",
        "Lote TM40M"
    ],
    [
        "Dilcoran 320 mg - Granulacion",
        "Lote TM40M"
    ],
    [
        "Dilcoran 320 mg - Secado",
        "Lote TM40M"
    ],
    [
        "Dilcoran 320 mg - Mezclado",
        "Lote TM40M"
    ],
    [
        "Loplac 50 mg - Compresión de núcleos",
        "Lote TO46K"
    ],
    [
        "Loplac 50 mg - Paila 1",
        "Lote TO46K"
    ],
    [
        "Loplac 50 mg - Paila 2",
        "Lote TO46K"
    ],
    [
        "Loplac 50 mg - Paila 3",
        "Lote TO46K"
    ],
    [
        "Loplac 50 mg - Paila 4",
        "Lote TO46K"
    ],
    [
        "Loplac 50 mg - Mezclado",
        "Lote TO46K"
    ],
    [
        "Loplac 50 mg - Granulacion",
        "Lote TO46K"
    ],
    [
        "Loplac 50 mg - Secado",
        "Lote TO46K"
    ],
    [
        "Loplac 50 mg - Compresión de núcleos",
        "Lote TO46P"
    ],
    [
        "Loplac 50 mg - Paila 1",
        "Lote TO46P"
    ],
    [
        "Loplac 50 mg - Paila 2",
        "Lote TO46P"
    ],
    [
        "Loplac 50 mg - Paila 3",
        "Lote TO46P"
    ],
    [
        "Loplac 50 mg - Paila 4",
        "Lote TO46P"
    ],
    [
        "Loplac 50 mg - Mezclado",
        "Lote TO46P"
    ],
    [
        "Loplac 50 mg - Granulacion",
        "Lote TO46P"
    ],
    [
        "Loplac 50 mg - Secado",
        "Lote TO46P"
    ],
    [
        "Loplac 50 mg - Compresión de núcleos",
        "Lote TO47K"
    ],
    [
        "Loplac 50 mg - Paila 1",
        "Lote TO47K"
    ],
    [
        "Loplac 50 mg - Paila 2",
        "Lote TO47K"
    ],
    [
        "Loplac 50 mg - Paila 3",
        "Lote TO47K"
    ],
    [
        "Loplac 50 mg - Paila 4",
        "Lote TO47K"
    ],
    [
        "Loplac 50 mg - Mezclado",
        "Lote TO47K"
    ],
    [
        "Loplac 50 mg - Granulacion",
        "Lote TO47K"
    ],
    [
        "Loplac 50 mg - Secado",
        "Lote TO47K"
    ],
    [
        "Loplac 50 mg - Compresión de núcleos",
        "Lote TO47P"
    ],
    [
        "Loplac 50 mg - Paila 1",
        "Lote TO47P"
    ],
    [
        "Loplac 50 mg - Paila 2",
        "Lote TO47P"
    ],
    [
        "Loplac 50 mg - Paila 3",
        "Lote TO47P"
    ],
    [
        "Loplac 50 mg - Paila 4",
        "Lote TO47P"
    ],
    [
        "Loplac 50 mg - Mezclado",
        "Lote TO47P"
    ],
    [
        "Loplac 50 mg - Granulacion",
        "Lote TO47P"
    ],
    [
        "Loplac 50 mg - Secado",
        "Lote TO47P"
    ],
    [
        "Diclofenac Flex - Compresión",
        "Lote UP36K"
    ],
    [
        "Diclofenac Flex - Compresión de núcleos",
        "Lote UP36K"
    ],
    [
        "Diclofenac Flex - Recubrimiento",
        "Lote UP36K"
    ],
    [
        "Diclofenac Flex - Compresión",
        "Lote UP36P"
    ],
    [
        "Diclofenac Flex - Compresión de núcleos",
        "Lote UP36P"
    ],
    [
        "Diclofenac Flex - Recubrimiento",
        "Lote UP36P"
    ],
    [
        "Diclofenac Flex - Compresión",
        "Lote UP37K"
    ],
    [
        "Diclofenac Flex - Compresión de núcleos",
        "Lote UP37K"
    ],
    [
        "Diclofenac Flex - Recubrimiento",
        "Lote UP37K"
    ],
    [
        "Diclofenac Flex - Compresión",
        "Lote UP37P"
    ],
    [
        "Diclofenac Flex - Compresión de núcleos",
        "Lote UP37P"
    ],
    [
        "Diclofenac Flex - Recubrimiento",
        "Lote UP37P"
    ],
    [
        "Ampliar 40 mg - Compresión de núcleos",
        "Lote TH21K"
    ],
    [
        "Ampliar 40 mg - Paila 1",
        "Lote TH21K"
    ],
    [
        "Ampliar 40 mg - Granulacion",
        "Lote TH21K"
    ],
    [
        "Ampliar 40 mg - Secado",
        "Lote TH21K"
    ],
    [
        "Ampliar 40 mg - Mezclado",
        "Lote TH21K"
    ],
    [
        "Ampliar 40 mg - Compresión de núcleos",
        "Lote TH21P"
    ],
    [
        "Ampliar 40 mg - Paila 1",
        "Lote TH21P"
    ],
    [
        "Ampliar 40 mg - Granulacion",
        "Lote TH21P"
    ],
    [
        "Ampliar 40 mg - Secado",
        "Lote TH21P"
    ],
    [
        "Ampliar 40 mg - Mezclado",
        "Lote TH21P"
    ],
    [
        "Ampliar 10 mg - Compresión de núcleos",
        "Lote UP06K"
    ],
    [
        "Ampliar 10 mg - Paila 1",
        "Lote UP06K"
    ],
    [
        "Ampliar 10 mg - Granulacion",
        "Lote UP06K"
    ],
    [
        "Ampliar 10 mg - Secado",
        "Lote UP06K"
    ],
    [
        "Ampliar 10 mg - Mezclado",
        "Lote UP06K"
    ],
    [
        "Ampliar 10 mg - Compresión de núcleos",
        "Lote UP06P"
    ],
    [
        "Ampliar 10 mg - Paila 1",
        "Lote UP06P"
    ],
    [
        "Ampliar 10 mg - Granulacion",
        "Lote UP06P"
    ],
    [
        "Ampliar 10 mg - Secado",
        "Lote UP06P"
    ],
    [
        "Ampliar 10 mg - Mezclado",
        "Lote UP06P"
    ],
    [
        "Diclofenac Gesic - Compresión",
        "Lote TZ76K"
    ],
    [
        "Diclofenac Gesic - Paila 1",
        "Lote TZ76K"
    ],
    [
        "Diclofenac Gesic - Granulacion",
        "Lote TZ76K"
    ],
    [
        "Diclofenac Gesic - Mezclado",
        "Lote TZ76K"
    ]
],
} as const;

// Provenance: ui-audit-structural/screens/015-control-de-acceso.json
export const eppiAccessControlCapture = {
    sourceArtifact: 'ui-audit-structural/screens/015-control-de-acceso.json',
    columns: [
    "Tipo",
    "Dirección IP / ID del dispositivo",
    "Descripción",
    "Etiquetas"
],
    rows: [] as const,
    actionLabel: 'Agregar',
    actionDisabled: true,
    emptyMessage: 'No se encontraron dispositivos',
} as const;

const accessColumns = [
    {
        "id": "type",
        "label": "Tipo",
        "widthPercent": 18
    },
    {
        "id": "device",
        "label": "Dirección IP / ID del dispositivo",
        "widthPercent": 34
    },
    {
        "id": "description",
        "label": "Descripción",
        "widthPercent": 28
    },
    {
        "id": "tags",
        "label": "Etiquetas",
        "widthPercent": 20
    }
] as const satisfies readonly EppiTableColumnDefinition[];
const accessRows = [] as const satisfies readonly CapturedTableRow[];
export const eppiAccessControlTable: EppiTableDefinition = createTableDefinition('access-control', 'Control de acceso', accessColumns, accessRows);

// Provenance: ui-audit-structural/screens/014-dispositivos.json; ui-audit-structural/navigation.json
export const eppiDeviceCards = [
    { label: 'Administrar impresoras', route: '/app/printers', addRoute: '/app/printers/add', addResult: '/403' },
    { label: 'Administrar dispositivos de medición', route: '/app/measurement-devices', addRoute: '/app/measurement-devices/add', addResult: '/403' },
] as const;

// Provenance: ui-audit-structural/screens/013-registro-de-auditoria.json; ui-audit-structural/navigation.json
export const eppiAuditCapture = {
    route: '/403',
    title: 'Acceso no autorizado',
    message: 'No tienes permiso para acceder a este recurso. Por favor, verifica tus credenciales o contacta al administrador si crees que esto es un error.',
    returnLabel: 'Volver a inicio',
    returnRoute: '/app/orders',
} as const;

// Provenance: ui-audit-structural/screens/016-documentacion.json
export const eppiDocumentationCapture = {
    route: '/app/documentation',
    title: 'Documentación',
    outerElement: 'iframe',
    contentAvailability: 'unavailable',
    unavailableReason: 'The iframe contents were not captured in the local structural audit.',
} as const;

// Provenance: ui-audit-structural/screens/002-ordenes-de-produccion.json
export const eppiIdentityCapture = {
    displayName: 'Nicolas Martin Viviani',
    role: 'Jefe',
    connectionStatus: ['Internet: ✓', 'Servidor: ✓', 'Responde Velocidad: ✓ Estable'],
} as const;
